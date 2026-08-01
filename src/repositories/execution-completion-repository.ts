import {
  dailyUsageLedgerEntrySchema,
  dailyUsageSchema,
  proposalSchema,
  type DailyUsageLedgerEntry,
  type Proposal,
} from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

export type ExecutionCompletionSaveResult =
  | "COMPLETED"
  | "ALREADY_COMPLETED"
  | "NOT_FOUND"
  | "STATUS_CONFLICT"
  | "SIGNATURE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT";

export class FirestoreExecutionCompletionRepository {
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly proposalsCollection = "proposals",
    private readonly dailyUsageCollection = "dailyUsage",
    private readonly usageLedgerCollection = "dailyUsageLedger",
  ) {}

  async complete(
    completedProposal: Proposal,
  ): Promise<ExecutionCompletionSaveResult> {
    const proposal = proposalSchema.parse(completedProposal);
    const ledgerEntry = this.createLedgerEntry(proposal);
    const proposalReference = this.database
      .collection(this.proposalsCollection)
      .doc(proposal.proposalId);
    const usageReference = this.database
      .collection(this.dailyUsageCollection)
      .doc(ledgerEntry.date);
    const ledgerReference = this.database
      .collection(this.usageLedgerCollection)
      .doc(ledgerEntry.executionId);

    return this.database.runTransaction(async (transaction) => {
      const currentDocument = await transaction.get(proposalReference);
      if (!currentDocument.exists) {
        return "NOT_FOUND";
      }
      const currentProposal = this.parseProposalDocument(
        currentDocument.id,
        currentDocument.data(),
      );
      if (currentProposal.status !== "SUBMITTED") {
        return this.isSameCompletion(currentProposal, proposal)
          ? "ALREADY_COMPLETED"
          : "STATUS_CONFLICT";
      }
      if (
        currentProposal.execution?.transactionSignature !==
        ledgerEntry.executionId
      ) {
        return "SIGNATURE_CONFLICT";
      }

      const ledgerDocument = await transaction.get(ledgerReference);
      if (ledgerDocument.exists) {
        this.parseLedgerDocument(
          ledgerDocument.id,
          ledgerDocument.data(),
        );
        return "IDEMPOTENCY_CONFLICT";
      }

      const usageDocument = await transaction.get(usageReference);
      const currentUsage = usageDocument.exists
        ? this.parseUsageDocument(usageDocument.id, usageDocument.data())
        : 0;
      transaction.set(proposalReference, proposal);
      transaction.set(ledgerReference, ledgerEntry);
      transaction.set(usageReference, {
        date: ledgerEntry.date,
        amountUsd: currentUsage + ledgerEntry.amountUsd,
        updatedAt: ledgerEntry.recordedAt,
      });
      return "COMPLETED";
    });
  }

  private createLedgerEntry(proposal: Proposal): DailyUsageLedgerEntry {
    const reconciliation = proposal.execution?.reconciliation;
    const transactionSignature = proposal.execution?.transactionSignature;
    const confirmedAt = proposal.execution?.confirmedAt;
    const validCompletion =
      (proposal.status === "RECONCILED" &&
        reconciliation?.status === "MATCHED") ||
      (proposal.status === "FAILED" &&
        reconciliation?.status === "MISMATCHED");
    if (
      !validCompletion ||
      !transactionSignature ||
      !confirmedAt ||
      proposal.amountUsd === undefined
    ) {
      throw new Error("Proposal does not contain a valid execution completion.");
    }

    return dailyUsageLedgerEntrySchema.parse({
      executionId: transactionSignature,
      date: confirmedAt.slice(0, 10),
      amountUsd: proposal.amountUsd,
      recordedAt: confirmedAt,
    });
  }

  private parseProposalDocument(documentId: string, data: unknown): Proposal {
    const proposal = proposalSchema.parse(data);
    if (proposal.proposalId !== documentId) {
      throw new Error(
        `Proposal document ID ${documentId} does not match proposalId ${proposal.proposalId}.`,
      );
    }
    return proposal;
  }

  private parseUsageDocument(documentId: string, data: unknown): number {
    const usage = dailyUsageSchema.parse(data);
    if (usage.date !== documentId) {
      throw new Error(
        `Daily usage document ID ${documentId} does not match date ${usage.date}.`,
      );
    }
    return usage.amountUsd;
  }

  private parseLedgerDocument(
    documentId: string,
    data: unknown,
  ): DailyUsageLedgerEntry {
    const entry = dailyUsageLedgerEntrySchema.parse(data);
    if (entry.executionId !== documentId) {
      throw new Error(
        `Daily usage ledger document ID ${documentId} does not match executionId ${entry.executionId}.`,
      );
    }
    return entry;
  }

  private isSameCompletion(
    currentProposal: Proposal,
    completedProposal: Proposal,
  ): boolean {
    return (
      currentProposal.status === completedProposal.status &&
      currentProposal.execution?.transactionSignature ===
        completedProposal.execution?.transactionSignature &&
      currentProposal.execution?.reconciliation?.status ===
        completedProposal.execution?.reconciliation?.status &&
      currentProposal.execution?.reconciliation?.actualDelta ===
        completedProposal.execution?.reconciliation?.actualDelta
    );
  }
}
