import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_SERVICE_IDS,
  systemReadinessSchema,
} from "../../src/contracts/index.js";

const checkedAt = "2026-08-01T06:00:00.000Z";

function readinessWith(
  overrides: Partial<Record<(typeof SYSTEM_SERVICE_IDS)[number], string>> = {},
) {
  const services = SYSTEM_SERVICE_IDS.map((serviceId) => ({
    serviceId,
    status: overrides[serviceId] ?? "healthy",
    checkedAt,
  }));
  const statuses = services.map((service) => service.status);
  const overallStatus = statuses.includes("down")
    ? "down"
    : statuses.includes("degraded")
      ? "degraded"
      : statuses.every((status) => status === "healthy")
        ? "healthy"
        : "unknown";

  return {
    overallStatus,
    checkedAt,
    dataMode: "live",
    network: "devnet",
    services,
  };
}

test("readiness accepts every required service exactly once", () => {
  assert.equal(systemReadinessSchema.safeParse(readinessWith()).success, true);
});

test("readiness derives degraded and down precedence", () => {
  assert.equal(
    systemReadinessSchema.safeParse(
      readinessWith({ "jupiter-api": "degraded" }),
    ).success,
    true,
  );
  assert.equal(
    systemReadinessSchema.safeParse(
      readinessWith({ "jupiter-api": "degraded", "cloud-kms": "down" }),
    ).success,
    true,
  );
});

test("readiness rejects missing services", () => {
  const readiness = readinessWith();
  readiness.services.pop();

  assert.equal(systemReadinessSchema.safeParse(readiness).success, false);
});

test("readiness rejects an inconsistent overall status", () => {
  const readiness = readinessWith({ "solana-rpc": "down" });

  assert.equal(
    systemReadinessSchema.safeParse({
      ...readiness,
      overallStatus: "healthy",
    }).success,
    false,
  );
});
