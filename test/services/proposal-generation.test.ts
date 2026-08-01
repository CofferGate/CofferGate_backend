import assert from "node:assert/strict";
import test from "node:test";
import type { Proposal } from "../../src/contracts/index.js";
import type { VertexProposalGenerationInput } from "../../src/providers/vertex-proposal.js";
import {
  InMemoryProposalRepository,
  type ProposalRepository,
} from "../../src/repositories/proposal-repository.js";
import { ProposalGenerationService } from "../../src/services/proposal-generation.js";

const input: VertexProposalGenerationInput = {
  proposalId: "proposal_01",
  policyVersion: "policy-2026.08.1",
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  solBalance: "1.25",
  usdcBalance: "10.00",
  targetUsdcBalance: "15.00",
  solPriceUsd: 200,
  assetMints: { SOL: "trusted-sol-mint", USDC: "trusted-usdc-mint" },
  evidenceRefs: [],
};

const proposal: Proposal = {
  proposalId: input.proposalId,
  action: "SWAP",
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  inputMint: input.assetMints.SOL,
  outputMint: input.assetMints.USDC,
  amountUsd: 4.83,
  rationale: "Restore the operations balance.",
  confidence: 0.91,
  evidenceRefs: [],
  dataAsOf: input.dataAsOf,
  expiresAt: input.expiresAt,
  policyVersion: input.policyVersion,
  status: "AI_REVIEWED",
  ruleChecks: [],
};

function createService(
  repository: ProposalRepository,
  generatedProposal: Proposal = proposal,
) {
  return new ProposalGenerationService({
    proposalRepository: repository,
    proposalGenerator: {
      async generate() {
        return generatedProposal;
      },
    },
  });
}

test("proposal generation persists a reviewed proposal", async () => {
  const repository = new InMemoryProposalRepository();

  assert.deepEqual(await createService(repository).generate(input), {
    status: "CREATED",
    proposal,
  });
  assert.deepEqual(await repository.findById(proposal.proposalId), proposal);
});

test("proposal generation returns the current proposal on an idempotent retry", async () => {
  const repository = new InMemoryProposalRepository([proposal]);
  const evaluatedProposal: Proposal = {
    ...proposal,
    decision: "BLOCK",
    status: "BLOCKED",
    ruleChecks: [
      {
        code: "EXPIRED",
        label: "Proposal expiry",
        result: "FAIL",
        message: "Proposal expired before evaluation.",
      },
    ],
  };
  await repository.savePolicyEvaluation(evaluatedProposal, "AI_REVIEWED");

  assert.deepEqual(await createService(repository).generate(input), {
    status: "ALREADY_EXISTS",
    proposal: evaluatedProposal,
  });
});

test("proposal generation reports immutable ID conflicts", async () => {
  const repository = new InMemoryProposalRepository([proposal]);
  const conflictingProposal = { ...proposal, amountUsd: 5 };

  assert.deepEqual(
    await createService(repository, conflictingProposal).generate(input),
    { status: "ID_CONFLICT" },
  );
});

test("proposal generation reports inconsistent idempotency storage", async () => {
  const repository: ProposalRepository = {
    async create() {
      return "ALREADY_EXISTS";
    },
    async findById() {
      return null;
    },
    async list() {
      return [];
    },
    async savePolicyEvaluation() {
      return "NOT_FOUND";
    },
  };

  assert.deepEqual(await createService(repository).generate(input), {
    status: "PERSISTENCE_INCONSISTENCY",
  });
});
