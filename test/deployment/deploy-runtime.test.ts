import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("runtime deployment binds least privilege IAM and secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "coffergate-runtime-"));
  const logPath = join(directory, "gcloud.log");
  const gcloudPath = join(directory, "gcloud");
  writeFileSync(gcloudPath, `#!/usr/bin/env bash
echo "$*" >> "$GCLOUD_LOG"
if [[ "$*" == *"run services describe"* ]]; then echo "https://coffergate.example.run.app"; fi
`);
  chmodSync(gcloudPath, 0o755);
  const result = spawnSync("bash", ["scripts/deploy-runtime.sh"], {
    cwd: process.cwd(), encoding: "utf8",
    env: {
      ...process.env, PATH: `${directory}:${process.env.PATH}`, GCLOUD_LOG: logPath,
      PROJECT_ID: "project", REGION: "asia-northeast3", SERVICE_NAME: "backend",
      IMAGE_URI: "asia-northeast3-docker.pkg.dev/project/repo/backend:build",
      RUNTIME_SERVICE_ACCOUNT: "runtime@project.iam.gserviceaccount.com",
      TASKS_SERVICE_ACCOUNT: "tasks@project.iam.gserviceaccount.com", TASKS_QUEUE: "execution",
      INTERNAL_TASK_TOKEN_SECRET: "internal-token", JUPITER_API_KEY_SECRET: "jupiter-key",
      CLOUD_KMS_KEY_VERSION: "projects/project/locations/asia-northeast3/keyRings/ring/cryptoKeys/key/cryptoKeyVersions/1",
      OPERATIONS_WALLET_ADDRESS: "wallet", USDC_MINT: "usdc", USDC_TOKEN_ACCOUNT: "account",
      TARGET_USDC_BALANCE: "20",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const log = readFileSync(logPath, "utf8");
  assert.match(log, /roles\/datastore\.user/);
  assert.match(log, /roles\/aiplatform\.user/);
  assert.match(log, /roles\/cloudtasks\.enqueuer/);
  assert.match(log, /roles\/cloudkms\.signerVerifier/);
  assert.match(log, /roles\/cloudkms\.publicKeyViewer/);
  assert.match(log, /roles\/secretmanager\.secretAccessor/);
  assert.match(log, /--set-secrets=INTERNAL_TASK_TOKEN=internal-token:latest,JUPITER_API_KEY=jupiter-key:latest/);
  assert.match(log, /--no-allow-unauthenticated/);
  assert.match(log, /CLOUD_TASKS_TARGET_BASE_URL=https:\/\/coffergate\.example\.run\.app/);
});
