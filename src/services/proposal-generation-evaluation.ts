import type { Proposal } from "../contracts/index.js";
import type { VertexProposalGenerationInput } from "../providers/vertex-proposal.js";
import type { ProposalGenerationResult } from "./proposal-generation.js";
import type {
  ProposalPolicyEvaluationContext,
  ProposalPolicyEvaluationResult,
} from "./proposal-policy-evaluation.js";

export interface ProposalGeneration {
  generate(
    input: VertexProposalGenerationInput,
  ): Promise<ProposalGenerationResult>;
}

export interface ProposalPolicyEvaluation {
  evaluate(
    proposalId: string,
    context?: ProposalPolicyEvaluationContext,
  ): Promise<ProposalPolicyEvaluationResult>;
}

export interface ProposalGenerationEvaluationDependencies {
  proposalGeneration: ProposalGeneration;
  proposalPolicyEvaluation: ProposalPolicyEvaluation;
}

export type ProposalGenerationEvaluationResult =
  | { status: "EVALUATED"; proposal: Proposal }
  | { status: "ALREADY_PROCESSED"; proposal: Proposal }
  | { status: "ID_CONFLICT" }
  | { status: "PERSISTENCE_INCONSISTENCY" }
  | { status: "CONFLICT" };

export class ProposalGenerationEvaluationService {
  constructor(
    private readonly dependencies: ProposalGenerationEvaluationDependencies,
  ) {}

  async generateAndEvaluate(
    input: VertexProposalGenerationInput,
    context: ProposalPolicyEvaluationContext = {},
  ): Promise<ProposalGenerationEvaluationResult> {
    const generationResult =
      await this.dependencies.proposalGeneration.generate(input);

    if (generationResult.status === "ID_CONFLICT") {
      return { status: "ID_CONFLICT" };
    }
    if (generationResult.status === "PERSISTENCE_INCONSISTENCY") {
      return { status: "PERSISTENCE_INCONSISTENCY" };
    }
    if (generationResult.proposal.status !== "AI_REVIEWED") {
      return {
        status: "ALREADY_PROCESSED",
        proposal: generationResult.proposal,
      };
    }

    const evaluationResult =
      await this.dependencies.proposalPolicyEvaluation.evaluate(
        generationResult.proposal.proposalId,
        context,
      );
    if (evaluationResult.status === "EVALUATED") {
      return evaluationResult;
    }
    if (evaluationResult.status === "NOT_FOUND") {
      return { status: "PERSISTENCE_INCONSISTENCY" };
    }
    return { status: "CONFLICT" };
  }

}
