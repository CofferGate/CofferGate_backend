import { z } from "zod";
import { encodeBase58 } from "../encoding/base58.js";
import { inspectSignedVersionedTransaction } from "./jupiter-swap.js";

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

const nativeBalanceResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    value: z.number().int().nonnegative().safe(),
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
      replacementBlockhash: z
        .object({
          blockhash: z.string().min(1),
          lastValidBlockHeight: z.number().int().positive(),
        })
        .nullable()
        .optional(),
    }).passthrough(),
  }),
  id: z.number(),
});

const sendTransactionResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.string().min(1),
  id: z.number(),
});

const blockHeightResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.number().int().nonnegative().safe(),
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

export interface SolanaNativeBalance {
  amountAtomic: string;
  decimals: 9;
}

export type SolanaSimulationResult =
  | {
      ok: true;
      slot: number;
      unitsConsumed: number | undefined;
      logs: string[];
      replacementBlockhash: string | undefined;
      lastValidBlockHeight: number | undefined;
    }
  | {
      ok: false;
      slot: number;
      error: unknown;
      unitsConsumed: number | undefined;
      logs: string[];
    };

export interface SolanaRpcProviderOptions {
  endpoint: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface SolanaTransactionSubmissionOptions {
  minContextSlot?: number;
  maxRetries?: number;
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

  async simulateTransaction(
    serializedTransaction: Buffer,
    minContextSlot?: number,
  ): Promise<SolanaSimulationResult> {
    if (serializedTransaction.length === 0 || serializedTransaction.length > 1_232) {
      throw new Error("Simulation transaction has an invalid size.");
    }
    if (
      minContextSlot !== undefined &&
      (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0)
    ) {
      throw new Error("Simulation context slot must be a nonnegative safe integer.");
    }
    const response = simulationResponseSchema.parse(
      await this.request("simulateTransaction", [
        serializedTransaction.toString("base64"),
        {
          commitment: "confirmed",
          encoding: "base64",
          replaceRecentBlockhash: true,
          sigVerify: false,
          ...(minContextSlot === undefined ? {} : { minContextSlot }),
        },
      ]),
    );
    const { value } = response.result;
    const common = {
      slot: response.result.context.slot,
      unitsConsumed: value.unitsConsumed ?? undefined,
      logs: value.logs ?? [],
    };
    if (value.err !== null) {
      return { ok: false, ...common, error: value.err };
    }
    return {
      ok: true,
      ...common,
      replacementBlockhash: value.replacementBlockhash?.blockhash,
      lastValidBlockHeight: value.replacementBlockhash?.lastValidBlockHeight,
    };
  }

  async sendTransaction(
    serializedTransaction: Buffer,
    options: SolanaTransactionSubmissionOptions = {},
  ): Promise<string> {
    const envelope = inspectSignedVersionedTransaction(serializedTransaction);
    if (envelope.signatureCount !== 1) {
      throw new SolanaRpcError("Transaction submission requires exactly one signer.");
    }
    const { minContextSlot, maxRetries = 3 } = options;
    if (
      minContextSlot !== undefined &&
      (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0)
    ) {
      throw new SolanaRpcError("Transaction context slot must be a nonnegative safe integer.");
    }
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
      throw new SolanaRpcError("Transaction maximum retries must be a nonnegative safe integer.");
    }
    const expectedSignature = encodeBase58(envelope.firstSignature);
    const response = sendTransactionResponseSchema.parse(
      await this.request("sendTransaction", [
        serializedTransaction.toString("base64"),
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries,
          ...(minContextSlot === undefined ? {} : { minContextSlot }),
        },
      ]),
    );
    if (response.result !== expectedSignature) {
      throw new SolanaRpcError("Solana RPC returned a mismatched transaction signature.");
    }
    return response.result;
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
