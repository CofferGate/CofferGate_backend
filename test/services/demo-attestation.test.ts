import assert from "node:assert/strict";
import test from "node:test";
import type { Proposal } from "../../src/contracts/index.js";
import { InMemoryProposalRepository } from "../../src/repositories/proposal-repository.js";
import { DemoAttestationService } from "../../src/services/demo-attestation.js";

const approved: Proposal = {
  proposalId: "proposal_demo_01",
  action: "SWAP",
  amountUsd: 4.5,
  rationale: "Restore the demo reserve.",
  confidence: 0.9,
  evidenceRefs: [],
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  policyVersion: "policy-demo-v1",
  decision: "AUTO",
  status: "POLICY_APPROVED",
  ruleChecks: [],
};

test("demo attestation signs and persists an approved proposal", async () => {
  const repository = new InMemoryProposalRepository([approved]);
  const payloads: string[] = [];
  const service = new DemoAttestationService(
    repository,
    {
      async sign(payload) {
        payloads.push(payload.toString());
        return { signature: "kms-signature", keyVersion: "kms/key/1" };
      },
    },
    () => new Date("2026-08-01T06:01:00.000Z"),
  );

  const result = await service.attest(approved.proposalId);
  assert.equal(result.status, "ATTESTED");
  const saved = await repository.findById(approved.proposalId);
  assert.equal(saved?.status, "SIMULATED");
  assert.equal(saved?.execution?.mode, "demo");
  assert.equal(saved?.execution?.attestationSignature, "kms-signature");
  assert.match(payloads[0] ?? "", /coffergate\.devnet\.attestation\.v1/);
});

test("demo attestation is idempotent and rejects ineligible proposals", async () => {
  const blocked: Proposal = {
    ...approved,
    proposalId: "proposal_blocked",
    decision: "BLOCK",
    status: "BLOCKED",
    execution: { kmsRequested: false },
  };
  const repository = new InMemoryProposalRepository([approved, blocked]);
  let signatures = 0;
  const service = new DemoAttestationService(repository, {
    async sign() {
      signatures += 1;
      return { signature: "kms-signature", keyVersion: "kms/key/1" };
    },
  });

  assert.equal((await service.attest(blocked.proposalId)).status, "NOT_ELIGIBLE");
  assert.equal((await service.attest(approved.proposalId)).status, "ATTESTED");
  assert.equal((await service.attest(approved.proposalId)).status, "ALREADY_ATTESTED");
  assert.equal(signatures, 1);
});
