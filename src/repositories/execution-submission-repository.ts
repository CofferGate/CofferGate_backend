import { proposalSchema, type ExecutionSummary, type Proposal } from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

export type ExecutionClaimResult = "CLAIMED" | "NOT_FOUND" | "STATUS_CONFLICT";
export type ExecutionSubmissionSaveResult =
  | "SUBMITTED"
  | "ALREADY_SUBMITTED"
  | "NOT_FOUND"
  | "STATUS_CONFLICT"
  | "SIGNATURE_CONFLICT";

export interface ExecutionSubmissionRepository {
  claim(proposalId: string, execution: ExecutionSummary): Promise<ExecutionClaimResult>;
  markSubmitted(
    proposalId: string,
    execution: ExecutionSummary,
  ): Promise<ExecutionSubmissionSaveResult>;
}

export class FirestoreExecutionSubmissionRepository
  implements ExecutionSubmissionRepository
{
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly collectionName = "proposals",
  ) {}

  async claim(
    proposalId: string,
    execution: ExecutionSummary,
  ): Promise<ExecutionClaimResult> {
    const reference = this.database.collection(this.collectionName).doc(proposalId);
    return this.database.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) return "NOT_FOUND";
      const proposal = this.parseDocument(document.id, document.data());
      if (proposal.status !== "POLICY_APPROVED" || proposal.decision !== "AUTO") {
        return "STATUS_CONFLICT";
      }
      transaction.set(reference, proposalSchema.parse({
        ...proposal,
        status: "EXECUTING",
        execution,
      }));
      return "CLAIMED";
    });
  }

  async markSubmitted(
    proposalId: string,
    execution: ExecutionSummary,
  ): Promise<ExecutionSubmissionSaveResult> {
    const reference = this.database.collection(this.collectionName).doc(proposalId);
    return this.database.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) return "NOT_FOUND";
      const proposal = this.parseDocument(document.id, document.data());
      if (proposal.status === "SUBMITTED") {
        return proposal.execution?.transactionSignature === execution.transactionSignature
          ? "ALREADY_SUBMITTED"
          : "SIGNATURE_CONFLICT";
      }
      if (proposal.status !== "EXECUTING") return "STATUS_CONFLICT";
      transaction.set(reference, proposalSchema.parse({
        ...proposal,
        status: "SUBMITTED",
        execution,
      }));
      return "SUBMITTED";
    });
  }

  private parseDocument(documentId: string, data: unknown): Proposal {
    const proposal = proposalSchema.parse(data);
    if (proposal.proposalId !== documentId) {
      throw new Error(`Proposal document ID ${documentId} does not match proposalId ${proposal.proposalId}.`);
    }
    return proposal;
  }
}
