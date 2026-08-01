import type { ProposalRepository } from "../repositories/proposal-repository.js";
import type { ExecutionFailureRepository } from "../repositories/execution-failure-repository.js";
import type { ExecutionCompletionWorkflow } from "./execution-completion-workflow.js";
import type { SolanaConfirmationObservationService } from "./solana-confirmation-observation.js";

export type ExecutionConfirmationPollResult =
  | { status: "NOT_FOUND" }
  | { status: "WAITING"; reason: "NOT_FOUND" | "PENDING" | "BLOCK_TIME_UNAVAILABLE" }
  | { status: "TRANSACTION_FAILED"; persistence: Awaited<ReturnType<ExecutionFailureRepository["fail"]>> }
  | { status: "INVALID_EXECUTION" }
  | { status: "PROCESSED"; result: Awaited<ReturnType<ExecutionCompletionWorkflow["complete"]>> };

export class ExecutionConfirmationPoller {
  constructor(
    private readonly proposalRepository: ProposalRepository,
    private readonly observationService: SolanaConfirmationObservationService,
    private readonly completionWorkflow: ExecutionCompletionWorkflow,
    private readonly failureRepository: ExecutionFailureRepository,
  ) {}

  async poll(proposalId: string): Promise<ExecutionConfirmationPollResult> {
    const proposal = await this.proposalRepository.findById(proposalId);
    if (!proposal) return { status: "NOT_FOUND" };

    const observed = await this.observationService.observe(proposal);
    if (observed.status === "INVALID_EXECUTION") return observed;
    if (observed.status === "TRANSACTION_FAILED") {
      const signature = proposal.execution?.transactionSignature;
      if (!signature) return { status: "INVALID_EXECUTION" };
      const message = this.serializeError(observed.error);
      return {
        status: "TRANSACTION_FAILED",
        persistence: await this.failureRepository.fail(
          proposalId,
          signature,
          message,
          new Date().toISOString(),
        ),
      };
    }
    if (
      observed.status === "NOT_FOUND" ||
      observed.status === "PENDING" ||
      observed.status === "BLOCK_TIME_UNAVAILABLE"
    ) {
      return { status: "WAITING", reason: observed.status };
    }

    return {
      status: "PROCESSED",
      result: await this.completionWorkflow.complete(
        proposalId,
        observed.observation,
      ),
    };
  }

  private serializeError(error: unknown): string {
    try {
      return JSON.stringify(error) || "Unknown Solana transaction failure.";
    } catch {
      return "Unserializable Solana transaction failure.";
    }
  }
}
