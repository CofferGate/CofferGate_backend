import assert from "node:assert/strict";
import test from "node:test";
import type { Policy, Proposal } from "../../src/contracts/index.js";
import type { VertexProposalGenerationInput } from "../../src/providers/vertex-proposal.js";
import { InMemoryDailyUsageRepository } from "../../src/repositories/daily-usage-repository.js";
import { InMemoryProposalRepository } from "../../src/repositories/proposal-repository.js";
import { PolicyGateService } from "../../src/services/policy-gate.js";
import { ProposalGenerationEvaluationService } from "../../src/services/proposal-generation-evaluation.js";
import { ProposalGenerationService } from "../../src/services/proposal-generation.js";
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

const input: VertexProposalGenerationInput = {
  proposalId: "proposal_01",
  policyVersion: policy.policyVersion,
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  solBalance: "1.25",
  usdcBalance: "10.00",
  targetUsdcBalance: "15.00",
  solPriceUsd: 200,
  assetMints: { SOL: "input-mint", USDC: "output-mint" },
  evidenceRefs: [],
};

const proposal: Proposal = {
  proposalId: input.proposalId,
  action: "SWAP",
  inputMint: input.assetMints.SOL,
  outputMint: input.assetMints.USDC,
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  amountUsd: 4,
  rationale: "Restore the operations balance.",
  confidence: 0.9,
  evidenceRefs: [],
  dataAsOf: input.dataAsOf,
  expiresAt: input.expiresAt,
  policyVersion: input.policyVersion,
  status: "AI_REVIEWED",
  ruleChecks: [],
};

const context = { now: new Date("2026-08-01T06:01:00.000Z") };

test("proposal workflow generates, persists, and evaluates one proposal", async () => {
  const repository = new InMemoryProposalRepository();
  const service = new ProposalGenerationEvaluationService({
    proposalGeneration: new ProposalGenerationService({
      proposalRepository: repository,
      proposalGenerator: {
        async generate() {
          return proposal;
        },
      },
    }),
    proposalPolicyEvaluation: new ProposalPolicyEvaluationService({
      proposalRepository: repository,
      dailyUsageRepository: new InMemoryDailyUsageRepository(),
      policyGate: new PolicyGateService({
        async getCurrentPolicy() {
          return policy;
        },
      }),
    }),
  });

  const result = await service.generateAndEvaluate(input, context);

  assert.equal(result.status, "EVALUATED");
  if (result.status === "EVALUATED") {
    assert.equal(result.proposal.status, "POLICY_APPROVED");
    assert.equal(result.proposal.decision, "AUTO");
  }
  assert.equal(
    (await repository.findById(proposal.proposalId))?.status,
    "POLICY_APPROVED",
  );
});

test("proposal workflow does not reevaluate a processed retry", async () => {
  const processedProposal: Proposal = {
    ...proposal,
    decision: "AUTO",
    status: "POLICY_APPROVED",
    ruleChecks: [],
  };
  let evaluationCalls = 0;
  const service = new ProposalGenerationEvaluationService({
    proposalGeneration: {
      async generate() {
        return { status: "ALREADY_EXISTS", proposal: processedProposal };
      },
    },
    proposalPolicyEvaluation: {
      async evaluate() {
        evaluationCalls += 1;
        return { status: "EVALUATED", proposal: processedProposal };
      },
    },
  });

  assert.deepEqual(await service.generateAndEvaluate(input, context), {
    status: "ALREADY_PROCESSED",
    proposal: processedProposal,
  });
  assert.equal(evaluationCalls, 0);
});

test("proposal workflow resumes evaluation after a creation-only retry", async () => {
  let evaluatedProposalId: string | undefined;
  const service = new ProposalGenerationEvaluationService({
    proposalGeneration: {
      async generate() {
        return { status: "ALREADY_EXISTS", proposal };
      },
    },
    proposalPolicyEvaluation: {
      async evaluate(proposalId) {
        evaluatedProposalId = proposalId;
        return {
          status: "EVALUATED",
          proposal: { ...proposal, decision: "BLOCK", status: "BLOCKED" },
        };
      },
    },
  });

  assert.equal(
    (await service.generateAndEvaluate(input, context)).status,
    "EVALUATED",
  );
  assert.equal(evaluatedProposalId, proposal.proposalId);
});

test("proposal workflow preserves generation failures", async () => {
  for (const status of ["ID_CONFLICT", "PERSISTENCE_INCONSISTENCY"] as const) {
    const service = new ProposalGenerationEvaluationService({
      proposalGeneration: {
        async generate() {
          return { status };
        },
      },
      proposalPolicyEvaluation: {
        async evaluate() {
          throw new Error("Evaluation must not run.");
        },
      },
    });

    assert.deepEqual(await service.generateAndEvaluate(input), { status });
  }
});

test("proposal workflow maps evaluation races and missing storage", async () => {
  for (const [evaluationStatus, expectedStatus] of [
    ["INVALID_STATE", "CONFLICT"],
    ["CONFLICT", "CONFLICT"],
    ["NOT_FOUND", "PERSISTENCE_INCONSISTENCY"],
  ] as const) {
    const service = new ProposalGenerationEvaluationService({
      proposalGeneration: {
        async generate() {
          return { status: "CREATED", proposal };
        },
      },
      proposalPolicyEvaluation: {
        async evaluate() {
          return { status: evaluationStatus };
        },
      },
    });

    assert.deepEqual(await service.generateAndEvaluate(input), {
      status: expectedStatus,
    });
  }
});
