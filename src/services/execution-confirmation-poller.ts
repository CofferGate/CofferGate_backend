import type { ProposalRepository } from "../repositories/proposal-repository.js";
import type { ExecutionCompletionWorkflow } from "./execution-completion-workflow.js";
import type { SolanaConfirmationObservationService } from "./solana-confirmation-observation.js";

export type ExecutionConfirmationPollResult =
  | { status: "NOT_FOUND" }
  | { status: "WAITING"; reason: "NOT_FOUND" | "PENDING" | "BLOCK_TIME_UNAVAILABLE" }
  | { status: "TRANSACTION_FAILED"; error: unknown }
  | { status: "INVALID_EXECUTION" }
  | { status: "PROCESSED"; result: Awaited<ReturnType<ExecutionCompletionWorkflow["complete"]>> };

export class ExecutionConfirmationPoller {
  constructor(
    private readonly proposalRepository: ProposalRepository,
    private readonly observationService: SolanaConfirmationObservationService,
    private readonly completionWorkflow: ExecutionCompletionWorkflow,
  ) {}

  async poll(proposalId: string): Promise<ExecutionConfirmationPollResult> {
    const proposal = await this.proposalRepository.findById(proposalId);
    if (!proposal) return { status: "NOT_FOUND" };

    const observed = await this.observationService.observe(proposal);
    if (observed.status === "INVALID_EXECUTION") return observed;
    if (observed.status === "TRANSACTION_FAILED") return observed;
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
}
