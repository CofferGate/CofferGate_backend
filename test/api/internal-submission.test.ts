import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { TaskTokenAuthorizer } from "../../src/security/task-request-authorizer.js";

const config = {
  ENVIRONMENT: "devnet",
  DATA_MODE: "live",
  OPERATIONS_WALLET_ADDRESS: "wallet",
} as const;
const token = "s".repeat(32);

function createInternalApp(result: unknown) {
  return createApp({
    config,
    executionSubmissionWorkflow: {
      async execute() { return result; },
    } as never,
    taskRequestAuthorizer: new TaskTokenAuthorizer(token),
  });
}

test("internal submission endpoint rejects unauthenticated requests", async () => {
  const app = createInternalApp({ status: "SUBMITTED", signature: "sig" });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/executions/p1/submit",
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().retryable, false);
  await app.close();
});

test("internal submission endpoint returns submitted signatures", async () => {
  const app = createInternalApp({ status: "SUBMITTED", signature: "sig" });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/executions/p1/submit",
    headers: { "x-coffergate-task-token": token },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "SUBMITTED", signature: "sig", retryable: false,
  });
  await app.close();
});

test("internal submission endpoint maps terminal and retryable outcomes", async () => {
  for (const [status, statusCode, retryable] of [
    ["NOT_FOUND", 404, false],
    ["NOT_EXECUTABLE", 409, false],
    ["POLICY_REJECTED", 409, false],
    ["SIMULATION_FAILED", 422, false],
    ["CONFLICT", 409, true],
  ] as const) {
    const app = createInternalApp({ status });
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/executions/p1/submit",
      headers: { "x-coffergate-task-token": token },
    });
    assert.equal(response.statusCode, statusCode);
    assert.equal(response.json().retryable, retryable);
    await app.close();
  }
});
