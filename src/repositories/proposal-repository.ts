import { z } from "zod";
import { proposalSchema, type Proposal } from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

export interface ProposalRepository {
  list(): Promise<Proposal[]>;
  findById(proposalId: string): Promise<Proposal | null>;
}

export class FirestoreProposalRepository implements ProposalRepository {
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly collectionName = "proposals",
  ) {}

  async list(): Promise<Proposal[]> {
    const snapshot = await this.database.collection(this.collectionName).get();
    return snapshot.docs.map((document) =>
      this.parseDocument(document.id, document.data()),
    );
  }

  async findById(proposalId: string): Promise<Proposal | null> {
    const document = await this.database
      .collection(this.collectionName)
      .doc(proposalId)
      .get();

    return document.exists
      ? this.parseDocument(document.id, document.data())
      : null;
  }

  private parseDocument(documentId: string, data: unknown): Proposal {
    const proposal = proposalSchema.parse(data);
    if (proposal.proposalId !== documentId) {
      throw new Error(
        `Proposal document ID ${documentId} does not match proposalId ${proposal.proposalId}.`,
      );
    }
    return proposal;
  }
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
