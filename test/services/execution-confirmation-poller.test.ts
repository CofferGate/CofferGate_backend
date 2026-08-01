import assert from "node:assert/strict";
import test from "node:test";
import type { Proposal } from "../../src/contracts/index.js";
import { InMemoryProposalRepository } from "../../src/repositories/proposal-repository.js";
import { ExecutionConfirmationPoller } from "../../src/services/execution-confirmation-poller.js";

const proposal = { proposalId: "p1", action: "SWAP", rationale: "x", confidence: 1, evidenceRefs: [], dataAsOf: "x", expiresAt: "x", policyVersion: "p", status: "SUBMITTED", ruleChecks: [] } as Proposal;

test("confirmation poller waits without invoking completion", async () => {
  let completed = false;
  const poller = new ExecutionConfirmationPoller(
    new InMemoryProposalRepository([proposal]),
    { async observe() { return { status: "PENDING" } as const; } } as never,
    { async complete() { completed = true; return { status: "NOT_FOUND" } as const; } } as never,
  );
  assert.deepEqual(await poller.poll("p1"), { status: "WAITING", reason: "PENDING" });
  assert.equal(completed, false);
});

test("confirmation poller forwards ready observation", async () => {
  const observation = { transactionSignature: "s", commitment: "confirmed", confirmedAt: "2026-08-01T00:00:00.000Z", asset: "USDC", beforeBalanceAtomic: "1", afterBalanceAtomic: "2", expectedDeltaAtomic: "1" } as const;
  const poller = new ExecutionConfirmationPoller(
    new InMemoryProposalRepository([proposal]),
    { async observe() { return { status: "READY", observation } as const; } } as never,
    { async complete(id: string, value: unknown) { assert.equal(id, "p1"); assert.deepEqual(value, observation); return { status: "NOT_FOUND" } as const; } } as never,
  );
  assert.deepEqual(await poller.poll("p1"), { status: "PROCESSED", result: { status: "NOT_FOUND" } });
});
