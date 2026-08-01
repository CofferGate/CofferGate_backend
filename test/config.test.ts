import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("configuration has Cloud Run compatible defaults", () => {
  assert.deepEqual(loadConfig({}), {
    PORT: 8080,
    HOST: "0.0.0.0",
    LOG_LEVEL: undefined,
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
    JUPITER_TIMEOUT_MS: 5000,
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
  });
});

test("configuration rejects invalid environments", () => {
  assert.throws(() => loadConfig({ ENVIRONMENT: "production" }));
  assert.throws(() => loadConfig({ LOG_LEVEL: "verbose" }));
});

test("configuration rejects incomplete live Firestore runtimes", () => {
  assert.throws(
    () => loadConfig({ REPOSITORY_MODE: "firestore", DATA_MODE: "live" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /GOOGLE_CLOUD_PROJECT/);
      assert.match(error.message, /CLOUD_KMS_KEY_VERSION/);
      assert.match(error.message, /CLOUD_TASKS_TARGET_BASE_URL/);
      return true;
    },
  );
});

test("configuration accepts complete live Firestore runtimes", () => {
  const config = loadConfig({
    REPOSITORY_MODE: "firestore",
    DATA_MODE: "live",
    GOOGLE_CLOUD_PROJECT: "coffergate-devnet",
    OPERATIONS_WALLET_ADDRESS: "wallet-address",
    USDC_MINT: "usdc-mint",
    USDC_TOKEN_ACCOUNT: "usdc-token-account",
    TARGET_USDC_BALANCE: "20",
    JUPITER_API_KEY: "jupiter-key",
    CLOUD_KMS_KEY_VERSION:
      "projects/coffergate-devnet/locations/global/keyRings/coffergate/cryptoKeys/solana/cryptoKeyVersions/1",
    INTERNAL_TASK_TOKEN: "a-secure-internal-task-token-12345",
    CLOUD_TASKS_LOCATION: "asia-northeast3",
    CLOUD_TASKS_QUEUE: "execution",
    CLOUD_TASKS_TARGET_BASE_URL: "https://coffergate.example.com",
    CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL: "tasks@coffergate-devnet.iam.gserviceaccount.com",
  });

  assert.equal(config.REPOSITORY_MODE, "firestore");
  assert.equal(config.DATA_MODE, "live");
});

test("configuration permits partial integrations outside live Firestore runtime", () => {
  assert.equal(loadConfig({ REPOSITORY_MODE: "memory" }).REPOSITORY_MODE, "memory");
  assert.equal(
    loadConfig({ REPOSITORY_MODE: "firestore", DATA_MODE: "mock" }).DATA_MODE,
    "mock",
  );
});
