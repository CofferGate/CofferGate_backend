import assert from "node:assert/strict";
import test from "node:test";
import type { Policy, Proposal } from "../../src/contracts/index.js";
import type {
  FirestoreDatabase,
  FirestoreDocumentSnapshot,
} from "../../src/infrastructure/firestore.js";
import { FirestorePolicyRepository } from "../../src/repositories/policy-repository.js";
import { FirestoreProposalRepository } from "../../src/repositories/proposal-repository.js";

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
      const records = collections[collectionPath] ?? {};
      return {
        async get() {
          return {
            docs: Object.keys(records).map((documentId) =>
              createDocument(documentId, records),
            ),
          };
        },
        doc(documentId) {
          return {
            async get() {
              return createDocument(documentId, records);
            },
          };
        },
      };
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

test("Firestore proposal repository rejects mismatched document IDs", async () => {
  const repository = new FirestoreProposalRepository(
    createDatabase({ proposals: { wrong_id: proposal } }),
  );

  await assert.rejects(() => repository.list(), /does not match proposalId/);
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
