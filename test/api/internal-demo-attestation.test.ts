import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../src/app.js";
import { TaskTokenAuthorizer } from "../../src/security/task-request-authorizer.js";

const config = {
  ENVIRONMENT: "devnet" as const,
  DATA_MODE: "live" as const,
  OPERATIONS_WALLET_ADDRESS: "wallet",
  LOG_LEVEL: undefined,
};

test("internal demo attestation requires task authentication", async () => {
  const app = createApp({
    config,
    demoAttestationService: { attest: async () => ({ status: "NOT_FOUND" }) } as never,
    taskRequestAuthorizer: new TaskTokenAuthorizer("a-secure-internal-task-token-12345"),
  });
  const response = await app.inject({ method: "POST", url: "/internal/v1/demo-attestations/p1" });
  assert.equal(response.statusCode, 401);
});

test("internal demo attestation returns terminal demo result", async () => {
  const app = createApp({
    config,
    demoAttestationService: { attest: async () => ({ status: "ATTESTED", proposal: {} }) } as never,
    taskRequestAuthorizer: new TaskTokenAuthorizer("a-secure-internal-task-token-12345"),
  });
  const response = await app.inject({
    method: "POST",
    url: "/internal/v1/demo-attestations/p1",
    headers: { "x-coffergate-task-token": "a-secure-internal-task-token-12345" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "ATTESTED");
});
