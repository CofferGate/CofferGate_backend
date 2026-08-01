import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("backend quality workflow enforces locked, least-privilege verification", () => {
  const workflow = readFileSync(".github/workflows/backend-quality.yml", "utf8");

  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version: 20/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm run typecheck/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run build/);
  assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
  assert.match(workflow, /docker build --tag coffergate-backend:ci/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /write/);
});
