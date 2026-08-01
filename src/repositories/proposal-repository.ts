import { z } from "zod";
import { proposalSchema, type Proposal } from "../contracts/index.js";

export interface ProposalRepository {
  list(): Promise<Proposal[]>;
  findById(proposalId: string): Promise<Proposal | null>;
}

export class InMemoryProposalRepository implements ProposalRepository {
  private readonly proposals: Map<string, Proposal>;

  constructor(proposals: Proposal[] = []) {
    const validatedProposals = z.array(proposalSchema).parse(proposals);
    this.proposals = new Map(
      validatedProposals.map((proposal) => [proposal.proposalId, proposal]),
    );
  }

  async list(): Promise<Proposal[]> {
    return Array.from(this.proposals.values());
  }

  async findById(proposalId: string): Promise<Proposal | null> {
    return this.proposals.get(proposalId) ?? null;
  }
}
