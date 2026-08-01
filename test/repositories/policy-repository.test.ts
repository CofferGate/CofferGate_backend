import assert from "node:assert/strict";
import test from "node:test";
import type { Policy } from "../../src/contracts/index.js";
import { InMemoryPolicyRepository } from "../../src/repositories/policy-repository.js";

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

test("policy repository returns the validated current policy", async () => {
  const repository = new InMemoryPolicyRepository(policy);

  assert.deepEqual(await repository.getCurrent(), policy);
});

test("policy repository can represent an unconfigured policy", async () => {
  const repository = new InMemoryPolicyRepository();

  assert.equal(await repository.getCurrent(), null);
});

test("policy repository rejects invalid policy records", () => {
  assert.throws(
    () =>
      new InMemoryPolicyRepository({
        ...policy,
        maxTransactionUsd: -1,
      }),
  );
});
