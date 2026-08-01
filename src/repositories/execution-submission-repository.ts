import { z } from "zod";
import { executionSummarySchema, proposalSchema, type ExecutionSummary, type Proposal } from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

const executionIntentSchema = z.object({
  proposalId: z.string().min(1),
  serializedTransactionBase64: z.string().min(1),
  transactionSignature: z.string().min(1),
  minContextSlot: z.number().int().nonnegative(),
  lastValidBlockHeight: z.number().int().positive(),
  execution: executionSummarySchema,
  preparedAt: z.string().datetime(),
});

export type ExecutionIntent = z.infer<typeof executionIntentSchema>;
export type ExecutionPrepareResult =
  | { status: "PREPARED" | "ALREADY_PREPARED"; intent: ExecutionIntent }
  | { status: "NOT_FOUND" | "STATUS_CONFLICT" };
export type ExecutionSubmissionSaveResult =
  | "SUBMITTED" | "ALREADY_SUBMITTED" | "EXPIRED" | "NOT_FOUND"
  | "STATUS_CONFLICT" | "SIGNATURE_CONFLICT";

export interface ExecutionSubmissionRepository {
  prepare(proposalId: string, intent: ExecutionIntent): Promise<ExecutionPrepareResult>;
  findPrepared(proposalId: string): Promise<ExecutionIntent | null>;
  expire(proposalId: string, transactionSignature: string, observedAt: string): Promise<ExecutionSubmissionSaveResult>;
  markSubmitted(proposalId: string, execution: ExecutionSummary): Promise<ExecutionSubmissionSaveResult>;
}

export class FirestoreExecutionSubmissionRepository implements ExecutionSubmissionRepository {
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly proposalsCollection = "proposals",
    private readonly intentsCollection = "executionIntents",
  ) {}

  async prepare(proposalId: string, value: ExecutionIntent): Promise<ExecutionPrepareResult> {
    const intent = executionIntentSchema.parse(value);
    if (intent.proposalId !== proposalId) throw new Error("Execution intent proposal ID does not match.");
    const proposalReference = this.database.collection(this.proposalsCollection).doc(proposalId);
    const intentReference = this.database.collection(this.intentsCollection).doc(proposalId);
    return this.database.runTransaction(async (transaction) => {
      const proposalDocument = await transaction.get(proposalReference);
      if (!proposalDocument.exists) return { status: "NOT_FOUND" };
      const proposal = this.parseProposal(proposalDocument.id, proposalDocument.data());
      const intentDocument = await transaction.get(intentReference);
      if (proposal.status === "EXECUTING" && intentDocument.exists) {
        return { status: "ALREADY_PREPARED", intent: this.parseIntent(intentDocument.id, intentDocument.data()) };
      }
      if (proposal.status !== "POLICY_APPROVED" || proposal.decision !== "AUTO" || intentDocument.exists) {
        return { status: "STATUS_CONFLICT" };
      }
      transaction.set(proposalReference, proposalSchema.parse({
        ...proposal, status: "EXECUTING", execution: intent.execution,
      }));
      transaction.set(intentReference, intent);
      return { status: "PREPARED", intent };
    });
  }

  async findPrepared(proposalId: string): Promise<ExecutionIntent | null> {
    const document = await this.database.collection(this.intentsCollection).doc(proposalId).get();
    return document.exists ? this.parseIntent(document.id, document.data()) : null;
  }

  async markSubmitted(proposalId: string, execution: ExecutionSummary): Promise<ExecutionSubmissionSaveResult> {
    const proposalReference = this.database.collection(this.proposalsCollection).doc(proposalId);
    const intentReference = this.database.collection(this.intentsCollection).doc(proposalId);
    return this.database.runTransaction(async (transaction) => {
      const proposalDocument = await transaction.get(proposalReference);
      if (!proposalDocument.exists) return "NOT_FOUND";
      const proposal = this.parseProposal(proposalDocument.id, proposalDocument.data());
      if (proposal.status === "SUBMITTED") {
        return proposal.execution?.transactionSignature === execution.transactionSignature
          ? "ALREADY_SUBMITTED" : "SIGNATURE_CONFLICT";
      }
      if (proposal.status !== "EXECUTING") return "STATUS_CONFLICT";
      const intentDocument = await transaction.get(intentReference);
      if (!intentDocument.exists) return "STATUS_CONFLICT";
      const intent = this.parseIntent(intentDocument.id, intentDocument.data());
      if (intent.transactionSignature !== execution.transactionSignature) return "SIGNATURE_CONFLICT";
      transaction.set(proposalReference, proposalSchema.parse({
        ...proposal, status: "SUBMITTED", execution,
      }));
      return "SUBMITTED";
    });
  }

  async expire(
    proposalId: string,
    transactionSignature: string,
    observedAt: string,
  ): Promise<ExecutionSubmissionSaveResult> {
    const proposalReference = this.database.collection(this.proposalsCollection).doc(proposalId);
    const intentReference = this.database.collection(this.intentsCollection).doc(proposalId);
    return this.database.runTransaction(async (transaction) => {
      const proposalDocument = await transaction.get(proposalReference);
      if (!proposalDocument.exists) return "NOT_FOUND";
      const proposal = this.parseProposal(proposalDocument.id, proposalDocument.data());
      if (proposal.status !== "EXECUTING") return "STATUS_CONFLICT";
      const intentDocument = await transaction.get(intentReference);
      if (!intentDocument.exists) return "STATUS_CONFLICT";
      const intent = this.parseIntent(intentDocument.id, intentDocument.data());
      if (intent.transactionSignature !== transactionSignature) return "SIGNATURE_CONFLICT";
      transaction.set(proposalReference, proposalSchema.parse({
        ...proposal,
        status: "FAILED",
        execution: {
          ...intent.execution,
          transactionSignature,
          failure: {
            code: "TRANSACTION_BLOCKHASH_EXPIRED",
            message: "The prepared transaction expired before submission.",
            observedAt,
          },
        },
      }));
      return "EXPIRED";
    });
  }

  private parseProposal(documentId: string, data: unknown): Proposal {
    const proposal = proposalSchema.parse(data);
    if (proposal.proposalId !== documentId) throw new Error(`Proposal document ID ${documentId} does not match proposalId ${proposal.proposalId}.`);
    return proposal;
  }

  private parseIntent(documentId: string, data: unknown): ExecutionIntent {
    const intent = executionIntentSchema.parse(data);
    if (intent.proposalId !== documentId) throw new Error(`Execution intent document ID ${documentId} does not match proposalId ${intent.proposalId}.`);
    return intent;
  }
}
