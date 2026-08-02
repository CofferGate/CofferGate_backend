import assert from "node:assert/strict";
import test from "node:test";
import type { Proposal } from "../../src/contracts/index.js";
import { InMemoryProposalRepository } from "../../src/repositories/proposal-repository.js";

const approved: Proposal = {
  proposalId: "proposal-payment-claim",
  action: "SWAP",
  amountUsd: 1,
  rationale: "Demonstrate a bounded Devnet token payment.",
  confidence: 0.95,
  evidenceRefs: [],
  dataAsOf: "2026-08-02T00:00:00.000Z",
  expiresAt: "2026-08-02T00:05:00.000Z",
  policyVersion: "policy-demo-v1",
  decision: "AUTO",
  status: "POLICY_APPROVED",
  ruleChecks: [],
};

test("claims an eligible Devnet payment exactly once", async () => {
  const repository = new InMemoryProposalRepository([approved]);

  const first = await repository.claimDevnetPayment(approved.proposalId);
  assert.equal(first.status, "CLAIMED");
  if (first.status !== "CLAIMED") return;
  assert.equal(first.proposal.status, "EXECUTING");
  assert.deepEqual(first.proposal.execution, { mode: "demo", kmsRequested: false });

  const retry = await repository.claimDevnetPayment(approved.proposalId);
  assert.equal(retry.status, "ALREADY_CLAIMED");
});

test("does not claim blocked or non-payment proposals", async () => {
  const blocked: Proposal = {
    ...approved,
    proposalId: "proposal-blocked",
    decision: "BLOCK",
    status: "BLOCKED",
    execution: { kmsRequested: false },
  };
  const noAction: Proposal = {
    ...approved,
    proposalId: "proposal-no-action",
    action: "NO_ACTION",
  };
  const repository = new InMemoryProposalRepository([blocked, noAction]);

  assert.equal((await repository.claimDevnetPayment(blocked.proposalId)).status, "NOT_ELIGIBLE");
  assert.equal((await repository.claimDevnetPayment(noAction.proposalId)).status, "NOT_ELIGIBLE");
  assert.equal((await repository.claimDevnetPayment("missing")).status, "NOT_FOUND");
});
