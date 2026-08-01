import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import {
  apiErrorSchema,
  apiResponseSchema,
  proposalSchema,
  type Proposal,
} from "../../src/contracts/index.js";
import { InMemoryProposalRepository } from "../../src/repositories/proposal-repository.js";
import { z } from "zod";

const config = {
  PORT: 8080,
  HOST: "0.0.0.0",
  ENVIRONMENT: "devnet",
  DATA_MODE: "live",
} as const;

const proposal: Proposal = {
  proposalId: "proposal_01",
  action: "SWAP",
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  amountAtomic: "1000000",
  amountDisplay: "0.001 SOL",
  amountUsd: 4.83,
  rationale: "Restore the target USDC operations balance.",
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
  decision: "AUTO",
  status: "POLICY_APPROVED",
  ruleChecks: [],
};

test("GET /api/v1/proposals returns proposals in the frontend envelope", async () => {
  const app = createApp({
    config,
    proposalRepository: new InMemoryProposalRepository([proposal]),
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/proposals",
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(
    apiResponseSchema(z.array(proposalSchema)).safeParse(body).success,
    true,
  );
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].proposalId, proposal.proposalId);
  await app.close();
});

test("GET /api/v1/proposals/:proposalId returns one proposal", async () => {
  const app = createApp({
    config,
    proposalRepository: new InMemoryProposalRepository([proposal]),
  });
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/proposals/${proposal.proposalId}`,
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(apiResponseSchema(proposalSchema).safeParse(body).success, true);
  assert.equal(body.data.proposalId, proposal.proposalId);
  await app.close();
});

test("GET /api/v1/proposals/:proposalId returns a flat 404 error", async () => {
  const app = createApp({ config });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/proposals/missing_proposal",
  });
  const body = response.json();

  assert.equal(response.statusCode, 404);
  assert.equal(apiErrorSchema.safeParse(body).success, true);
  assert.equal(body.code, "PROPOSAL_NOT_FOUND");
  assert.equal(body.proposalId, "missing_proposal");
  assert.equal(body.retryable, false);
  await app.close();
});

test("proposal repository rejects invalid records at its boundary", () => {
  assert.throws(
    () =>
      new InMemoryProposalRepository([
        { ...proposal, status: "APPROVED" } as unknown as Proposal,
      ]),
  );
});
