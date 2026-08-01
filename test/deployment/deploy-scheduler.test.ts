import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("scheduler deployment configures OIDC and retry-safe generation", () => {
  const directory = mkdtempSync(join(tmpdir(), "coffergate-scheduler-"));
  const logPath = join(directory, "gcloud.log");
  const gcloudPath = join(directory, "gcloud");
  writeFileSync(
    gcloudPath,
    `#!/usr/bin/env bash
echo "$*" >> "$GCLOUD_LOG"
if [[ "$*" == *"run services describe"* ]]; then
  echo "https://coffergate.example.run.app"
elif [[ "$*" == *"secrets versions access"* ]]; then
  printf 'abcdefghijklmnopqrstuvwxyz123456'
elif [[ "$*" == *"scheduler jobs describe"* ]]; then
  exit 1
fi
`,
  );
  chmodSync(gcloudPath, 0o755);

  const result = spawnSync("bash", ["scripts/deploy-scheduler.sh"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      GCLOUD_LOG: logPath,
      PROJECT_ID: "project",
      REGION: "asia-northeast3",
      SERVICE_NAME: "coffergate-backend",
      SCHEDULER_JOB_NAME: "proposal-generation",
      SCHEDULER_SERVICE_ACCOUNT: "scheduler@project.iam.gserviceaccount.com",
      INTERNAL_TASK_TOKEN_SECRET: "internal-token",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const log = readFileSync(logPath, "utf8");
  assert.match(log, /scheduler jobs create http proposal-generation/);
  assert.match(log, /--oidc-token-audience=https:\/\/coffergate\.example\.run\.app/);
  assert.match(log, /--max-retry-attempts=5/);
  assert.doesNotMatch(result.stdout, /abcdefghijklmnopqrstuvwxyz123456/);
});
