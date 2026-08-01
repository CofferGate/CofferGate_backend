import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  ENVIRONMENT: z.enum(["mock", "devnet", "mainnet-beta"]).default("devnet"),
  DATA_MODE: z.enum(["mock", "live"]).default("live"),
  OPERATIONS_WALLET_ADDRESS: z.string().default("unconfigured"),
  SOLANA_RPC_URL: z.url().default("https://api.devnet.solana.com"),
  SOLANA_RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  REPOSITORY_MODE: z.enum(["memory", "firestore"]).default("memory"),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  FIRESTORE_DATABASE_ID: z.string().min(1).default("(default)"),
  FIRESTORE_PROPOSALS_COLLECTION: z.string().min(1).default("proposals"),
  FIRESTORE_POLICIES_COLLECTION: z.string().min(1).default("policies"),
  FIRESTORE_CURRENT_POLICY_DOCUMENT: z.string().min(1).default("current"),
  FIRESTORE_DAILY_USAGE_COLLECTION: z.string().min(1).default("dailyUsage"),
  FIRESTORE_DAILY_USAGE_LEDGER_COLLECTION: z
    .string()
    .min(1)
    .default("dailyUsageLedger"),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return configSchema.parse(environment);
}
