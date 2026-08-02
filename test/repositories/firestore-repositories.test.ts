import assert from "node:assert/strict";
import test from "node:test";
import type { Policy, Proposal } from "../../src/contracts/index.js";
import type {
  FirestoreDatabase,
  FirestoreDocumentSnapshot,
} from "../../src/infrastructure/firestore.js";
import { FirestoreDailyUsageRepository } from "../../src/repositories/daily-usage-repository.js";
import { FirestorePolicyRepository } from "../../src/repositories/policy-repository.js";
import { FirestoreProposalRepository } from "../../src/repositories/proposal-repository.js";
import { FirestoreProposalSuppressionRepository } from "../../src/repositories/proposal-suppression-repository.js";

const proposal: Proposal = {
  proposalId: "proposal_01",
  action: "SWAP",
  rationale: "Restore the target USDC operations balance.",
  confidence: 0.91,
  evidenceRefs: [],
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  policyVersion: "policy-2026.08.1",
  status: "POLICY_APPROVED",
  ruleChecks: [],
};

const policy: Policy = {
  policyVersion: "policy-2026.08.1",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  allowedInputMints: [],
  allowedOutputMints: [],
  allowedAssets: ["SOL", "USDC"],
  maxTransactionUsd: 5,
  dailyLimitUsd: 20,
  minimumReserve: { amount: 0.01, asset: "SOL" },
  maxSlippageBps: 50,
  maxPriceImpactBps: 100,
  quoteMaxAgeSeconds: 15,
  allowedPrograms: [],
  allowedSigners: [],
  simulationRequired: true,
  circuitBreakerParameters: null,
  circuitBreakerStatus: "ACTIVE",
};

function createDatabase(
  collections: Record<string, Record<string, unknown>>,
): FirestoreDatabase {
  const referenceRecords = new WeakMap<
    object,
    { records: Record<string, unknown>; documentId: string }
  >();
  const createDocument = (
    documentId: string,
    records: Record<string, unknown>,
  ): FirestoreDocumentSnapshot => ({
    id: documentId,
    exists: Object.hasOwn(records, documentId),
    data: () => records[documentId],
  });

  return {
    collection(collectionPath) {
      const records =
        collections[collectionPath] ?? (collections[collectionPath] = {});
      return {
        async get() {
          return {
            docs: Object.keys(records).map((documentId) =>
              createDocument(documentId, records),
            ),
          };
        },
        doc(documentId) {
          const reference = {
            id: documentId,
            async get() {
              return createDocument(documentId, records);
            },
          };
          referenceRecords.set(reference, { records, documentId });
          return reference;
        },
      };
    },
    async runTransaction(operation) {
      return operation({
        async get(reference) {
          return reference.get();
        },
        set(reference, data) {
          const target = referenceRecords.get(reference);
          if (!target) {
            throw new Error("Unknown document reference.");
          }
          target.records[target.documentId] = data;
        },
      });
    },
  };
}

test("Firestore proposal repository lists and finds validated proposals", async () => {
  const repository = new FirestoreProposalRepository(
    createDatabase({ proposals: { [proposal.proposalId]: proposal } }),
  );

  assert.deepEqual(await repository.list(), [proposal]);
  assert.deepEqual(await repository.findById(proposal.proposalId), proposal);
  assert.equal(await repository.findById("missing"), null);
});

test("Firestore proposal suppression repository enforces cooldown atomically", async () => {
  const repository = new FirestoreProposalSuppressionRepository(createDatabase({}));

  assert.equal(
    await repository.claim("fingerprint", new Date("2026-08-01T06:00:00.000Z"), 1_800),
    "CLAIMED",
  );
  assert.equal(
    await repository.claim("fingerprint", new Date("2026-08-01T06:05:00.000Z"), 1_800),
    "SUPPRESSED",
  );
  assert.equal(
    await repository.claim("fingerprint", new Date("2026-08-01T06:30:00.000Z"), 1_800),
    "CLAIMED",
  );
});
test("Firestore proposal repository atomically creates reviewed proposals", async () => {
  const database = createDatabase({});
  const repository = new FirestoreProposalRepository(database);
  const reviewedProposal: Proposal = {
    ...proposal,
    status: "AI_REVIEWED",
  };

  assert.equal(await repository.create(reviewedProposal), "CREATED");
  assert.equal(await repository.create(reviewedProposal), "ALREADY_EXISTS");
  assert.equal(
    await repository.create({ ...reviewedProposal, rationale: "changed" }),
    "ID_CONFLICT",
  );
  assert.deepEqual(
    await repository.findById(reviewedProposal.proposalId),
    reviewedProposal,
  );
});

