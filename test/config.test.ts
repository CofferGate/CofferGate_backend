import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("configuration has Cloud Run compatible defaults", () => {
  assert.deepEqual(loadConfig({}), {
    PORT: 8080,
    HOST: "0.0.0.0",
    ENVIRONMENT: "devnet",
    DATA_MODE: "live",
    OPERATIONS_WALLET_ADDRESS: "unconfigured",
    SOLANA_RPC_URL: "https://api.devnet.solana.com",
    SOLANA_RPC_TIMEOUT_MS: 5000,
    SOL_MINT: "So11111111111111111111111111111111111111112",
    USDC_MINT: undefined,
    USDC_TOKEN_ACCOUNT: undefined,
    TARGET_USDC_BALANCE: undefined,
    PROPOSAL_TTL_SECONDS: 300,
    JUPITER_API_KEY: undefined,
    JUPITER_PRICE_API_URL: "https://api.jup.ag/price/v3",
    JUPITER_QUOTE_API_URL: "https://api.jup.ag/swap/v1/quote",
    JUPITER_SWAP_API_URL: "https://api.jup.ag/swap/v1/swap",
    JUPITER_TIMEOUT_MS: 5000,
    MAX_PRIORITY_FEE_LAMPORTS: 1000000,
    SIMULATION_COMPUTE_MARGIN_BPS: 2000,
    MAX_COMPUTE_UNITS: 1400000,
    CLOUD_KMS_KEY_VERSION: undefined,
    INTERNAL_TASK_TOKEN: undefined,
    CLOUD_TASKS_LOCATION: undefined,
    CLOUD_TASKS_QUEUE: undefined,
    CLOUD_TASKS_TARGET_BASE_URL: undefined,
    CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL: undefined,
    CLOUD_TASKS_SCHEDULE_DELAY_SECONDS: 5,
    REPOSITORY_MODE: "memory",
    GOOGLE_CLOUD_PROJECT: undefined,
    VERTEX_AI_LOCATION: "us-central1",
    VERTEX_AI_MODEL: "gemini-2.5-flash",
    FIRESTORE_DATABASE_ID: "(default)",
    FIRESTORE_PROPOSALS_COLLECTION: "proposals",
    FIRESTORE_POLICIES_COLLECTION: "policies",
    FIRESTORE_CURRENT_POLICY_DOCUMENT: "current",
    FIRESTORE_DAILY_USAGE_COLLECTION: "dailyUsage",
    FIRESTORE_DAILY_USAGE_LEDGER_COLLECTION: "dailyUsageLedger",
  });
});

test("configuration rejects invalid environments", () => {
  assert.throws(() => loadConfig({ ENVIRONMENT: "production" }));
});
