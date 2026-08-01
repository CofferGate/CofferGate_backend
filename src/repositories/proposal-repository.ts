import { z } from "zod";
import {
  proposalSchema,
  type Proposal,
  type ProposalStatus,
} from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

export interface ProposalRepository {
  list(): Promise<Proposal[]>;
  findById(proposalId: string): Promise<Proposal | null>;
  savePolicyEvaluation(
    proposal: Proposal,
    expectedStatus: ProposalStatus,
  ): Promise<ProposalEvaluationSaveResult>;
}

export type ProposalEvaluationSaveResult =
  | "SAVED"
  | "NOT_FOUND"
  | "STATUS_CONFLICT";

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

  async savePolicyEvaluation(
    proposal: Proposal,
    expectedStatus: ProposalStatus,
  ): Promise<ProposalEvaluationSaveResult> {
    const validatedProposal = proposalSchema.parse(proposal);
    const reference = this.database
      .collection(this.collectionName)
      .doc(validatedProposal.proposalId);

    return this.database.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) {
        return "NOT_FOUND";
      }

      const currentProposal = this.parseDocument(document.id, document.data());
      if (currentProposal.status !== expectedStatus) {
        return "STATUS_CONFLICT";
      }

      transaction.set(reference, validatedProposal);
      return "SAVED";
    });
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

  async savePolicyEvaluation(
    proposal: Proposal,
    expectedStatus: ProposalStatus,
  ): Promise<ProposalEvaluationSaveResult> {
    const validatedProposal = proposalSchema.parse(proposal);
    const currentProposal = this.proposals.get(validatedProposal.proposalId);
    if (!currentProposal) {
      return "NOT_FOUND";
    }
    if (currentProposal.status !== expectedStatus) {
      return "STATUS_CONFLICT";
    }

    this.proposals.set(validatedProposal.proposalId, validatedProposal);
    return "SAVED";
  }
}
