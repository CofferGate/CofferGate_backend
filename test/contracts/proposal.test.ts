import assert from "node:assert/strict";
import test from "node:test";
import { apiResponseSchema, proposalSchema } from "../../src/contracts/index.js";

const baseProposal = {
  proposalId: "proposal_01",
  action: "SWAP",
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  amountAtomic: "1000000",
  amountDisplay: "0.001 SOL",
  amountUsd: 4.83,
  rationale: "USDC 운영 잔고를 목표 수준으로 복구합니다.",
  confidence: 0.91,
  evidenceRefs: [
    {
      id: "observation_01",
      label: "Operations Wallet balance",
      sourceType: "ONCHAIN_BALANCE",
      observedAt: "2026-08-01T06:00:00.000Z",
    },
  ],
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  policyVersion: "policy-2026.08.1",
  ruleChecks: [],
} as const;

test("AUTO proposal response matches the frontend contract", () => {
  const response = {
    data: {
      ...baseProposal,
      decision: "AUTO",
      status: "RECONCILED",
      execution: {
        routeLabel: "Jupiter SOL-USDC",
        simulation: { ok: true, unitsConsumed: 201234 },
        computeUnits: 241481,
        kmsKeyVersion: "cryptoKeyVersions/1",
        kmsRequested: true,
        transactionSignature: "5NfExampleSignature",
        commitment: "confirmed",
        reconciliation: {
          beforeBalance: "10.00",
          afterBalance: "14.83",
          expectedDelta: "4.83",
          actualDelta: "4.83",
          status: "MATCHED",
        },
      },
    },
    meta: {
      requestId: "request_01",
      generatedAt: "2026-08-01T06:01:00.000Z",
      environment: "devnet",
    },
  };

  assert.equal(apiResponseSchema(proposalSchema).safeParse(response).success, true);
});

test("BLOCK proposal requires a valid frontend status and evidence shape", () => {
  const response = {
    ...baseProposal,
    decision: "BLOCK",
    status: "BLOCKED",
    ruleChecks: [
      {
        code: "MAX_TRANSACTION_USD",
        label: "거래당 한도",
        result: "FAIL",
        actual: 6,
        expected: 5,
        message: "거래 금액이 한도를 초과했습니다.",
      },
    ],
    execution: { kmsRequested: false },
  };

  assert.equal(proposalSchema.safeParse(response).success, true);
});

test("proposal rejects unknown statuses and invalid confidence", () => {
  const result = proposalSchema.safeParse({
    ...baseProposal,
    status: "APPROVED",
    confidence: 1.2,
  });

  assert.equal(result.success, false);
});
