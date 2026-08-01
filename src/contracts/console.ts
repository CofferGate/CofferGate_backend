import { z } from "zod";
import { apiMetaSchema } from "./api.js";
import { assetSymbolSchema } from "./enums.js";
import { circuitBreakerStatusSchema } from "./policy.js";

export const consoleSnapshotSchema = z.object({
  network: z.literal("devnet"),
  dataMode: z.enum(["mock", "live"]),
  circuitBreaker: circuitBreakerStatusSchema,
  operationsWallet: z.string(),
  balances: z.object({
    sol: z.string().optional(),
    usdc: z.string().optional(),
  }),
  targetUsdcBalance: z.string().optional(),
  dailyUsageUsd: z.number().nonnegative().optional(),
  dailyLimitUsd: z.number().nonnegative().optional(),
  policyVersion: z.string(),
  allowedAssets: z.array(assetSymbolSchema),
  lastSyncedAt: z.string().datetime().optional(),
  meta: apiMetaSchema,
});

export type ConsoleSnapshot = z.infer<typeof consoleSnapshotSchema>;
