import { z } from "zod";

const rpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

const signatureStatusResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    value: z.array(
      z
        .object({
          slot: z.number().int().nonnegative(),
          err: z.unknown().nullable(),
          confirmationStatus: z
            .enum(["processed", "confirmed", "finalized"])
            .nullable(),
        })
        .nullable(),
    ),
  }),
  id: z.number(),
});

const blockTimeResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.number().int().nullable(),
  id: z.number(),
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

export type SolanaSignatureStatus =
  | { status: "NOT_FOUND" }
  | { status: "PENDING"; slot: number }
  | { status: "FAILED"; slot: number; error: unknown }
  | {
      status: "CONFIRMED";
      slot: number;
      commitment: "confirmed" | "finalized";
      confirmedAt: string | null;
    };

export interface SolanaTokenBalance {
  amountAtomic: string;
  decimals: number;
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

  async getSignatureStatus(signature: string): Promise<SolanaSignatureStatus> {
    const response = signatureStatusResponseSchema.parse(
      await this.request("getSignatureStatuses", [
        [signature],
        { searchTransactionHistory: true },
      ]),
    );
    const status = response.result.value[0];
    if (!status) {
      return { status: "NOT_FOUND" };
    }
    if (status.err !== null) {
      return { status: "FAILED", slot: status.slot, error: status.err };
    }
    if (
      status.confirmationStatus !== "confirmed" &&
      status.confirmationStatus !== "finalized"
    ) {
      return { status: "PENDING", slot: status.slot };
    }

    const blockTime = blockTimeResponseSchema.parse(
      await this.request("getBlockTime", [status.slot]),
    ).result;
    return {
      status: "CONFIRMED",
      slot: status.slot,
      commitment: status.confirmationStatus,
      confirmedAt:
        blockTime === null ? null : new Date(blockTime * 1_000).toISOString(),
    };
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
