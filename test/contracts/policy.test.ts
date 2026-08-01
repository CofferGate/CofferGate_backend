import assert from "node:assert/strict";
import test from "node:test";
import { policySchema } from "../../src/contracts/index.js";

const policy = {
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
} as const;

test("policy accepts the frontend v5 contract", () => {
  assert.equal(policySchema.safeParse(policy).success, true);
});

test("policy rejects negative limits and unsupported assets", () => {
  const result = policySchema.safeParse({
    ...policy,
    maxTransactionUsd: -1,
    allowedAssets: ["BTC"],
  });

  assert.equal(result.success, false);
});
