import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutionConfirmationObservation,
  Proposal,
} from "../../src/contracts/index.js";
import type {
  ExecutionCompletionRepository,
  ExecutionCompletionSaveResult,
} from "../../src/repositories/execution-completion-repository.js";
import { InMemoryProposalRepository } from "../../src/repositories/proposal-repository.js";
import { ExecutionCompletionWorkflow } from "../../src/services/execution-completion-workflow.js";
import { ExecutionReconciliationService } from "../../src/services/execution-reconciliation.js";

const proposal: Proposal = {
  proposalId: "proposal_01",
  action: "SWAP",
  outputSymbol: "USDC",
  amountUsd: 4.83,
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
  beforeBalanceAtomic: "10000000",
  afterBalanceAtomic: "14830000",
  expectedDeltaAtomic: "4830000",
};

class StubCompletionRepository implements ExecutionCompletionRepository {
  savedProposal: Proposal | null = null;

  constructor(
    private readonly result: ExecutionCompletionSaveResult = "COMPLETED",
  ) {}

  async complete(completedProposal: Proposal) {
    this.savedProposal = completedProposal;
    return this.result;
  }
}

function createWorkflow(
  storedProposal: Proposal | null,
  completionRepository: ExecutionCompletionRepository,
) {
  return new ExecutionCompletionWorkflow({
    proposalRepository: new InMemoryProposalRepository(
      storedProposal ? [storedProposal] : [],
    ),
    reconciliationService: new ExecutionReconciliationService(),
    completionRepository,
  });
}

test("execution completion workflow reconciles and persists one completion", async () => {
  const completionRepository = new StubCompletionRepository();
  const result = await createWorkflow(
    proposal,
    completionRepository,
  ).complete(proposal.proposalId, observation);

  assert.equal(result.status, "COMPLETED");
  if (result.status === "COMPLETED") {
    assert.equal(result.outcome, "RECONCILED");
    assert.equal(result.proposal.status, "RECONCILED");
  }
  assert.equal(completionRepository.savedProposal?.status, "RECONCILED");
});

test("execution completion workflow persists confirmed mismatches", async () => {
  const completionRepository = new StubCompletionRepository();
  const result = await createWorkflow(
    proposal,
    completionRepository,
  ).complete(proposal.proposalId, {
    ...observation,
    afterBalanceAtomic: "14829999",
  });

  assert.equal(result.status, "COMPLETED");
  if (result.status === "COMPLETED") {
    assert.equal(result.outcome, "MISMATCHED");
    assert.equal(result.proposal.status, "FAILED");
  }
  assert.equal(completionRepository.savedProposal?.status, "FAILED");
});

test("execution completion workflow returns reconciliation rejections", async () => {
  const completionRepository = new StubCompletionRepository();
  const result = await createWorkflow(
    proposal,
    completionRepository,
  ).complete(proposal.proposalId, {
    ...observation,
    transactionSignature: "different-signature",
  });

  assert.deepEqual(result, { status: "SIGNATURE_MISMATCH" });
  assert.equal(completionRepository.savedProposal, null);
});

test("execution completion workflow maps persistence conflicts", async () => {
  const result = await createWorkflow(
    proposal,
    new StubCompletionRepository("STATUS_CONFLICT"),
  ).complete(proposal.proposalId, observation);

  assert.deepEqual(result, {
    status: "PERSISTENCE_CONFLICT",
    reason: "STATUS_CONFLICT",
  });
});

test("execution completion workflow handles missing and completed proposals", async () => {
  assert.deepEqual(
    await createWorkflow(null, new StubCompletionRepository()).complete(
      proposal.proposalId,
      observation,
    ),
    { status: "NOT_FOUND" },
  );

  const completedProposal = new ExecutionReconciliationService().reconcile(
    proposal,
    observation,
  );
  assert.equal(completedProposal.status, "RECONCILED");
  if (completedProposal.status === "RECONCILED") {
    const result = await createWorkflow(
      completedProposal.proposal,
      new StubCompletionRepository("ALREADY_COMPLETED"),
    ).complete(proposal.proposalId, observation);
    assert.equal(result.status, "ALREADY_COMPLETED");
  }
});

test("execution completion retry rejects a different signature", async () => {
  const completedProposal = new ExecutionReconciliationService().reconcile(
    proposal,
    observation,
  );
  assert.equal(completedProposal.status, "RECONCILED");
  if (completedProposal.status === "RECONCILED") {
    const completionRepository = new StubCompletionRepository(
      "ALREADY_COMPLETED",
    );
    const result = await createWorkflow(
      completedProposal.proposal,
      completionRepository,
    ).complete(proposal.proposalId, {
      ...observation,
      transactionSignature: "different-signature",
    });

    assert.deepEqual(result, { status: "SIGNATURE_MISMATCH" });
    assert.equal(completionRepository.savedProposal, null);
  }
});
