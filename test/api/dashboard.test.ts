import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import {
  apiResponseSchema,
  consoleSnapshotSchema,
  type Policy,
} from "../../src/contracts/index.js";
import { InMemoryPolicyRepository } from "../../src/repositories/policy-repository.js";
import { DashboardSnapshotService } from "../../src/services/dashboard-snapshot.js";

const config = {
  PORT: 8080,
  HOST: "0.0.0.0",
  ENVIRONMENT: "devnet",
  DATA_MODE: "live",
  OPERATIONS_WALLET_ADDRESS: "unconfigured",
} as const;

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

test("GET /api/v1/dashboard returns a structured console snapshot", async () => {
  const policyRepository = new InMemoryPolicyRepository(policy);
  const dashboardSnapshotService = new DashboardSnapshotService({
    dataMode: "live",
    policyRepository,
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
  const app = createApp({ config, policyRepository, dashboardSnapshotService });
  const response = await app.inject({ method: "GET", url: "/api/v1/dashboard" });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(
    apiResponseSchema(consoleSnapshotSchema).safeParse(body).success,
    true,
  );
  assert.equal(body.data.operationsWallet.startsWith("OperationsWallet"), true);
  assert.equal(body.data.balances.usdc, "14.83");
  assert.equal(body.data.meta.requestId, body.meta.requestId);
  await app.close();
});

test("GET /api/v1/dashboard defaults to halted and unconfigured", async () => {
  const app = createApp({ config });
  const response = await app.inject({ method: "GET", url: "/api/v1/dashboard" });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.data.circuitBreaker, "HALTED");
  assert.equal(body.data.operationsWallet, "unconfigured");
  assert.equal(body.data.policyVersion, "unconfigured");
  await app.close();
});
