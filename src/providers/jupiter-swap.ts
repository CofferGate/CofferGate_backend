import { z } from "zod";
import {
  jupiterQuoteResponseSchema,
  type JupiterQuote,
} from "./jupiter-quote.js";

const swapResponseSchema = z.object({
  swapTransaction: z.string().min(1),
  lastValidBlockHeight: z.number().int().positive(),
  prioritizationFeeLamports: z.number().int().nonnegative(),
});

export interface JupiterSwapProviderOptions {
  apiKey: string;
  userPublicKey: string;
  maxPriorityFeeLamports: number;
  priorityLevel?: "medium" | "high" | "veryHigh";
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface UnsignedJupiterSwapTransaction {
  serializedTransaction: Buffer;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export class JupiterSwapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JupiterSwapError";
  }
}

export class JupiterSwapProvider {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: JupiterSwapProviderOptions) {
    if (!options.apiKey || !options.userPublicKey) {
      throw new Error("Jupiter API key and user public key are required.");
    }
    if (!Number.isSafeInteger(options.maxPriorityFeeLamports) || options.maxPriorityFeeLamports < 0) {
      throw new Error("Maximum priority fee must be a nonnegative safe integer.");
    }
    this.endpoint = options.endpoint ?? "https://api.jup.ag/swap/v1/swap";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async createUnsignedTransaction(
    quote: JupiterQuote,
  ): Promise<UnsignedJupiterSwapTransaction> {
    const quoteResponse = jupiterQuoteResponseSchema.parse(quote.response);
    const response = await this.fetchImplementation(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.options.apiKey,
      },
      body: JSON.stringify({
        userPublicKey: this.options.userPublicKey,
        quoteResponse,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: false,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            priorityLevel: this.options.priorityLevel ?? "high",
            maxLamports: this.options.maxPriorityFeeLamports,
          },
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new JupiterSwapError(`Jupiter Swap API returned HTTP ${response.status}.`);
    }
    const payload = swapResponseSchema.parse(await response.json());
    if (payload.prioritizationFeeLamports > this.options.maxPriorityFeeLamports) {
      throw new JupiterSwapError("Jupiter priority fee exceeds the configured maximum.");
    }
    return {
      serializedTransaction: decodeUnsignedVersionedTransaction(payload.swapTransaction),
      lastValidBlockHeight: payload.lastValidBlockHeight,
      prioritizationFeeLamports: payload.prioritizationFeeLamports,
    };
  }
}

export function decodeUnsignedVersionedTransaction(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new JupiterSwapError("Jupiter swap transaction is not valid Base64.");
  }
  const transaction = Buffer.from(value, "base64");
  if (transaction.length === 0 || transaction.length > 1_232) {
    throw new JupiterSwapError("Jupiter swap transaction has an invalid size.");
  }
  const { value: signatureCount, bytesRead } = decodeShortVector(transaction);
  const messageOffset = bytesRead + signatureCount * 64;
  if (signatureCount < 1 || messageOffset + 2 > transaction.length) {
    throw new JupiterSwapError("Jupiter swap transaction has an invalid signature envelope.");
  }
  if (transaction.subarray(bytesRead, messageOffset).some((byte) => byte !== 0)) {
    throw new JupiterSwapError("Jupiter swap transaction must be unsigned.");
  }
  const versionPrefix = transaction[messageOffset]!;
  if ((versionPrefix & 0x80) === 0 || (versionPrefix & 0x7f) !== 0) {
    throw new JupiterSwapError("Jupiter swap transaction must use message version 0.");
  }
  const requiredSignatures = transaction[messageOffset + 1]!;
  if (requiredSignatures !== signatureCount) {
    throw new JupiterSwapError("Jupiter swap signature count does not match its message.");
  }
  return transaction;
}

function decodeShortVector(buffer: Buffer): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < Math.min(buffer.length, 3); index += 1) {
    const byte = buffer[index]!;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, bytesRead: index + 1 };
    shift += 7;
  }
  throw new JupiterSwapError("Jupiter swap signature count is malformed.");
}
