import type { Proposal } from "../contracts/index.js";
import type { VertexProposalGenerationInput } from "../providers/vertex-proposal.js";
import type { ProposalRepository } from "../repositories/proposal-repository.js";

export interface ProposalGenerator {
  generate(input: VertexProposalGenerationInput): Promise<Proposal>;
}

export interface ProposalGenerationDependencies {
  proposalGenerator: ProposalGenerator;
  proposalRepository: ProposalRepository;
}

export type ProposalGenerationResult =
  | { status: "CREATED"; proposal: Proposal }
  | { status: "ALREADY_EXISTS"; proposal: Proposal }
  | { status: "ID_CONFLICT" }
  | { status: "PERSISTENCE_INCONSISTENCY" };

export class ProposalGenerationService {
  constructor(
    private readonly dependencies: ProposalGenerationDependencies,
  ) {}

  async generate(
    input: VertexProposalGenerationInput,
  ): Promise<ProposalGenerationResult> {
    const proposal = await this.dependencies.proposalGenerator.generate(input);
    const createResult =
      await this.dependencies.proposalRepository.create(proposal);

    if (createResult === "CREATED") {
      return { status: "CREATED", proposal };
    }
    if (createResult === "ID_CONFLICT") {
      return { status: "ID_CONFLICT" };
    }

    const existingProposal =
      await this.dependencies.proposalRepository.findById(proposal.proposalId);
    return existingProposal
      ? { status: "ALREADY_EXISTS", proposal: existingProposal }
      : { status: "PERSISTENCE_INCONSISTENCY" };
  }
}
