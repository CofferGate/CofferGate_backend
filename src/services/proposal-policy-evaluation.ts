import type { Proposal } from "../contracts/index.js";
import type { ProposalRepository } from "../repositories/proposal-repository.js";
import type {
  PolicyEvaluationContext,
  PolicyGateService,
} from "./policy-gate.js";

export type ProposalPolicyEvaluationResult =
  | { status: "EVALUATED"; proposal: Proposal }
  | { status: "NOT_FOUND" }
  | { status: "INVALID_STATE" }
  | { status: "CONFLICT" };

export interface ProposalPolicyEvaluationDependencies {
  proposalRepository: ProposalRepository;
  policyGate: PolicyGateService;
}

export class ProposalPolicyEvaluationService {
  constructor(
    private readonly dependencies: ProposalPolicyEvaluationDependencies,
  ) {}

  async evaluate(
    proposalId: string,
    context: PolicyEvaluationContext,
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

    const evaluatedProposal = await this.dependencies.policyGate.evaluate(
      proposal,
      context,
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
