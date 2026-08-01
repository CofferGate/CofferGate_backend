import assert from "node:assert/strict";
import test from "node:test";
import { createScheduledProposalId } from "../../src/services/scheduled-proposal-id.js";

test("scheduled proposal IDs are stable across retries", () => {
  const first = createScheduledProposalId("projects/p/locations/l/jobs/j", "2026-08-01T06:00:00Z");
  const retry = createScheduledProposalId("projects/p/locations/l/jobs/j", "2026-08-01T06:00:00Z");
  assert.equal(first, retry);
  assert.match(first, /^proposal_[a-f0-9]{24}$/);
});

test("scheduled proposal IDs separate jobs and invocations", () => {
  assert.notEqual(
    createScheduledProposalId("job-a", "2026-08-01T06:00:00Z"),
    createScheduledProposalId("job-b", "2026-08-01T06:00:00Z"),
  );
  assert.notEqual(
    createScheduledProposalId("job-a", "2026-08-01T06:00:00Z"),
    createScheduledProposalId("job-a", "2026-08-01T06:05:00Z"),
  );
  assert.throws(() => createScheduledProposalId("job-a", "invalid"));
});
