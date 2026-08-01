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
    REPOSITORY_MODE: "memory",
    GOOGLE_CLOUD_PROJECT: undefined,
    FIRESTORE_DATABASE_ID: "(default)",
    FIRESTORE_PROPOSALS_COLLECTION: "proposals",
    FIRESTORE_POLICIES_COLLECTION: "policies",
    FIRESTORE_CURRENT_POLICY_DOCUMENT: "current",
    FIRESTORE_DAILY_USAGE_COLLECTION: "dailyUsage",
  });
});

test("configuration rejects invalid environments", () => {
  assert.throws(() => loadConfig({ ENVIRONMENT: "production" }));
});
