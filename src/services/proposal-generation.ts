import { createHash } from "node:crypto";
import type { Proposal } from "../contracts/index.js";
import type { VertexProposalGenerationInput } from "../providers/vertex-proposal.js";
import type { ProposalRepository } from "../repositories/proposal-repository.js";
import type { ProposalSuppressionRepository } from "../repositories/proposal-suppression-repository.js";

export interface ProposalGenerator {
  generate(input: VertexProposalGenerationInput): Promise<Proposal>;
}

export interface ProposalGenerationDependencies {
  proposalGenerator: ProposalGenerator;
  proposalRepository: ProposalRepository;
  proposalSuppressionRepository: ProposalSuppressionRepository;
  duplicateCooldownSeconds: number;
  now?: () => Date;
}

export type ProposalGenerationResult =
  | { status: "CREATED"; proposal: Proposal }
  | { status: "ALREADY_EXISTS"; proposal: Proposal }
  | { status: "DUPLICATE_SUPPRESSED"; fingerprint: string }
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
    const fingerprint = proposalFingerprint(proposal);
    const suppressionResult =
      await this.dependencies.proposalSuppressionRepository.claim(
        fingerprint,
        (this.dependencies.now ?? (() => new Date()))(),
        this.dependencies.duplicateCooldownSeconds,
      );
    if (suppressionResult === "SUPPRESSED") {
      return { status: "DUPLICATE_SUPPRESSED", fingerprint };
    }
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

export function proposalFingerprint(proposal: Proposal): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action: proposal.action,
        inputSymbol: proposal.inputSymbol ?? null,
        outputSymbol: proposal.outputSymbol ?? null,
        inputMint: proposal.inputMint ?? null,
        outputMint: proposal.outputMint ?? null,
        amountUsd: proposal.amountUsd ?? null,
        policyVersion: proposal.policyVersion,
      }),
    )
    .digest("hex");
}
