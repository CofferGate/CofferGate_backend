import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import type { Proposal } from "../../src/contracts/index.js";
import { InMemoryProposalRepository } from "../../src/repositories/proposal-repository.js";
import { DevnetPaymentExecutionService } from "../../src/services/devnet-payment-execution.js";

const approved: Proposal = {
  proposalId: "payment-01", action: "SWAP", rationale: "Demo payment", confidence: 1,
  evidenceRefs: [], dataAsOf: "2026-08-02T00:00:00.000Z",
  expiresAt: "2026-08-02T00:05:00.000Z", policyVersion: "p1",
  decision: "AUTO", status: "POLICY_APPROVED", ruleChecks: [],
};
const signerAddress = "C56cDPCV4Tv7QFMQpnTLPm9ArYcKZLKjdHkaJ6ioEboM";
const source = "5cB6k64vh1VvBxd6q4tYYLoi1o5gH2ecSi9LKBuLzAiq";
const destination = "7UXZ74VQ9hH8m8k6gL8Vv2QXU8vT4G7m2xYH3dL9wQ4R";
const mint = "AYneHfKF7XxhEM3EXdk7EykSPzjfc58bRSotwkECXntQ";

test("executes and reconciles one bounded Devnet payment", async () => {
  const repository = new InMemoryProposalRepository([approved]);
  const { privateKey } = generateKeyPairSync("ed25519");
  let balanceCalls = 0;
  const service = new DevnetPaymentExecutionService(repository, {
    async getTokenBalance() { return { amountAtomic: balanceCalls++ === 0 ? "10" : "11", decimals: 0 }; },
    async getLatestBlockhash() { return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 20, slot: 1 }; },
    async simulateTransaction() { return { ok: true, unitsConsumed: 123 }; },
    async sendTransaction(transaction) { return getSignatureFromTransaction(getTransactionDecoder().decode(transaction)); },
    async confirmTransaction() { return { commitment: "confirmed" }; },
  }, {
    async sign(message) { return { signature: sign(null, message, privateKey), keyVersion: "kms/key/1" }; },
  }, { signerAddress, sourceTokenAccount: source, destinationTokenAccount: destination, destinationOwnerAddress: signerAddress, mintAddress: mint, amountAtomic: "1", decimals: 0 },
  () => new Date("2026-08-02T00:01:00.000Z"));

  const result = await service.execute(approved.proposalId);
  assert.equal(result.status, "RECONCILED");
  if (result.status !== "RECONCILED") return;
  assert.equal(result.proposal.execution?.reconciliation?.status, "MATCHED");
  assert.equal(result.proposal.execution?.kmsRequested, true);
});

test("fails closed before signing when simulation fails", async () => {
  const repository = new InMemoryProposalRepository([approved]);
  let signCalls = 0;
  const service = new DevnetPaymentExecutionService(repository, {
    async getTokenBalance() { return { amountAtomic: "10", decimals: 0 }; },
    async getLatestBlockhash() { return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 20, slot: 1 }; },
    async simulateTransaction() { return { ok: false }; },
    async sendTransaction() { throw new Error("must not submit"); },
    async confirmTransaction() { throw new Error("must not confirm"); },
  }, { async sign() { signCalls += 1; return { signature: Buffer.alloc(64), keyVersion: "key" }; } },
  { signerAddress, sourceTokenAccount: source, destinationTokenAccount: destination, destinationOwnerAddress: signerAddress, mintAddress: mint, amountAtomic: "1", decimals: 0 });

  const result = await service.execute(approved.proposalId);
  assert.equal(result.status, "FAILED");
  assert.equal(signCalls, 0);
  assert.equal((await repository.findById(approved.proposalId))?.status, "FAILED");
});
