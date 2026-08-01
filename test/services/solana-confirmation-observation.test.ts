import assert from "node:assert/strict";
import test from "node:test";
import type { Proposal } from "../../src/contracts/index.js";
import type { SolanaSignatureStatus } from "../../src/providers/solana-rpc.js";
import { SolanaConfirmationObservationService } from "../../src/services/solana-confirmation-observation.js";

const proposal: Proposal = {
  proposalId: "proposal_01",
  action: "SWAP",
  outputSymbol: "USDC",
  amountUsd: 4.83,
  rationale: "Restore balance.",
  confidence: 0.9,
  evidenceRefs: [],
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  policyVersion: "policy-1",
  status: "SUBMITTED",
  ruleChecks: [],
  execution: {
    kmsRequested: true,
    transactionSignature: "signature_01",
    submittedAt: "2026-08-01T06:01:00.000Z",
    outputTokenAccount: "token-account",
    beforeOutputBalanceAtomic: "10000000",
    expectedOutputDeltaAtomic: "4830000",
  },
};

function createService(status: SolanaSignatureStatus) {
  return new SolanaConfirmationObservationService({
    async getSignatureStatus() {
      return status;
    },
    async getTokenBalance() {
      return { amountAtomic: "14830000", decimals: 6 };
    },
  });
}

test("Solana observation service builds trusted reconciliation input", async () => {
  const result = await createService({
    status: "CONFIRMED",
    slot: 123,
    commitment: "finalized",
    confirmedAt: "2026-08-01T06:02:00.000Z",
  }).observe(proposal);

  assert.deepEqual(result, {
    status: "READY",
    observation: {
      transactionSignature: "signature_01",
      commitment: "finalized",
      confirmedAt: "2026-08-01T06:02:00.000Z",
      asset: "USDC",
      beforeBalanceAtomic: "10000000",
      afterBalanceAtomic: "14830000",
      expectedDeltaAtomic: "4830000",
    },
  });
});

test("Solana observation service maps incomplete signature states", async () => {
  assert.deepEqual(
    await createService({ status: "NOT_FOUND" }).observe(proposal),
    { status: "NOT_FOUND" },
  );
  assert.deepEqual(
    await createService({ status: "PENDING", slot: 1 }).observe(proposal),
    { status: "PENDING" },
  );
  assert.deepEqual(
    await createService({ status: "FAILED", slot: 1, error: "failed" }).observe(
      proposal,
    ),
    { status: "TRANSACTION_FAILED", error: "failed" },
  );
});

test("Solana observation service requires block time and execution context", async () => {
  assert.deepEqual(
    await createService({
      status: "CONFIRMED",
      slot: 1,
      commitment: "confirmed",
      confirmedAt: null,
    }).observe(proposal),
    { status: "BLOCK_TIME_UNAVAILABLE" },
  );
  assert.deepEqual(
    await createService({ status: "NOT_FOUND" }).observe({
      ...proposal,
      execution: { kmsRequested: true },
    }),
    { status: "INVALID_EXECUTION" },
  );
});
