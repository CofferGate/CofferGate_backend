import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutionConfirmationObservation,
  Proposal,
} from "../../src/contracts/index.js";
import { ExecutionReconciliationService } from "../../src/services/execution-reconciliation.js";

const proposal: Proposal = {
  proposalId: "proposal_01",
  action: "SWAP",
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  rationale: "Restore the operations balance.",
  confidence: 0.9,
  evidenceRefs: [],
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  policyVersion: "policy-2026.08.1",
  decision: "AUTO",
  status: "SUBMITTED",
  ruleChecks: [],
  execution: {
    kmsRequested: true,
    transactionSignature: "signature_01",
    submittedAt: "2026-08-01T06:01:00.000Z",
  },
};

const observation: ExecutionConfirmationObservation = {
  transactionSignature: "signature_01",
  commitment: "confirmed",
  confirmedAt: "2026-08-01T06:02:00.000Z",
  asset: "USDC",
  beforeBalanceAtomic: "900719925474099312345",
  afterBalanceAtomic: "900719925474104142345",
  expectedDeltaAtomic: "4830000",
};

const service = new ExecutionReconciliationService();

test("execution reconciliation matches atomic balances without precision loss", () => {
  const result = service.reconcile(proposal, observation);

  assert.equal(result.status, "RECONCILED");
  if (result.status === "RECONCILED") {
    assert.equal(result.proposal.status, "RECONCILED");
    assert.equal(
      result.proposal.execution?.reconciliation?.actualDelta,
      "4830000",
    );
    assert.equal(
      result.proposal.execution?.reconciliation?.status,
      "MATCHED",
    );
    assert.equal(result.proposal.execution?.commitment, "confirmed");
  }
});

test("execution reconciliation marks unexpected balance deltas as failed", () => {
  const result = service.reconcile(proposal, {
    ...observation,
    afterBalanceAtomic: "900719925474104142344",
  });

  assert.equal(result.status, "MISMATCHED");
  if (result.status === "MISMATCHED") {
    assert.equal(result.proposal.status, "FAILED");
    assert.equal(
      result.proposal.execution?.reconciliation?.actualDelta,
      "4829999",
    );
    assert.equal(
      result.proposal.execution?.reconciliation?.status,
      "MISMATCHED",
    );
  }
});

test("execution reconciliation rejects invalid state and unsigned execution", () => {
  assert.deepEqual(
    service.reconcile({ ...proposal, status: "CONFIRMED" }, observation),
    { status: "INVALID_STATE" },
  );
  assert.deepEqual(
    service.reconcile(
      { ...proposal, execution: { ...proposal.execution, kmsRequested: false } },
      observation,
    ),
    { status: "UNSIGNED_EXECUTION" },
  );
});

test("execution reconciliation rejects signature and asset mismatches", () => {
  assert.deepEqual(
    service.reconcile(proposal, {
      ...observation,
      transactionSignature: "different-signature",
    }),
    { status: "SIGNATURE_MISMATCH" },
  );
  assert.deepEqual(
    service.reconcile(proposal, { ...observation, asset: "SOL" }),
    { status: "ASSET_MISMATCH" },
  );
});

test("execution reconciliation rejects confirmation before submission", () => {
  assert.deepEqual(
    service.reconcile(proposal, {
      ...observation,
      confirmedAt: "2026-08-01T06:00:59.999Z",
    }),
    { status: "CONFIRMATION_BEFORE_SUBMISSION" },
  );
});

test("execution reconciliation rejects malformed submitted execution", () => {
  assert.deepEqual(
    service.reconcile(
      {
        ...proposal,
        execution: {
          ...proposal.execution,
          kmsRequested: true,
          submittedAt: "not-a-date",
        },
      },
      observation,
    ),
    { status: "INVALID_EXECUTION" },
  );
});
