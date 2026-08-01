import { z } from "zod";

export const dailyUsageSchema = z.object({
  date: z.iso.date(),
  amountUsd: z.number().nonnegative().finite(),
  updatedAt: z.string().datetime(),
});

export type DailyUsage = z.infer<typeof dailyUsageSchema>;
