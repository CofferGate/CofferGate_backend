import assert from "node:assert/strict";
import test from "node:test";
import type { Policy, Proposal } from "../../src/contracts/index.js";
import { InMemoryDailyUsageRepository } from "../../src/repositories/daily-usage-repository.js";
import {
  InMemoryProposalRepository,
  type ProposalRepository,
} from "../../src/repositories/proposal-repository.js";
import { PolicyGateService } from "../../src/services/policy-gate.js";
import { ProposalPolicyEvaluationService } from "../../src/services/proposal-policy-evaluation.js";

const policy: Policy = {
  policyVersion: "policy-2026.08.1",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  allowedInputMints: ["input-mint"],
  allowedOutputMints: ["output-mint"],
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
  inputMint: "input-mint",
  outputMint: "output-mint",
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  amountUsd: 4,
  rationale: "Restore the operations balance.",
  confidence: 0.9,
  evidenceRefs: [],
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  policyVersion: policy.policyVersion,
  status: "AI_REVIEWED",
  ruleChecks: [],
};

const context = {
  now: new Date("2026-08-01T06:01:00.000Z"),
};

function createService(
  repository: ProposalRepository,
  dailyUsageUsd = 10,
) {
  return new ProposalPolicyEvaluationService({
    proposalRepository: repository,
    dailyUsageRepository: new InMemoryDailyUsageRepository(
      new Map([["2026-08-01", dailyUsageUsd]]),
    ),
    policyGate: new PolicyGateService({
      async getCurrentPolicy() {
        return policy;
      },
    }),
  });
}

test("proposal policy evaluation persists an approved transition", async () => {
  const repository = new InMemoryProposalRepository([proposal]);
  const result = await createService(repository).evaluate(
    proposal.proposalId,
    context,
  );

  assert.equal(result.status, "EVALUATED");
  assert.equal(
    (await repository.findById(proposal.proposalId))?.status,
    "POLICY_APPROVED",
  );
});

test("proposal policy evaluation uses server-side daily usage", async () => {
  const repository = new InMemoryProposalRepository([proposal]);
  const result = await createService(repository, 17).evaluate(
    proposal.proposalId,
    context,
  );

  assert.equal(result.status, "EVALUATED");
  if (result.status === "EVALUATED") {
    assert.equal(result.proposal.decision, "BLOCK");
    assert.equal(
      result.proposal.ruleChecks.find(
        (check) => check.code === "DAILY_LIMIT_USD",
      )?.result,
      "FAIL",
    );
  }
});

test("proposal policy evaluation rejects invalid and duplicate states", async () => {
  const repository = new InMemoryProposalRepository([
    { ...proposal, status: "PROPOSED" },
  ]);
  const service = createService(repository);

  assert.deepEqual(await service.evaluate(proposal.proposalId, context), {
    status: "INVALID_STATE",
  });
});

test("proposal policy evaluation reports missing and concurrent changes", async () => {
  const emptyRepository = new InMemoryProposalRepository();
  assert.deepEqual(
    await createService(emptyRepository).evaluate(proposal.proposalId, context),
    { status: "NOT_FOUND" },
  );

  const conflictingRepository: ProposalRepository = {
    async list() {
      return [proposal];
    },
    async findById() {
      return proposal;
    },
    async savePolicyEvaluation() {
      return "STATUS_CONFLICT";
    },
  };
  assert.deepEqual(
    await createService(conflictingRepository).evaluate(
      proposal.proposalId,
      context,
    ),
    { status: "CONFLICT" },
  );
});
