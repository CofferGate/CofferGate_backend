import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { TaskTokenAuthorizer } from "../../src/security/task-request-authorizer.js";

const config = {
  ENVIRONMENT: "devnet",
  DATA_MODE: "live",
  OPERATIONS_WALLET_ADDRESS: "unconfigured",
} as const;
const token = "a".repeat(32);
const body = { proposalId: "proposal_01" };

function createInternalApp(result: unknown) {
  return createApp({
    config,
    trustedProposalGenerationService: {
      async generate() {
        return result;
      },
    } as never,
    taskRequestAuthorizer: new TaskTokenAuthorizer(token),
  });
}

test("internal proposal generation rejects unauthenticated requests", async () => {
  const app = createInternalApp({ status: "EVALUATED" });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/proposals/generate",
    payload: body,
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().retryable, false);
  await app.close();
});

test("internal proposal generation rejects invalid inputs", async () => {
  const app = createInternalApp({ status: "EVALUATED" });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/proposals/generate",
    headers: { "x-coffergate-task-token": token },
    payload: { proposalId: "" },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    status: "INVALID_REQUEST",
    retryable: false,
  });
  await app.close();
});

test("internal proposal generation returns terminal success", async () => {
  const result = { status: "ALREADY_PROCESSED", proposal: { proposalId: "p1" } };
  const app = createInternalApp(result);
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/proposals/generate",
    headers: { "x-coffergate-task-token": token },
    payload: body,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ...result, retryable: false });
  await app.close();
});

test("internal proposal generation marks transient failures retryable", async () => {
  for (const [status, statusCode] of [
    ["PERSISTENCE_INCONSISTENCY", 503],
    ["CONFLICT", 409],
  ] as const) {
    const app = createInternalApp({ status });
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/proposals/generate",
      headers: { "x-coffergate-task-token": token },
      payload: body,
    });

    assert.equal(response.statusCode, statusCode);
    assert.equal(response.json().retryable, true);
    await app.close();
  }
});

test("internal proposal generation rejects permanent ID conflicts", async () => {
  const app = createInternalApp({ status: "ID_CONFLICT" });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/proposals/generate",
    headers: { "x-coffergate-task-token": token },
    payload: body,
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().retryable, false);
  await app.close();
});

test("internal proposal generation rejects an unconfigured policy", async () => {
  const app = createInternalApp({ status: "POLICY_NOT_CONFIGURED" });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/proposals/generate",
    headers: { "x-coffergate-task-token": token },
    payload: body,
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().retryable, false);
  await app.close();
});
