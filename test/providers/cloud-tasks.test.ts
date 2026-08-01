import assert from "node:assert/strict";
import test from "node:test";
import { ConfirmationTaskScheduler, ExecutionTaskScheduler } from "../../src/providers/cloud-tasks.js";

function createClient(createTask: (request: unknown) => Promise<unknown>) {
  return {
    queuePath: (_project: string, _location: string, queue: string) => `queues/${queue}`,
    taskPath: (_project: string, _location: string, _queue: string, task: string) => `tasks/${task}`,
    createTask,
  } as never;
}

test("Cloud Tasks scheduler creates authenticated deterministic task", async () => {
  let captured: unknown;
  const scheduler = new ConfirmationTaskScheduler({
    projectId: "project",
    location: "asia-northeast3",
    queue: "confirmation",
    targetBaseUrl: "https://backend.example.com",
    oidcServiceAccountEmail: "tasks@project.iam.gserviceaccount.com",
    internalTaskToken: "a".repeat(32),
    scheduleDelaySeconds: 5,
    now: () => new Date("2026-08-01T00:00:00.000Z"),
    client: createClient(async (request) => {
      captured = request;
      return [{ name: "created-task" }];
    }),
  });

  assert.deepEqual(await scheduler.schedule("proposal/01"), {
    status: "SCHEDULED",
    taskName: "created-task",
  });
  const request = captured as {
    task: {
      name: string;
      scheduleTime: { seconds: number };
      httpRequest: {
        url: string;
        headers: Record<string, string>;
        oidcToken: { serviceAccountEmail: string; audience: string };
      };
    };
  };
  assert.match(request.task.name, /^tasks\/confirm-[a-f0-9]{32}$/);
  assert.equal(
    request.task.httpRequest.url,
    "https://backend.example.com/internal/v1/executions/proposal%2F01/confirm",
  );
  assert.equal(
    request.task.httpRequest.headers["x-coffergate-task-token"],
    "a".repeat(32),
  );
  assert.equal(
    request.task.httpRequest.oidcToken.serviceAccountEmail,
    "tasks@project.iam.gserviceaccount.com",
  );
  assert.equal(
    request.task.scheduleTime.seconds,
    Math.floor(new Date("2026-08-01T00:00:05.000Z").getTime() / 1_000),
  );
});

test("Cloud Tasks scheduler treats duplicate task names as idempotent", async () => {
  const scheduler = new ConfirmationTaskScheduler({
    projectId: "project",
    location: "location",
    queue: "queue",
    targetBaseUrl: "https://backend.example.com",
    oidcServiceAccountEmail: "tasks@project.iam.gserviceaccount.com",
    internalTaskToken: "a".repeat(32),
    client: createClient(async () => {
      throw Object.assign(new Error("already exists"), { code: 6 });
    }),
  });

  const result = await scheduler.schedule("proposal_01");
  assert.equal(result.status, "ALREADY_SCHEDULED");
  assert.match(result.taskName, /^tasks\/confirm-[a-f0-9]{32}$/);
});

test("Cloud Tasks scheduler creates authenticated execution tasks", async () => {
  let captured: unknown;
  const scheduler = new ExecutionTaskScheduler({
    projectId: "project",
    location: "asia-northeast3",
    queue: "execution",
    targetBaseUrl: "https://backend.example.com",
    oidcServiceAccountEmail: "tasks@project.iam.gserviceaccount.com",
    internalTaskToken: "a".repeat(32),
    client: createClient(async (request) => {
      captured = request;
      return [{ name: "created-execution-task" }];
    }),
  });

  assert.deepEqual(await scheduler.schedule("proposal/01"), {
    status: "SCHEDULED",
    taskName: "created-execution-task",
  });
  const request = captured as { task: { name: string; httpRequest: { url: string } } };
  assert.match(request.task.name, /^tasks\/submit-[a-f0-9]{32}$/);
  assert.equal(
    request.task.httpRequest.url,
    "https://backend.example.com/internal/v1/executions/proposal%2F01/submit",
  );
});
