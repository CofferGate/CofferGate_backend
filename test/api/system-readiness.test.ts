import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { apiResponseSchema, systemReadinessSchema } from "../../src/contracts/index.js";
import { SystemReadinessService } from "../../src/services/system-readiness.js";

const config = {
  PORT: 8080,
  HOST: "0.0.0.0",
  ENVIRONMENT: "devnet",
  DATA_MODE: "live",
} as const;

test("GET /health/live reports process liveness", async () => {
  const app = createApp({ config });
  const response = await app.inject({ method: "GET", url: "/health/live" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  await app.close();
});

test("GET /api/v1/system/readiness returns the frontend envelope", async () => {
  const readinessService = new SystemReadinessService({
    dataMode: "live",
    network: "devnet",
    now: () => new Date("2026-08-01T06:00:00.000Z"),
    probes: {
      "vertex-ai": () => ({ status: "healthy" }),
      firestore: () => ({ status: "healthy" }),
      "private-executor": () => ({ status: "healthy" }),
      "cloud-kms": () => ({ status: "healthy" }),
      "jupiter-api": () => ({ status: "degraded", impact: "Rate limited" }),
      "solana-rpc": () => ({ status: "healthy" }),
    },
  });
  const app = createApp({ config, readinessService });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/system/readiness",
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(
    apiResponseSchema(systemReadinessSchema).safeParse(body).success,
    true,
  );
  assert.equal(body.data.overallStatus, "degraded");
  assert.equal(body.data.services.length, 7);
  assert.equal(body.meta.environment, "devnet");
  assert.equal(typeof body.meta.requestId, "string");
  await app.close();
});

test("probe failures become down without failing the endpoint", async () => {
  const readinessService = new SystemReadinessService({
    dataMode: "live",
    network: "devnet",
    probes: {
      "cloud-kms": async () => {
        throw new Error("KMS unavailable");
      },
    },
  });
  const app = createApp({ config, readinessService });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/system/readiness",
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.data.overallStatus, "down");
  assert.equal(
    body.data.services.find(
      (service: { serviceId: string }) => service.serviceId === "cloud-kms",
    ).status,
    "down",
  );
  await app.close();
});
