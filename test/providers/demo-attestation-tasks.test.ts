import assert from "node:assert/strict";
import test from "node:test";
import { DemoAttestationTaskScheduler } from "../../src/providers/demo-attestation-tasks.js";

test("demo attestation task is deterministic and authenticated", async () => {
  const requests: unknown[] = [];
  const scheduler = new DemoAttestationTaskScheduler({
    projectId: "project", location: "location", queue: "demo",
    targetBaseUrl: "https://backend.example.com", oidcServiceAccountEmail: "tasks@example.com",
    internalTaskToken: "internal-token",
    client: {
      queuePath: () => "queues/demo",
      taskPath: (_p: string, _l: string, _q: string, id: string) => `tasks/${id}`,
      async createTask(request: { task?: { name?: string } }) {
        requests.push(request);
        return [{ name: request.task?.name }];
      },
    } as never,
  });
  const result = await scheduler.schedule("proposal-01");
  assert.equal(result.status, "SCHEDULED");
  assert.match(JSON.stringify(requests[0]), /devnet-payments\/proposal-01/);
  assert.match(JSON.stringify(requests[0]), /tasks@example\.com/);
  assert.match(JSON.stringify(requests[0]), /internal-token/);
});
