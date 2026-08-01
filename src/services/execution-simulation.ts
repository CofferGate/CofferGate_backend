import type { SimulationResult } from "../contracts/index.js";
import type { SolanaSimulationResult } from "../providers/solana-rpc.js";

export interface TransactionSimulator {
  simulateTransaction(
    transaction: Buffer,
    minContextSlot?: number,
  ): Promise<SolanaSimulationResult>;
}

export interface ExecutionSimulationOptions {
  computeUnitMarginBps: number;
  maxComputeUnits: number;
}

export type ExecutionSimulationResult =
  | {
      status: "PASSED";
      simulation: SimulationResult;
      computeUnitLimit: number;
    }
  | {
      status: "FAILED" | "INVALID_RESULT" | "COMPUTE_LIMIT_EXCEEDED";
      simulation: SimulationResult;
    };

export class ExecutionSimulationService {
  constructor(
    private readonly simulator: TransactionSimulator,
    private readonly options: ExecutionSimulationOptions,
  ) {
    if (
      !Number.isInteger(options.computeUnitMarginBps) ||
      options.computeUnitMarginBps < 0 ||
      !Number.isInteger(options.maxComputeUnits) ||
      options.maxComputeUnits <= 0
    ) {
      throw new Error("Simulation compute limits are invalid.");
    }
  }

  async simulate(
    transaction: Buffer,
    minContextSlot?: number,
  ): Promise<ExecutionSimulationResult> {
    const result = await this.simulator.simulateTransaction(
      transaction,
      minContextSlot,
    );
    if (!result.ok) {
      return {
        status: "FAILED",
        simulation: {
          ok: false,
          ...(result.unitsConsumed === undefined
            ? {}
            : { unitsConsumed: result.unitsConsumed }),
          error: this.errorMessage(result.error),
        },
      };
    }
    if (result.unitsConsumed === undefined || result.unitsConsumed <= 0) {
      return {
        status: "INVALID_RESULT",
        simulation: { ok: false, error: "Simulation returned no compute usage." },
      };
    }
    const computeUnitLimit = Math.ceil(
      (result.unitsConsumed * (10_000 + this.options.computeUnitMarginBps)) /
        10_000,
    );
    if (computeUnitLimit > this.options.maxComputeUnits) {
      return {
        status: "COMPUTE_LIMIT_EXCEEDED",
        simulation: {
          ok: false,
          unitsConsumed: result.unitsConsumed,
          error: "Simulation compute usage exceeds the configured maximum.",
        },
      };
    }
    return {
      status: "PASSED",
      simulation: { ok: true, unitsConsumed: result.unitsConsumed },
      computeUnitLimit,
    };
  }

  private errorMessage(error: unknown): string {
    const message = typeof error === "string" ? error : JSON.stringify(error);
    return (message || "Transaction simulation failed.").slice(0, 1000);
  }
}
