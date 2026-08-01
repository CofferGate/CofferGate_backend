import { dailyUsageSchema } from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

export interface DailyUsageRepository {
  getUsageUsd(date: string): Promise<number>;
}

export class InMemoryDailyUsageRepository implements DailyUsageRepository {
  private readonly usageByDate: Map<string, number>;

  constructor(usageByDate: ReadonlyMap<string, number> = new Map()) {
    this.usageByDate = new Map(usageByDate);
  }

  async getUsageUsd(date: string): Promise<number> {
    const amountUsd = this.usageByDate.get(date) ?? 0;
    return dailyUsageSchema.shape.amountUsd.parse(amountUsd);
  }
}

export class FirestoreDailyUsageRepository implements DailyUsageRepository {
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly collectionName = "dailyUsage",
  ) {}

  async getUsageUsd(date: string): Promise<number> {
    const document = await this.database
      .collection(this.collectionName)
      .doc(date)
      .get();
    if (!document.exists) {
      return 0;
    }

    const usage = dailyUsageSchema.parse(document.data());
    if (usage.date !== document.id) {
      throw new Error(
        `Daily usage document ID ${document.id} does not match date ${usage.date}.`,
      );
    }
    return usage.amountUsd;
  }
}
