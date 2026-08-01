import assert from "node:assert/strict";
import test from "node:test";
import type { Proposal } from "../../src/contracts/index.js";
import { ExecutionSubmissionWorkflow } from "../../src/services/execution-submission-workflow.js";
import { ExecutionSimulationService } from "../../src/services/execution-simulation.js";

const proposal: Proposal = {
  proposalId: "proposal-1",
  action: "SWAP",
  inputMint: "sol-mint",
  outputMint: "usdc-mint",
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  amountAtomic: "100000000",
  amountUsd: 15,
  rationale: "rebalance",
  confidence: 0.9,
  evidenceRefs: [],
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  policyVersion: "policy-1",
  decision: "AUTO",
  status: "POLICY_APPROVED",
  ruleChecks: [],
};

const policy = {
  policyVersion: "policy-1", effectiveFrom: null,
  allowedInputMints: ["sol-mint"], allowedOutputMints: ["usdc-mint"],
  allowedAssets: ["SOL", "USDC"] as const, maxTransactionUsd: 20, dailyLimitUsd: 100,
  minimumReserve: { amount: 0, asset: "SOL" as const }, maxSlippageBps: 100,
  maxPriceImpactBps: 10, quoteMaxAgeSeconds: 15, allowedPrograms: [], allowedSigners: [],
  simulationRequired: true, circuitBreakerParameters: null, circuitBreakerStatus: "ACTIVE" as const,
};

function createWorkflow(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  let claimedExecution: unknown;
  const dependencies = {
    proposalRepository: { findById: async () => proposal },
    policyRepository: { getCurrent: async () => policy },
    submissionRepository: {
      claim: async (_id: string, execution: unknown) => {
        events.push("claim"); claimedExecution = execution; return "CLAIMED" as const;
      },
      markSubmitted: async () => { events.push("persist"); return "SUBMITTED" as const; },
    },
    quoteProvider: { getExactInQuote: async () => ({
      routeLabel: "Meteora", inputAmountAtomic: "100000000",
      expectedOutputAmountAtomic: "15000000", minimumOutputAmountAtomic: "14850000",
      slippageBps: 100, priceImpactBps: 2, contextSlot: 42, response: {},
    }) },
    swapProvider: { createUnsignedTransaction: async () => ({
      serializedTransaction: Buffer.from([1]), lastValidBlockHeight: 100,
      prioritizationFeeLamports: 10,
    }) },
    simulationService: new ExecutionSimulationService(
      { simulateTransaction: async () => ({ ok: true as const, slot: 42, unitsConsumed: 100, logs: [], replacementBlockhash: undefined, lastValidBlockHeight: undefined }) },
      { computeUnitMarginBps: 2_000, maxComputeUnits: 1_400_000 },
    ),
    signer: { signTransaction: async () => {
      events.push("sign");
      return { serializedTransaction: Buffer.from([2]), signature: Buffer.alloc(64, 1), kmsKeyVersion: "kms/key/1" };
    } },
    submitter: { sendTransaction: async () => { events.push("send"); return "signature-1"; } },
    balanceProvider: { getTokenBalance: async () => ({ amountAtomic: "5000000" }) },
    confirmationScheduler: { schedule: async () => { events.push("schedule"); } },
    outputTokenAccount: "usdc-account",
    now: () => new Date("2026-08-01T06:01:00.000Z"),
    ...overrides,
  };
  return { workflow: new ExecutionSubmissionWorkflow(dependencies as never), events, getClaim: () => claimedExecution };
}

test("execution submission claims before signing and schedules confirmation", async () => {
  const { workflow, events, getClaim } = createWorkflow();

  assert.deepEqual(await workflow.execute("proposal-1"), {
    status: "SUBMITTED", signature: "signature-1",
  });
  assert.deepEqual(events, ["claim", "sign", "send", "persist", "schedule"]);
  assert.equal((getClaim() as { beforeOutputBalanceAtomic: string }).beforeOutputBalanceAtomic, "5000000");
});

test("execution submission stops before signing on claim conflicts", async () => {
  const { workflow, events } = createWorkflow({
    submissionRepository: {
      claim: async () => "STATUS_CONFLICT" as const,
      markSubmitted: async () => "STATUS_CONFLICT" as const,
    },
  });

  assert.deepEqual(await workflow.execute("proposal-1"), { status: "CONFLICT" });
  assert.deepEqual(events, []);
});

test("execution submission rejects ineligible and failed simulations", async () => {
  const ineligible = createWorkflow({ proposalRepository: { findById: async () => ({ ...proposal, status: "BLOCKED" }) } });
  assert.deepEqual(await ineligible.workflow.execute("proposal-1"), { status: "NOT_EXECUTABLE" });

  const failed = createWorkflow({
    simulationService: new ExecutionSimulationService(
      { simulateTransaction: async () => ({ ok: false as const, slot: 42, error: "failed", unitsConsumed: 10, logs: [] }) },
      { computeUnitMarginBps: 2_000, maxComputeUnits: 1_400_000 },
    ),
  });
  assert.deepEqual(await failed.workflow.execute("proposal-1"), { status: "SIMULATION_FAILED" });
});

test("execution submission rechecks policy and quote risk before claiming", async () => {
  const halted = createWorkflow({
    policyRepository: { getCurrent: async () => ({ ...policy, circuitBreakerStatus: "HALTED" }) },
  });
  assert.deepEqual(await halted.workflow.execute("proposal-1"), { status: "POLICY_REJECTED" });

  const excessiveImpact = createWorkflow({
    quoteProvider: { getExactInQuote: async () => ({
      routeLabel: "Meteora", inputAmountAtomic: "100000000",
      expectedOutputAmountAtomic: "15000000", minimumOutputAmountAtomic: "14850000",
      slippageBps: 100, priceImpactBps: 11, contextSlot: 42, response: {},
    }) },
  });
  assert.deepEqual(await excessiveImpact.workflow.execute("proposal-1"), { status: "POLICY_REJECTED" });
  assert.deepEqual(excessiveImpact.events, []);
});
