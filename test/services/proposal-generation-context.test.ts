import assert from "node:assert/strict";
import test from "node:test";
import type { Policy } from "../../src/contracts/index.js";
import { InMemoryPolicyRepository } from "../../src/repositories/policy-repository.js";
import { ProposalGenerationContextService } from "../../src/services/proposal-generation-context.js";

const policy: Policy = {
  policyVersion: "policy-2026.08.1",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  allowedInputMints: ["sol-mint"],
  allowedOutputMints: ["usdc-mint"],
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

function createService(options: { policy?: Policy; priceObservedAt?: string } = {}) {
  return new ProposalGenerationContextService({
    policyRepository: new InMemoryPolicyRepository(
      options.policy === undefined ? policy : options.policy,
    ),
    treasurySnapshotProvider: {
      async getSnapshot() {
        return {
          solBalance: "1.25",
          usdcBalance: "10.00",
          targetUsdcBalance: "15.00",
          assetMints: { SOL: "sol-mint", USDC: "usdc-mint" },
          observedAt: "2026-08-01T06:00:00.000Z",
          evidenceRefs: [
            {
              id: "treasury_01",
              label: "Treasury balances",
              sourceType: "ONCHAIN_BALANCE" as const,
              observedAt: "2026-08-01T06:00:00.000Z",
            },
          ],
        };
      },
    },
    solPriceProvider: {
      async getSolPrice() {
        return {
          priceUsd: 200,
          observedAt:
            options.priceObservedAt ?? "2026-08-01T06:00:30.000Z",
          evidenceRef: {
            id: "price_01",
            label: "SOL price",
            sourceType: "MARKET_DATA" as const,
            observedAt:
              options.priceObservedAt ?? "2026-08-01T06:00:30.000Z",
          },
        };
      },
    },
    proposalTtlSeconds: 300,
    now: () => new Date("2026-08-01T06:01:00.000Z"),
  });
}

test("proposal context derives trusted generation input", async () => {
  const result = await createService().build("proposal_01");

  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.input.policyVersion, policy.policyVersion);
    assert.equal(result.input.dataAsOf, "2026-08-01T06:00:00.000Z");
    assert.equal(result.input.expiresAt, "2026-08-01T06:06:00.000Z");
    assert.deepEqual(
      result.input.evidenceRefs.map((evidence) => evidence.id),
      ["treasury_01", "price_01"],
    );
  }
});

test("proposal context stops before providers when policy is missing", async () => {
  let providerCalls = 0;
  const service = new ProposalGenerationContextService({
    policyRepository: new InMemoryPolicyRepository(),
    treasurySnapshotProvider: {
      async getSnapshot() {
        providerCalls += 1;
        throw new Error("must not run");
      },
    },
    solPriceProvider: {
      async getSolPrice() {
        providerCalls += 1;
        throw new Error("must not run");
      },
    },
    proposalTtlSeconds: 300,
  });

  assert.deepEqual(await service.build("proposal_01"), {
    status: "POLICY_NOT_CONFIGURED",
  });
  assert.equal(providerCalls, 0);
});

test("proposal context rejects future market evidence", async () => {
  await assert.rejects(
    () =>
      createService({ priceObservedAt: "2026-08-01T06:02:00.000Z" }).build(
        "proposal_01",
      ),
    /must not be observed in the future/,
  );
});

test("proposal context requires a positive TTL", () => {
  assert.throws(
    () =>
      new ProposalGenerationContextService({
        policyRepository: new InMemoryPolicyRepository(),
        treasurySnapshotProvider: { async getSnapshot() { throw new Error(); } },
        solPriceProvider: { async getSolPrice() { throw new Error(); } },
        proposalTtlSeconds: 0,
      }),
    /positive integer/,
  );
});
