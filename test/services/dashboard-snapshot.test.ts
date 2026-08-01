import assert from "node:assert/strict";
import test from "node:test";
import type { Policy } from "../../src/contracts/index.js";
import { InMemoryPolicyRepository } from "../../src/repositories/policy-repository.js";
import { DashboardSnapshotService } from "../../src/services/dashboard-snapshot.js";

const policy: Policy = {
  policyVersion: "policy-2026.08.1",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  allowedInputMints: ["So11111111111111111111111111111111111111112"],
  allowedOutputMints: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
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

const meta = {
  requestId: "request_01",
  generatedAt: "2026-08-01T06:00:00.000Z",
  environment: "devnet" as const,
};

test("dashboard snapshot combines policy and structured wallet state", async () => {
  const service = new DashboardSnapshotService({
    dataMode: "live",
    policyRepository: new InMemoryPolicyRepository(policy),
    walletStateProvider: {
      async getState() {
        return {
          address: "OperationsWallet111111111111111111111111111",
          solBalance: "1.25",
          usdcBalance: "14.83",
          targetUsdcBalance: "15.00",
          dailyUsageUsd: 4.83,
          lastSyncedAt: "2026-08-01T06:00:00.000Z",
        };
      },
    },
  });
  const snapshot = await service.getSnapshot(meta);

  assert.equal(snapshot.circuitBreaker, "ACTIVE");
  assert.equal(snapshot.policyVersion, policy.policyVersion);
  assert.deepEqual(snapshot.allowedAssets, ["SOL", "USDC"]);
  assert.deepEqual(snapshot.balances, { sol: "1.25", usdc: "14.83" });
  assert.equal(snapshot.dailyLimitUsd, 20);
});

test("dashboard snapshot defaults to halted when policy is absent", async () => {
  const service = new DashboardSnapshotService({
    dataMode: "live",
    policyRepository: new InMemoryPolicyRepository(),
    walletStateProvider: {
      async getState() {
        return { address: "unconfigured" };
      },
    },
  });
  const snapshot = await service.getSnapshot(meta);

  assert.equal(snapshot.circuitBreaker, "HALTED");
  assert.equal(snapshot.policyVersion, "unconfigured");
  assert.deepEqual(snapshot.allowedAssets, []);
});
