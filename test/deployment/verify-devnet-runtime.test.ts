import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function run(readinessStatus = "healthy", rejectAudience = false) {
  const directory = mkdtempSync(join(tmpdir(), "coffergate-smoke-"));
  writeFileSync(join(directory, "gcloud"), `#!/usr/bin/env bash
if [[ "$*" == *"run services describe"* ]]; then echo "https://coffergate.example.run.app";
elif [[ "$*" == *"auth print-identity-token"* ]]; then
  if [[ "${rejectAudience ? "$*" : ""}" == *"--audiences="* ]]; then exit 1; fi
  echo "identity-token";
elif [[ "$*" == *"get-iam-policy"* ]]; then echo '{"bindings":[{"members":["serviceAccount:tasks@example.com"]}]}' ; fi
`);
  writeFileSync(join(directory, "curl"), `#!/usr/bin/env bash
if [[ "$*" == *"/health/live"* ]]; then echo '{"status":"ok"}';
else echo '{"data":{"overallStatus":"${readinessStatus}","dataMode":"live","network":"devnet","services":[{"serviceId":"control-plane","status":"healthy"},{"serviceId":"vertex-ai","status":"healthy"},{"serviceId":"firestore","status":"healthy"},{"serviceId":"private-executor","status":"healthy"},{"serviceId":"cloud-kms","status":"healthy"},{"serviceId":"jupiter-api","status":"healthy"},{"serviceId":"solana-rpc","status":"healthy"}]}}'; fi
`);
  chmodSync(join(directory, "gcloud"), 0o755);
  chmodSync(join(directory, "curl"), 0o755);
  return spawnSync("bash", ["scripts/verify-devnet-runtime.sh"], {
    cwd: process.cwd(), encoding: "utf8",
    env: {
      ...process.env, PATH: `${directory}:${process.env.PATH}`,
      PROJECT_ID: "project", REGION: "asia-northeast3", SERVICE_NAME: "backend",
    },
  });
}

test("Devnet smoke test verifies IAM, liveness, and readiness", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed IAM, liveness, and readiness checks/);
});

test("Devnet smoke test supports user account identity tokens", () => {
  const result = run("healthy", true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed IAM, liveness, and readiness checks/);
});

test("Devnet smoke test fails closed on unhealthy dependencies", () => {
  const result = run("down");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Runtime readiness is down/);
});