test("Firestore proposal repository rejects mismatched document IDs", async () => {
  const repository = new FirestoreProposalRepository(
    createDatabase({ proposals: { wrong_id: proposal } }),
  );

  await assert.rejects(() => repository.list(), /does not match proposalId/);
});

test("Firestore proposal repository atomically saves one policy evaluation", async () => {
  const reviewedProposal: Proposal = { ...proposal, status: "AI_REVIEWED" };
  const database = createDatabase({
    proposals: { [proposal.proposalId]: reviewedProposal },
  });
  const repository = new FirestoreProposalRepository(database);
  const evaluatedProposal: Proposal = {
    ...reviewedProposal,
    decision: "AUTO",
    status: "POLICY_APPROVED",
  };

  assert.equal(
    await repository.savePolicyEvaluation(evaluatedProposal, "AI_REVIEWED"),
    "SAVED",
  );
  assert.deepEqual(await repository.findById(proposal.proposalId), evaluatedProposal);
  assert.equal(
    await repository.savePolicyEvaluation(evaluatedProposal, "AI_REVIEWED"),
    "STATUS_CONFLICT",
  );
});

test("Firestore proposal repository atomically claims one Devnet payment", async () => {
  const approvedProposal: Proposal = { ...proposal, decision: "AUTO" };
  const repository = new FirestoreProposalRepository(createDatabase({
    proposals: { [proposal.proposalId]: approvedProposal },
  }));

  const first = await repository.claimDevnetPayment(proposal.proposalId);
  assert.equal(first.status, "CLAIMED");
  const retry = await repository.claimDevnetPayment(proposal.proposalId);
  assert.equal(retry.status, "ALREADY_CLAIMED");
  assert.equal((await repository.findById(proposal.proposalId))?.status, "EXECUTING");
});


test("Firestore proposal evaluation reports missing documents", async () => {
  const repository = new FirestoreProposalRepository(createDatabase({}));

  assert.equal(
    await repository.savePolicyEvaluation(
      { ...proposal, decision: "BLOCK", status: "BLOCKED" },
      "AI_REVIEWED",
    ),
    "NOT_FOUND",
  );
});

test("Firestore policy repository returns current policy or null", async () => {
  const configured = new FirestorePolicyRepository(
    createDatabase({ policies: { current: policy } }),
  );
  const unconfigured = new FirestorePolicyRepository(createDatabase({}));

  assert.deepEqual(await configured.getCurrent(), policy);
  assert.equal(await unconfigured.getCurrent(), null);
});

test("Firestore repositories reject invalid document contracts", async () => {
  const repository = new FirestorePolicyRepository(
    createDatabase({ policies: { current: { ...policy, dailyLimitUsd: -1 } } }),
  );

  await assert.rejects(() => repository.getCurrent());
});

test("Firestore daily usage repository returns validated UTC usage", async () => {
  const repository = new FirestoreDailyUsageRepository(
    createDatabase({
      dailyUsage: {
        "2026-08-01": {
          date: "2026-08-01",
          amountUsd: 12.5,
          updatedAt: "2026-08-01T06:00:00.000Z",
        },
      },
    }),
  );

  assert.equal(await repository.getUsageUsd("2026-08-01"), 12.5);
  assert.equal(await repository.getUsageUsd("2026-08-02"), 0);
});

test("Firestore daily usage repository rejects invalid or mismatched data", async () => {
  const invalidAmount = new FirestoreDailyUsageRepository(
    createDatabase({
      dailyUsage: {
        "2026-08-01": {
          date: "2026-08-01",
          amountUsd: -1,
          updatedAt: "2026-08-01T06:00:00.000Z",
        },
      },
    }),
  );
  const mismatchedDate = new FirestoreDailyUsageRepository(
    createDatabase({
      dailyUsage: {
        "2026-08-01": {
          date: "2026-08-02",
          amountUsd: 1,
          updatedAt: "2026-08-01T06:00:00.000Z",
        },
      },
    }),
  );

  await assert.rejects(() => invalidAmount.getUsageUsd("2026-08-01"));
  await assert.rejects(
    () => mismatchedDate.getUsageUsd("2026-08-01"),
    /does not match date/,
  );
});
