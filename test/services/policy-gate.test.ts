import assert from "node:assert/strict";
import test from "node:test";
import type { Policy, Proposal } from "../../src/contracts/index.js";
import { proposalSchema } from "../../src/contracts/index.js";
import { PolicyGateService } from "../../src/services/policy-gate.js";

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
  allowedPrograms: [],
  allowedSigners: [],
  simulationRequired: true,
  circuitBreakerParameters: null,
  circuitBreakerStatus: "ACTIVE",
};

const proposal: Proposal = {
  proposalId: "proposal_01",
  action: "SWAP",
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  amountUsd: 4.83,
  rationale: "Restore the target USDC operations balance.",
  confidence: 0.91,
  evidenceRefs: [],
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  policyVersion: "policy-2026.08.1",
  status: "AI_REVIEWED",
  ruleChecks: [],
};

const now = new Date("2026-08-01T06:01:00.000Z");

function createService(currentPolicy: Policy | null = policy) {
  return new PolicyGateService({
    async getCurrentPolicy() {
      return currentPolicy;
    },
  });
}

test("Policy Gate approves a proposal only when every rule passes", async () => {
  const result = await createService().evaluate(proposal, {
    dailyUsageUsd: 10,
    now,
  });

  assert.equal(result.decision, "AUTO");
  assert.equal(result.status, "POLICY_APPROVED");
  assert.equal(result.ruleChecks.every((check) => check.result === "PASS"), true);
  assert.equal(proposalSchema.safeParse(result).success, true);
});

test("Policy Gate blocks transaction and daily limit violations", async () => {
  const result = await createService().evaluate(
    { ...proposal, amountUsd: 6 },
    { dailyUsageUsd: 15, now },
  );

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.execution?.kmsRequested, false);
  assert.equal(
    result.ruleChecks.find((check) => check.code === "MAX_TRANSACTION_USD")
      ?.result,
    "FAIL",
  );
  assert.equal(
    result.ruleChecks.find((check) => check.code === "DAILY_LIMIT_USD")
      ?.result,
    "FAIL",
  );
});

test("Policy Gate blocks expired and stale-policy proposals", async () => {
  const result = await createService().evaluate(
    {
      ...proposal,
      expiresAt: "2026-08-01T06:00:00.000Z",
      policyVersion: "policy-old",
    },
    { dailyUsageUsd: 0, now },
  );

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.execution?.kmsRequested, false);
  assert.equal(
    result.ruleChecks.find((check) => check.code === "PROPOSAL_NOT_EXPIRED")
      ?.result,
    "FAIL",
  );
  assert.equal(
    result.ruleChecks.find((check) => check.code === "POLICY_VERSION")?.result,
    "FAIL",
  );
});

test("Policy Gate blocks missing policy and halted circuit breaker", async () => {
  const missingPolicy = await createService(null).evaluate(proposal, {
    dailyUsageUsd: 0,
    now,
  });
  const halted = await createService({
    ...policy,
    circuitBreakerStatus: "HALTED",
  }).evaluate(proposal, { dailyUsageUsd: 0, now });

  assert.equal(missingPolicy.decision, "BLOCK");
  assert.equal(missingPolicy.execution?.kmsRequested, false);
  assert.equal(halted.decision, "BLOCK");
  assert.equal(halted.execution?.kmsRequested, false);
});

test("Policy Gate blocks incomplete or non-allowlisted swap fields", async () => {
  const result = await createService().evaluate(
    {
      ...proposal,
      inputMint: undefined,
      outputMint: "unsupported",
      amountUsd: undefined,
    },
    { dailyUsageUsd: 0, now },
  );

  assert.equal(result.decision, "BLOCK");
  assert.equal(result.execution?.kmsRequested, false);
  assert.equal(
    result.ruleChecks.find((check) => check.code === "INPUT_MINT_PRESENT")
      ?.result,
    "FAIL",
  );
  assert.equal(
    result.ruleChecks.find((check) => check.code === "OUTPUT_MINT_ALLOWLIST")
      ?.result,
    "FAIL",
  );
});

test("Policy Gate rejects invalid usage and discards stale execution data", async () => {
  const result = await createService().evaluate(
    {
      ...proposal,
      execution: {
        kmsRequested: true,
        transactionSignature: "stale-signature",
      },
    },
    { dailyUsageUsd: -1, now },
  );

  assert.equal(result.decision, "BLOCK");
  assert.deepEqual(result.execution, { kmsRequested: false });
  assert.equal(
    result.ruleChecks.find((check) => check.code === "DAILY_USAGE_VALID")
      ?.result,
    "FAIL",
  );
});
