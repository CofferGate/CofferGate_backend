import {
  executionConfirmationObservationSchema,
  type ExecutionConfirmationObservation,
  type Proposal,
} from "../contracts/index.js";
import type {
  ExecutionCompletionRepository,
  ExecutionCompletionSaveResult,
} from "../repositories/execution-completion-repository.js";
import type { ProposalRepository } from "../repositories/proposal-repository.js";
import type {
  ExecutionReconciliationResult,
  ExecutionReconciliationService,
} from "./execution-reconciliation.js";

type ReconciliationRejection = Exclude<
  ExecutionReconciliationResult,
  { status: "RECONCILED" } | { status: "MISMATCHED" }
>;

export type ExecutionCompletionWorkflowResult =
  | {
      status: "COMPLETED";
      outcome: "RECONCILED" | "MISMATCHED";
      proposal: Proposal;
    }
  | { status: "ALREADY_COMPLETED"; proposal: Proposal }
  | { status: "NOT_FOUND" }
  | ReconciliationRejection
  | {
      status: "PERSISTENCE_CONFLICT";
      reason: Exclude<
        ExecutionCompletionSaveResult,
        "COMPLETED" | "ALREADY_COMPLETED"
      >;
    };

export interface ExecutionCompletionWorkflowDependencies {
  proposalRepository: ProposalRepository;
  reconciliationService: ExecutionReconciliationService;
  completionRepository: ExecutionCompletionRepository;
}

export class ExecutionCompletionWorkflow {
  constructor(
    private readonly dependencies: ExecutionCompletionWorkflowDependencies,
  ) {}

  async complete(
    proposalId: string,
    observation: ExecutionConfirmationObservation,
  ): Promise<ExecutionCompletionWorkflowResult> {
    const validatedObservation =
      executionConfirmationObservationSchema.parse(observation);
    const proposal = await this.dependencies.proposalRepository.findById(
      proposalId,
    );
    if (!proposal) {
      return { status: "NOT_FOUND" };
    }

    if (proposal.status === "RECONCILED" || proposal.status === "FAILED") {
      if (
        proposal.execution?.transactionSignature !==
        validatedObservation.transactionSignature
      ) {
        return { status: "SIGNATURE_MISMATCH" };
      }
      const retryResult =
        await this.dependencies.completionRepository.complete(proposal);
      if (retryResult === "ALREADY_COMPLETED") {
        return { status: "ALREADY_COMPLETED", proposal };
      }
      if (retryResult === "COMPLETED") {
        return {
          status: "COMPLETED",
          outcome:
            proposal.status === "RECONCILED" ? "RECONCILED" : "MISMATCHED",
          proposal,
        };
      }
      return this.persistenceConflict(retryResult);
    }

    const reconciliation = this.dependencies.reconciliationService.reconcile(
      proposal,
      validatedObservation,
    );
    if (
      reconciliation.status !== "RECONCILED" &&
      reconciliation.status !== "MISMATCHED"
    ) {
      return reconciliation;
    }

    const saveResult = await this.dependencies.completionRepository.complete(
      reconciliation.proposal,
    );
    if (saveResult === "COMPLETED") {
      return {
        status: "COMPLETED",
        outcome: reconciliation.status,
        proposal: reconciliation.proposal,
      };
    }
    if (saveResult === "ALREADY_COMPLETED") {
      return {
        status: "ALREADY_COMPLETED",
        proposal: reconciliation.proposal,
      };
    }
    return this.persistenceConflict(saveResult);
  }

  private persistenceConflict(
    reason: Exclude<
      ExecutionCompletionSaveResult,
      "COMPLETED" | "ALREADY_COMPLETED"
    >,
  ): ExecutionCompletionWorkflowResult {
    return { status: "PERSISTENCE_CONFLICT", reason };
  }
}
