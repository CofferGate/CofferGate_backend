import type { Proposal } from "../contracts/index.js";
import type { DailyUsageRepository } from "../repositories/daily-usage-repository.js";
import type { ProposalRepository } from "../repositories/proposal-repository.js";
import type { PolicyGateService } from "./policy-gate.js";

export type ProposalPolicyEvaluationResult =
  | { status: "EVALUATED"; proposal: Proposal }
  | { status: "NOT_FOUND" }
  | { status: "INVALID_STATE" }
  | { status: "CONFLICT" };

export interface ProposalPolicyEvaluationDependencies {
  proposalRepository: ProposalRepository;
  policyGate: PolicyGateService;
  dailyUsageRepository: DailyUsageRepository;
}

export interface ProposalPolicyEvaluationContext {
  now?: Date;
}

export class ProposalPolicyEvaluationService {
  constructor(
    private readonly dependencies: ProposalPolicyEvaluationDependencies,
  ) {}

  async evaluate(
    proposalId: string,
    context: ProposalPolicyEvaluationContext = {},
  ): Promise<ProposalPolicyEvaluationResult> {
    const proposal = await this.dependencies.proposalRepository.findById(
      proposalId,
    );
    if (!proposal) {
      return { status: "NOT_FOUND" };
    }
    if (proposal.status !== "AI_REVIEWED") {
      return { status: "INVALID_STATE" };
    }

    const now = context.now ?? new Date();
    const date = now.toISOString().slice(0, 10);
    const dailyUsageUsd =
      await this.dependencies.dailyUsageRepository.getUsageUsd(date);
    const evaluatedProposal = await this.dependencies.policyGate.evaluate(
      proposal,
      { dailyUsageUsd, now },
    );
    const saveResult =
      await this.dependencies.proposalRepository.savePolicyEvaluation(
        evaluatedProposal,
        "AI_REVIEWED",
      );

    if (saveResult === "NOT_FOUND") {
      return { status: "NOT_FOUND" };
    }
    if (saveResult === "STATUS_CONFLICT") {
      return { status: "CONFLICT" };
    }
    return { status: "EVALUATED", proposal: evaluatedProposal };
  }
}
