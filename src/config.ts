import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  ENVIRONMENT: z.enum(["mock", "devnet", "mainnet-beta"]).default("devnet"),
  DATA_MODE: z.enum(["mock", "live"]).default("live"),
  OPERATIONS_WALLET_ADDRESS: z.string().default("unconfigured"),
  SOLANA_RPC_URL: z.url().default("https://api.devnet.solana.com"),
  SOLANA_RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  INTERNAL_TASK_TOKEN: z.string().min(32).optional(),
  CLOUD_TASKS_LOCATION: z.string().min(1).optional(),
  CLOUD_TASKS_QUEUE: z.string().min(1).optional(),
  CLOUD_TASKS_TARGET_BASE_URL: z.url().optional(),
  CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL: z.email().optional(),
  CLOUD_TASKS_SCHEDULE_DELAY_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(5),
  REPOSITORY_MODE: z.enum(["memory", "firestore"]).default("memory"),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  VERTEX_AI_LOCATION: z.string().min(1).default("us-central1"),
  VERTEX_AI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
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
