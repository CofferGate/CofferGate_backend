import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function environment(directory: string) {
  return {
    ...process.env, PATH: `${directory}:${process.env.PATH}`,
    PROJECT_ID: "project", REGION: "asia-northeast3", SERVICE_NAME: "backend",
    PROPOSAL_ID: "proposal-1", INTERNAL_TASK_TOKEN_SECRET: "internal-token",
    MAX_E2E_AMOUNT_USD: "1", POLL_ATTEMPTS: "1", POLL_INTERVAL_SECONDS: "0",
  };
}

test("Devnet execution requires explicit authorization", () => {
  const result = spawnSync("bash", ["scripts/verify-devnet-execution.sh"], {
    cwd: process.cwd(), encoding: "utf8", env: environment(mkdtempSync(join(tmpdir(), "e2e-deny-"))),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CONFIRM_DEVNET_EXECUTION=YES/);
});

test("Devnet execution submits one bounded proposal and verifies reconciliation", () => {
  const directory = mkdtempSync(join(tmpdir(), "coffergate-e2e-"));
  writeFileSync(join(directory, "gcloud"), `#!/usr/bin/env bash
if [[ "$*" == *"run services describe"* ]]; then echo "https://coffergate.example.run.app";
elif [[ "$*" == *"auth print-identity-token"* ]]; then echo "identity-token";
elif [[ "$*" == *"secrets versions access"* ]]; then printf 'abcdefghijklmnopqrstuvwxyz123456'; fi
`);
  writeFileSync(join(directory, "curl"), `#!/usr/bin/env bash
if [[ "$*" == *"/submit"* ]]; then echo '{"status":"SUBMITTED","signature":"signature-1"}';
elif [[ "$*" == *"/api/v1/proposals/"* ]]; then
  if [[ "$*" == *"authorization"* && -f "$E2E_SUBMITTED" ]]; then
    echo '{"data":{"status":"RECONCILED","execution":{"transactionSignature":"signature-1","reconciliation":{"status":"MATCHED"}}},"meta":{"environment":"devnet"}}';
  else
    touch "$E2E_SUBMITTED"; echo '{"data":{"status":"POLICY_APPROVED","decision":"AUTO","action":"SWAP","amountUsd":0.5},"meta":{"environment":"devnet"}}';
  fi
fi
`);
  chmodSync(join(directory, "gcloud"), 0o755);
  chmodSync(join(directory, "curl"), 0o755);
  const result = spawnSync("bash", ["scripts/verify-devnet-execution.sh"], {
    cwd: process.cwd(), encoding: "utf8",
    env: { ...environment(directory), CONFIRM_DEVNET_EXECUTION: "YES", E2E_SUBMITTED: join(directory, "submitted") },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reconciled with signature signature-1/);
});
