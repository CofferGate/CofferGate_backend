import { z } from "zod";
import {
  assertIsFullySignedTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from "@solana/kit";

const rpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

const tokenBalanceResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    value: z.object({
      amount: z.string().regex(/^\d+$/),
      decimals: z.number().int().nonnegative(),
    }),
  }),
  id: z.number(),
});

const nativeBalanceResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    value: z.number().int().nonnegative().safe(),
  }),
  id: z.number(),
});

const blockHeightResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.number().int().nonnegative().safe(),
  id: z.number(),
});

const latestBlockhashResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    context: z.object({ slot: z.number().int().nonnegative() }).passthrough(),
    value: z.object({
      blockhash: z.string().min(1),
      lastValidBlockHeight: z.number().int().positive().safe(),
    }),
  }),
  id: z.number(),
});

const simulationResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    context: z.object({ slot: z.number().int().nonnegative() }).passthrough(),
    value: z.object({
      err: z.unknown().nullable(),
      logs: z.array(z.string()).nullable(),
      unitsConsumed: z.number().int().nonnegative().nullable().optional(),
    }).passthrough(),
  }),
  id: z.number(),
});

const sendTransactionResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.string().min(1),
  id: z.number(),
});

const signatureStatusesResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    value: z.array(z.object({
      confirmationStatus: z.enum(["processed", "confirmed", "finalized"]).nullable(),
      err: z.unknown().nullable(),
    }).nullable()),
  }),
  id: z.number(),
});

export interface SolanaTokenBalance {
  amountAtomic: string;
  decimals: number;
}

export interface SolanaNativeBalance {
  amountAtomic: string;
  decimals: 9;
}

export interface SolanaRpcProviderOptions {
  endpoint: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface SolanaLatestBlockhash {
  blockhash: string;
  lastValidBlockHeight: number;
  slot: number;
}

export interface SolanaSimulationResult {
  ok: boolean;
  slot: number;
  unitsConsumed?: number;
  logs: string[];
  error?: unknown;
}

export class SolanaRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "SolanaRpcError";
  }
}

export class SolanaRpcProvider {
  private requestId = 0;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: SolanaRpcProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImplementation = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async getTokenBalance(
    tokenAccount: string,
    commitment: "confirmed" | "finalized" = "confirmed",
  ): Promise<SolanaTokenBalance> {
    const response = tokenBalanceResponseSchema.parse(
      await this.request("getTokenAccountBalance", [
        tokenAccount,
        { commitment },
      ]),
    );
    return {
      amountAtomic: response.result.value.amount,
      decimals: response.result.value.decimals,
    };
  }

  async getTokenBalanceOrZero(
    tokenAccount: string,
    decimals: number,
  ): Promise<SolanaTokenBalance> {
    try {
      return await this.getTokenBalance(tokenAccount);
    } catch (error) {
      if (error instanceof SolanaRpcError && error.code === -32602 &&
        /could not find account/i.test(error.message)) {
        return { amountAtomic: "0", decimals };
      }
      throw error;
    }
  }

  async getNativeBalance(
    walletAddress: string,
    commitment: "confirmed" | "finalized" = "confirmed",
  ): Promise<SolanaNativeBalance> {
    const response = nativeBalanceResponseSchema.parse(
      await this.request("getBalance", [walletAddress, { commitment }]),
    );
    return {
      amountAtomic: String(response.result.value),
      decimals: 9,
    };
  }

  async getBlockHeight(minContextSlot?: number): Promise<number> {
    if (
      minContextSlot !== undefined &&
      (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0)
    ) {
      throw new SolanaRpcError("Block height context slot must be a nonnegative safe integer.");
    }
    return blockHeightResponseSchema.parse(
      await this.request("getBlockHeight", [{
        commitment: "confirmed",
        ...(minContextSlot === undefined ? {} : { minContextSlot }),
      }]),
    ).result;
  }

  async getLatestBlockhash(): Promise<SolanaLatestBlockhash> {
    const response = latestBlockhashResponseSchema.parse(
      await this.request("getLatestBlockhash", [{ commitment: "confirmed" }]),
    );
    return {
      ...response.result.value,
      slot: response.result.context.slot,
    };
  }

  async simulateTransaction(transaction: Buffer): Promise<SolanaSimulationResult> {
    assertTransactionSize(transaction);
    const response = simulationResponseSchema.parse(
      await this.request("simulateTransaction", [
        transaction.toString("base64"),
        {
          commitment: "confirmed",
          encoding: "base64",
          replaceRecentBlockhash: false,
          sigVerify: false,
        },
      ]),
    );
    const result = response.result.value;
    return {
      ok: result.err === null,
      slot: response.result.context.slot,
      ...(result.unitsConsumed === null || result.unitsConsumed === undefined
        ? {}
        : { unitsConsumed: result.unitsConsumed }),
      logs: result.logs ?? [],
      ...(result.err === null ? {} : { error: result.err }),
    };
  }

  async sendTransaction(transaction: Buffer): Promise<string> {
    assertTransactionSize(transaction);
    const decodedTransaction = getTransactionDecoder().decode(transaction);
    assertIsFullySignedTransaction(decodedTransaction);
    const expectedSignature = getSignatureFromTransaction(decodedTransaction);
    const returnedSignature = sendTransactionResponseSchema.parse(
      await this.request("sendTransaction", [
        transaction.toString("base64"),
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        },
      ]),
    ).result;
    if (returnedSignature !== expectedSignature) {
      throw new SolanaRpcError("Solana RPC returned a mismatched transaction signature.");
    }
    return returnedSignature;
  }

  async confirmTransaction(
    signature: string,
    lastValidBlockHeight: number,
    options: { pollIntervalMs?: number; maxAttempts?: number } = {},
  ): Promise<{ commitment: "confirmed" | "finalized" }> {
    if (!signature || !Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) {
      throw new SolanaRpcError("Transaction confirmation input is invalid.");
    }
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const maxAttempts = options.maxAttempts ?? 30;
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 ||
      !Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
      throw new SolanaRpcError("Transaction confirmation polling is invalid.");
    }
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = signatureStatusesResponseSchema.parse(
        await this.request("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]),
      );
      const status = response.result.value[0];
      if (status?.err !== null && status?.err !== undefined) {
        throw new SolanaRpcError("Solana transaction failed during confirmation.");
      }
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        return { commitment: status.confirmationStatus };
      }
      if (await this.getBlockHeight() > lastValidBlockHeight) {
        throw new SolanaRpcError("Solana transaction expired before confirmation.");
      }
      if (attempt + 1 < maxAttempts) await this.sleep(pollIntervalMs);
    }
    throw new SolanaRpcError("Solana transaction confirmation timed out.");
  }

  private async request(method: string, params: unknown[]): Promise<unknown> {
    const id = ++this.requestId;
    const response = await this.fetchImplementation(this.options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new SolanaRpcError(`Solana RPC returned HTTP ${response.status}.`);
    }
    const payload: unknown = await response.json();
    const rpcFailure = z
      .object({ error: rpcErrorSchema })
      .safeParse(payload);
    if (rpcFailure.success) {
      throw new SolanaRpcError(
        rpcFailure.data.error.message,
        rpcFailure.data.error.code,
      );
    }
    return payload;
  }
}

function assertTransactionSize(transaction: Buffer): void {
  if (transaction.length === 0 || transaction.length > 1_232) {
    throw new SolanaRpcError("Solana transaction has an invalid size.");
  }
}
