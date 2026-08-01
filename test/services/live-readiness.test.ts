import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config.js";
import { createLiveReadinessProbes } from "../../src/services/create-live-readiness-service.js";
import { SystemReadinessService } from "../../src/services/system-readiness.js";

const config = loadConfig({
  GOOGLE_CLOUD_PROJECT: "project",
  CLOUD_KMS_KEY_VERSION: "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1",
  OPERATIONS_WALLET_ADDRESS: "wallet",
  USDC_TOKEN_ACCOUNT: "token-account",
  CLOUD_TASKS_QUEUE: "execution",
});

test("live readiness probes check every external execution dependency", async () => {
  const calls: string[] = [];
  const probes = createLiveReadinessProbes(config, {
    checkFirestore: async () => { calls.push("firestore"); },
    checkKms: async () => { calls.push("kms"); },
    checkJupiter: async () => { calls.push("jupiter"); },
    checkSolana: async () => { calls.push("solana"); },
  });
  const readiness = await new SystemReadinessService({
    dataMode: "live",
    network: "devnet",
    probes,
    now: () => new Date("2026-08-01T06:00:00.000Z"),
  }).getReadiness();

  assert.equal(readiness.overallStatus, "healthy");
  assert.deepEqual(calls.sort(), ["firestore", "jupiter", "kms", "solana"]);
  assert.equal(readiness.services.every((service) => service.status === "healthy"), true);
});

test("live readiness isolates failed dependencies", async () => {
  const probes = createLiveReadinessProbes(config, {
    checkFirestore: async () => undefined,
    checkKms: async () => { throw new Error("unavailable"); },
    checkJupiter: async () => undefined,
    checkSolana: async () => undefined,
  });
  const readiness = await new SystemReadinessService({
    dataMode: "live",
    network: "devnet",
    probes,
  }).getReadiness();

  assert.equal(readiness.overallStatus, "down");
  assert.equal(
    readiness.services.find((service) => service.serviceId === "cloud-kms")?.status,
    "down",
  );
  assert.equal(
    readiness.services.find((service) => service.serviceId === "solana-rpc")?.status,
    "healthy",
  );
});
