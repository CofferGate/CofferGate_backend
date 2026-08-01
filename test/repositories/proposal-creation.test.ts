import assert from "node:assert/strict";
import test from "node:test";
import type { Proposal } from "../../src/contracts/index.js";
import { InMemoryProposalRepository } from "../../src/repositories/proposal-repository.js";

const proposal: Proposal = {
  proposalId: "proposal_01",
  action: "SWAP",
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  amountUsd: 4.83,
  rationale: "Restore the operations balance.",
  confidence: 0.91,
  evidenceRefs: [],
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  policyVersion: "policy-2026.08.1",
  status: "AI_REVIEWED",
  ruleChecks: [],
};

test("in-memory proposal creation is idempotent", async () => {
  const repository = new InMemoryProposalRepository();
  assert.deepEqual(await Promise.all([repository.create(proposal), repository.create(proposal)]), [
    "CREATED",
    "ALREADY_EXISTS",
  ]);
  assert.deepEqual(await repository.findById(proposal.proposalId), proposal);
});

test("in-memory proposal creation rejects ID conflicts", async () => {
  const repository = new InMemoryProposalRepository([proposal]);
  assert.equal(
    await repository.create({ ...proposal, amountUsd: 5 }),
    "ID_CONFLICT",
  );
});

test("proposal creation rejects precomputed policy and execution state", async () => {
  const repository = new InMemoryProposalRepository();
  await assert.rejects(() =>
    repository.create({
      ...proposal,
      decision: "AUTO",
      status: "POLICY_APPROVED",
      execution: { kmsRequested: true },
    }),
  );
});
