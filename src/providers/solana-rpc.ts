import { z } from "zod";

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

  constructor(private readonly options: SolanaRpcProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImplementation = options.fetch ?? fetch;
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
