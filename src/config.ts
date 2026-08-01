import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  ENVIRONMENT: z.enum(["mock", "devnet", "mainnet-beta"]).default("devnet"),
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
  JUPITER_QUOTE_API_URL: z.url().default("https://api.jup.ag/swap/v1/quote"),
  JUPITER_SWAP_API_URL: z.url().default("https://api.jup.ag/swap/v1/swap"),
  JUPITER_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  MAX_PRIORITY_FEE_LAMPORTS: z.coerce.number().int().nonnegative().default(1_000_000),
  SIMULATION_COMPUTE_MARGIN_BPS: z.coerce.number().int().nonnegative().default(2_000),
  MAX_COMPUTE_UNITS: z.coerce.number().int().positive().default(1_400_000),
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
