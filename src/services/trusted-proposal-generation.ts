import type { ProposalGenerationEvaluationResult } from "./proposal-generation-evaluation.js";
import type { ProposalGenerationContextResult } from "./proposal-generation-context.js";

export interface ProposalGenerationContextBuilder {
  build(proposalId: string): Promise<ProposalGenerationContextResult>;
}

export interface ProposalGenerationEvaluator {
  generateAndEvaluate(
    input: Extract<ProposalGenerationContextResult, { status: "READY" }>["input"],
  ): Promise<ProposalGenerationEvaluationResult>;
}

export type TrustedProposalGenerationResult =
  | ProposalGenerationEvaluationResult
  | { status: "POLICY_NOT_CONFIGURED" };

export class TrustedProposalGenerationService {
  constructor(
    private readonly contextBuilder: ProposalGenerationContextBuilder,
    private readonly generationEvaluator: ProposalGenerationEvaluator,
  ) {}

  async generate(proposalId: string): Promise<TrustedProposalGenerationResult> {
    const context = await this.contextBuilder.build(proposalId);
    if (context.status === "POLICY_NOT_CONFIGURED") return context;
    return this.generationEvaluator.generateAndEvaluate(context.input);
  }
}
