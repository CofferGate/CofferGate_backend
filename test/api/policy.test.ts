import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import {
  apiResponseSchema,
  policySchema,
  type Policy,
} from "../../src/contracts/index.js";
import { InMemoryPolicyRepository } from "../../src/repositories/policy-repository.js";

const config = {
  PORT: 8080,
  HOST: "0.0.0.0",
  ENVIRONMENT: "devnet",
  DATA_MODE: "live",
  OPERATIONS_WALLET_ADDRESS: "unconfigured",
} as const;

const policy: Policy = {
  policyVersion: "policy-2026.08.1",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  allowedInputMints: ["So11111111111111111111111111111111111111112"],
  allowedOutputMints: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  allowedAssets: ["SOL", "USDC"],
  maxTransactionUsd: 5,
  dailyLimitUsd: 20,
  minimumReserve: { amount: 0.01, asset: "SOL" },
  maxSlippageBps: 50,
  maxPriceImpactBps: 100,
  quoteMaxAgeSeconds: 15,
  allowedPrograms: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
  allowedSigners: ["OperationsWallet111111111111111111111111111"],
  simulationRequired: true,
  circuitBreakerParameters: { maxConsecutiveFailures: 3 },
  circuitBreakerStatus: "ACTIVE",
};

test("GET /api/v1/policy/current returns the current policy", async () => {
  const app = createApp({
    config,
    policyRepository: new InMemoryPolicyRepository(policy),
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/policy/current",
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(
    apiResponseSchema(policySchema.nullable()).safeParse(body).success,
    true,
  );
  assert.equal(body.data.policyVersion, policy.policyVersion);
  assert.equal(body.meta.environment, "devnet");
  await app.close();
});

test("GET /api/v1/policy/current returns null when unconfigured", async () => {
  const app = createApp({ config });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/policy/current",
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.data, null);
  assert.equal(
    apiResponseSchema(policySchema.nullable()).safeParse(body).success,
    true,
  );
  await app.close();
});
