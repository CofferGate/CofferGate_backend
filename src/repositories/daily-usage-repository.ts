import {
  dailyUsageLedgerEntrySchema,
  dailyUsageSchema,
  type DailyUsageLedgerEntry,
} from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

export interface DailyUsageRepository {
  getUsageUsd(date: string): Promise<number>;
  recordConfirmedExecution(
    entry: DailyUsageLedgerEntry,
  ): Promise<DailyUsageRecordResult>;
}

export type DailyUsageRecordResult =
  | "RECORDED"
  | "ALREADY_RECORDED"
  | "IDEMPOTENCY_CONFLICT";

export class InMemoryDailyUsageRepository implements DailyUsageRepository {
  private readonly usageByDate: Map<string, number>;
  private readonly ledgerByExecutionId = new Map<
    string,
    DailyUsageLedgerEntry
  >();

  constructor(usageByDate: ReadonlyMap<string, number> = new Map()) {
    this.usageByDate = new Map(usageByDate);
  }

  async getUsageUsd(date: string): Promise<number> {
    const amountUsd = this.usageByDate.get(date) ?? 0;
    return dailyUsageSchema.shape.amountUsd.parse(amountUsd);
  }

  async recordConfirmedExecution(
    entry: DailyUsageLedgerEntry,
  ): Promise<DailyUsageRecordResult> {
    const validatedEntry = dailyUsageLedgerEntrySchema.parse(entry);
    const existingEntry = this.ledgerByExecutionId.get(
      validatedEntry.executionId,
    );
    if (existingEntry) {
      return this.entriesMatch(existingEntry, validatedEntry)
        ? "ALREADY_RECORDED"
        : "IDEMPOTENCY_CONFLICT";
    }

    const currentUsage = dailyUsageSchema.shape.amountUsd.parse(
      this.usageByDate.get(validatedEntry.date) ?? 0,
    );
    this.usageByDate.set(
      validatedEntry.date,
      currentUsage + validatedEntry.amountUsd,
    );
    this.ledgerByExecutionId.set(validatedEntry.executionId, validatedEntry);
    return "RECORDED";
  }

  private entriesMatch(
    existingEntry: DailyUsageLedgerEntry,
    newEntry: DailyUsageLedgerEntry,
  ): boolean {
    return (
      existingEntry.date === newEntry.date &&
      existingEntry.amountUsd === newEntry.amountUsd
    );
  }
}

export class FirestoreDailyUsageRepository implements DailyUsageRepository {
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly collectionName = "dailyUsage",
    private readonly ledgerCollectionName = "dailyUsageLedger",
  ) {}

  async getUsageUsd(date: string): Promise<number> {
    const document = await this.database
      .collection(this.collectionName)
      .doc(date)
      .get();
    if (!document.exists) {
      return 0;
    }

    return this.parseUsageDocument(document.id, document.data());
  }

  async recordConfirmedExecution(
    entry: DailyUsageLedgerEntry,
  ): Promise<DailyUsageRecordResult> {
    const validatedEntry = dailyUsageLedgerEntrySchema.parse(entry);
    const usageReference = this.database
      .collection(this.collectionName)
      .doc(validatedEntry.date);
    const ledgerReference = this.database
      .collection(this.ledgerCollectionName)
      .doc(validatedEntry.executionId);

    return this.database.runTransaction(async (transaction) => {
      const ledgerDocument = await transaction.get(ledgerReference);
      if (ledgerDocument.exists) {
        const existingEntry = dailyUsageLedgerEntrySchema.parse(
          ledgerDocument.data(),
        );
        if (existingEntry.executionId !== ledgerDocument.id) {
          throw new Error(
            `Daily usage ledger document ID ${ledgerDocument.id} does not match executionId ${existingEntry.executionId}.`,
          );
        }
        return existingEntry.date === validatedEntry.date &&
          existingEntry.amountUsd === validatedEntry.amountUsd
          ? "ALREADY_RECORDED"
          : "IDEMPOTENCY_CONFLICT";
      }

      const usageDocument = await transaction.get(usageReference);
      const currentUsage = usageDocument.exists
        ? this.parseUsageDocument(usageDocument.id, usageDocument.data())
        : 0;
      transaction.set(usageReference, {
        date: validatedEntry.date,
        amountUsd: currentUsage + validatedEntry.amountUsd,
        updatedAt: validatedEntry.recordedAt,
      });
      transaction.set(ledgerReference, validatedEntry);
      return "RECORDED";
    });
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
}
