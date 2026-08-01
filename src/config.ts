import { z } from "zod";

const liveFirestoreRequirements = [
  "GOOGLE_CLOUD_PROJECT",
  "OPERATIONS_WALLET_ADDRESS",
  "USDC_MINT",
  "USDC_TOKEN_ACCOUNT",
  "TARGET_USDC_BALANCE",
  "JUPITER_API_KEY",
  "CLOUD_KMS_KEY_VERSION",
  "INTERNAL_TASK_TOKEN",
  "CLOUD_TASKS_LOCATION",
  "CLOUD_TASKS_QUEUE",
  "CLOUD_TASKS_TARGET_BASE_URL",
  "CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL",
] as const;

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  ENVIRONMENT: z.enum(["mock", "devnet"]).default("devnet"),
  DATA_MODE: z.enum(["mock", "live"]).default("live"),
  OPERATIONS_WALLET_ADDRESS: z.string().default("unconfigured"),
  SOLANA_RPC_URL: z.url().default("https://api.devnet.solana.com"),
  SOLANA_RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  SOL_MINT: z.string().min(1).default("So11111111111111111111111111111111111111112"),
  USDC_MINT: z.string().min(1).optional(),
  USDC_TOKEN_ACCOUNT: z.string().min(1).optional(),
  TARGET_USDC_BALANCE: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  PROPOSAL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  JUPITER_API_KEY: z.string().min(1).optional(),
  JUPITER_PRICE_API_URL: z.url().default("https://api.jup.ag/price/v3"),
  JUPITER_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  CLOUD_KMS_KEY_VERSION: z.string().min(1).optional(),
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
});

const validatedConfigSchema = configSchema.superRefine((config, context) => {
  if (config.REPOSITORY_MODE !== "firestore" || config.DATA_MODE !== "live") {
    return;
  }

  for (const field of liveFirestoreRequirements) {
    const value = config[field];
    if (value === undefined || value === "unconfigured") {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} is required for a live Firestore runtime`,
      });
    }
  }
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const config = configSchema.parse(environment);
  validatedConfigSchema.parse(config);
  return config;
}
