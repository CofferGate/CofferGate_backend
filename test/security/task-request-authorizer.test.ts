import assert from "node:assert/strict";
import test from "node:test";
import { BearerTaskRequestAuthorizer } from "../../src/security/task-request-authorizer.js";

test("task authorizer accepts only the configured bearer token", () => {
  const authorizer = new BearerTaskRequestAuthorizer("a".repeat(32));
  assert.equal(authorizer.authorize(`Bearer ${"a".repeat(32)}`), true);
  assert.equal(authorizer.authorize(`Bearer ${"b".repeat(32)}`), false);
  assert.equal(authorizer.authorize(undefined), false);
});
