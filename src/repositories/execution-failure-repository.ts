import { proposalSchema, type Proposal } from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

export type ExecutionFailureSaveResult =
  | "FAILED"
  | "ALREADY_FAILED"
  | "NOT_FOUND"
  | "STATUS_CONFLICT"
  | "SIGNATURE_CONFLICT";

export interface ExecutionFailureRepository {
  fail(
    proposalId: string,
    transactionSignature: string,
    message: string,
    observedAt: string,
  ): Promise<ExecutionFailureSaveResult>;
}

export class FirestoreExecutionFailureRepository
  implements ExecutionFailureRepository
{
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly collectionName = "proposals",
  ) {}

  async fail(
    proposalId: string,
    transactionSignature: string,
    message: string,
    observedAt: string,
  ): Promise<ExecutionFailureSaveResult> {
    const reference = this.database.collection(this.collectionName).doc(proposalId);
    return this.database.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) return "NOT_FOUND";
      const proposal = this.parseDocument(document.id, document.data());
      if (proposal.status === "FAILED") {
        return proposal.execution?.transactionSignature === transactionSignature &&
          proposal.execution.failure?.code === "ONCHAIN_TRANSACTION_FAILED"
          ? "ALREADY_FAILED"
          : "STATUS_CONFLICT";
      }
      if (proposal.status !== "SUBMITTED") return "STATUS_CONFLICT";
      if (proposal.execution?.transactionSignature !== transactionSignature) {
        return "SIGNATURE_CONFLICT";
      }
      const failedProposal = proposalSchema.parse({
        ...proposal,
        status: "FAILED",
        execution: {
          ...proposal.execution,
          failure: {
            code: "ONCHAIN_TRANSACTION_FAILED",
            message: message.slice(0, 1000),
            observedAt,
          },
        },
      });
      transaction.set(reference, failedProposal);
      return "FAILED";
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
