import { z } from "zod";

export const dailyUsageSchema = z.object({
  date: z.iso.date(),
  amountUsd: z.number().nonnegative().finite(),
  updatedAt: z.string().datetime(),
});

export const dailyUsageLedgerEntrySchema = z.object({
  executionId: z.string().min(1),
  date: z.iso.date(),
  amountUsd: z.number().positive().finite(),
  recordedAt: z.string().datetime(),
});

export type DailyUsage = z.infer<typeof dailyUsageSchema>;
export type DailyUsageLedgerEntry = z.infer<
  typeof dailyUsageLedgerEntrySchema
>;
