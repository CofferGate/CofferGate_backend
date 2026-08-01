import {
  executionConfirmationObservationSchema,
  proposalSchema,
  type ExecutionConfirmationObservation,
  type Proposal,
} from "../contracts/index.js";
import type { SolanaRpcProvider } from "../providers/solana-rpc.js";

export type SolanaConfirmationObservationResult =
  | { status: "READY"; observation: ExecutionConfirmationObservation }
  | { status: "INVALID_EXECUTION" }
  | { status: "NOT_FOUND" }
  | { status: "PENDING" }
  | { status: "TRANSACTION_FAILED"; error: unknown }
  | { status: "BLOCK_TIME_UNAVAILABLE" };

type ConfirmationProvider = Pick<
  SolanaRpcProvider,
  "getSignatureStatus" | "getTokenBalance"
>;

export class SolanaConfirmationObservationService {
  constructor(private readonly provider: ConfirmationProvider) {}

  async observe(
    candidate: Proposal,
  ): Promise<SolanaConfirmationObservationResult> {
    const proposal = proposalSchema.parse(candidate);
    const execution = proposal.execution;
    if (
      proposal.status !== "SUBMITTED" ||
      !proposal.outputSymbol ||
      !execution?.transactionSignature ||
      !execution.outputTokenAccount ||
      !execution.beforeOutputBalanceAtomic ||
      !execution.expectedOutputDeltaAtomic
    ) {
      return { status: "INVALID_EXECUTION" };
    }

    const signatureStatus = await this.provider.getSignatureStatus(
      execution.transactionSignature,
    );
    if (signatureStatus.status === "NOT_FOUND") return { status: "NOT_FOUND" };
    if (signatureStatus.status === "PENDING") return { status: "PENDING" };
    if (signatureStatus.status === "FAILED") {
      return { status: "TRANSACTION_FAILED", error: signatureStatus.error };
    }
    if (signatureStatus.confirmedAt === null) {
      return { status: "BLOCK_TIME_UNAVAILABLE" };
    }

    const balance = await this.provider.getTokenBalance(
      execution.outputTokenAccount,
      signatureStatus.commitment,
    );
    const observation = executionConfirmationObservationSchema.parse({
      transactionSignature: execution.transactionSignature,
      commitment: signatureStatus.commitment,
      confirmedAt: signatureStatus.confirmedAt,
      asset: proposal.outputSymbol,
      beforeBalanceAtomic: execution.beforeOutputBalanceAtomic,
      afterBalanceAtomic: balance.amountAtomic,
      expectedDeltaAtomic: execution.expectedOutputDeltaAtomic,
    });
    return { status: "READY", observation };
  }

}
