import {
  executionConfirmationObservationSchema,
  proposalSchema,
  type ExecutionConfirmationObservation,
  type Proposal,
} from "../contracts/index.js";

export type ExecutionReconciliationResult =
  | { status: "RECONCILED"; proposal: Proposal }
  | { status: "MISMATCHED"; proposal: Proposal }
  | { status: "INVALID_STATE" }
  | { status: "INVALID_EXECUTION" }
  | { status: "UNSIGNED_EXECUTION" }
  | { status: "SIGNATURE_MISMATCH" }
  | { status: "ASSET_MISMATCH" }
  | { status: "CONFIRMATION_BEFORE_SUBMISSION" };

export class ExecutionReconciliationService {
  reconcile(
    proposal: Proposal,
    observation: ExecutionConfirmationObservation,
  ): ExecutionReconciliationResult {
    const validatedProposal = proposalSchema.parse(proposal);
    const validatedObservation =
      executionConfirmationObservationSchema.parse(observation);

    if (validatedProposal.status !== "SUBMITTED") {
      return { status: "INVALID_STATE" };
    }
    if (
      validatedProposal.action !== "SWAP" ||
      !validatedProposal.outputSymbol ||
      !validatedProposal.execution?.submittedAt ||
      !Number.isFinite(Date.parse(validatedProposal.execution.submittedAt))
    ) {
      return { status: "INVALID_EXECUTION" };
    }
    if (
      !validatedProposal.execution?.kmsRequested ||
      !validatedProposal.execution.transactionSignature
    ) {
      return { status: "UNSIGNED_EXECUTION" };
    }
    if (
      validatedProposal.execution.transactionSignature !==
      validatedObservation.transactionSignature
    ) {
      return { status: "SIGNATURE_MISMATCH" };
    }
    if (validatedProposal.outputSymbol !== validatedObservation.asset) {
      return { status: "ASSET_MISMATCH" };
    }
    if (
      Date.parse(validatedObservation.confirmedAt) <
      Date.parse(validatedProposal.execution.submittedAt)
    ) {
      return { status: "CONFIRMATION_BEFORE_SUBMISSION" };
    }

    const actualDelta =
      BigInt(validatedObservation.afterBalanceAtomic) -
      BigInt(validatedObservation.beforeBalanceAtomic);
    const expectedDelta = BigInt(validatedObservation.expectedDeltaAtomic);
    const matched = actualDelta === expectedDelta;
    const reconciledProposal = proposalSchema.parse({
      ...validatedProposal,
      status: matched ? "RECONCILED" : "FAILED",
      execution: {
        ...validatedProposal.execution,
        confirmedAt: validatedObservation.confirmedAt,
        commitment: validatedObservation.commitment,
        reconciliation: {
          beforeBalance: validatedObservation.beforeBalanceAtomic,
          afterBalance: validatedObservation.afterBalanceAtomic,
          expectedDelta: expectedDelta.toString(),
          actualDelta: actualDelta.toString(),
          status: matched ? "MATCHED" : "MISMATCHED",
        },
      },
    });

    return {
      status: matched ? "RECONCILED" : "MISMATCHED",
      proposal: reconciledProposal,
    };
  }
}
