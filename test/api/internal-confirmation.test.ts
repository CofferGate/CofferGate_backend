import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { BearerTaskRequestAuthorizer } from "../../src/security/task-request-authorizer.js";

const config = {
  ENVIRONMENT: "devnet",
  DATA_MODE: "live",
  OPERATIONS_WALLET_ADDRESS: "unconfigured",
} as const;
const token = "a".repeat(32);

function createInternalApp(result: unknown) {
  return createApp({
    config,
    executionConfirmationPoller: {
      async poll() {
        return result;
      },
    } as never,
    taskRequestAuthorizer: new BearerTaskRequestAuthorizer(token),
  });
}

test("internal confirmation endpoint rejects unauthenticated requests", async () => {
  const app = createInternalApp({ status: "NOT_FOUND" });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/executions/p1/confirm",
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().retryable, false);
  await app.close();
});

test("internal confirmation endpoint requests retry while waiting", async () => {
  const app = createInternalApp({ status: "WAITING", reason: "PENDING" });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/executions/p1/confirm",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["retry-after"], "5");
  assert.equal(response.json().retryable, true);
  await app.close();
});

test("internal confirmation endpoint acknowledges terminal results", async () => {
  const app = createInternalApp({ status: "PROCESSED", result: { status: "NOT_FOUND" } });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/executions/p1/confirm",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().retryable, false);
  await app.close();
});
