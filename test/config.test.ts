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
  });
});

test("configuration rejects invalid environments", () => {
  assert.throws(() => loadConfig({ ENVIRONMENT: "production" }));
});
