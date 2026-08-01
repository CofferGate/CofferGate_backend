import { createHash } from "node:crypto";
import { CloudTasksClient } from "@google-cloud/tasks";

type CloudTasksClientLike = Pick<
  CloudTasksClient,
  "queuePath" | "taskPath" | "createTask"
>;

export interface ConfirmationTaskSchedulerOptions {
  projectId: string;
  location: string;
  queue: string;
  targetBaseUrl: string;
  oidcServiceAccountEmail: string;
  internalTaskToken: string;
  scheduleDelaySeconds?: number;
  client?: CloudTasksClientLike;
  now?: () => Date;
}

export type ConfirmationTaskScheduleResult =
  | { status: "SCHEDULED"; taskName: string }
  | { status: "ALREADY_SCHEDULED"; taskName: string };

export type ExecutionTaskScheduleResult = ConfirmationTaskScheduleResult;

export class ConfirmationTaskScheduler {
  private readonly client: CloudTasksClientLike;

  constructor(private readonly options: ConfirmationTaskSchedulerOptions) {
    this.client = options.client ?? new CloudTasksClient();
  }

  async schedule(proposalId: string): Promise<ConfirmationTaskScheduleResult> {
    const parent = this.client.queuePath(
      this.options.projectId,
      this.options.location,
      this.options.queue,
    );
    const taskId = `confirm-${createHash("sha256")
      .update(proposalId)
      .digest("hex")
      .slice(0, 32)}`;
    const taskName = this.client.taskPath(
      this.options.projectId,
      this.options.location,
      this.options.queue,
      taskId,
    );
    const scheduledAt = new Date(
      (this.options.now?.() ?? new Date()).getTime() +
        (this.options.scheduleDelaySeconds ?? 5) * 1_000,
    );
    const targetUrl = new URL(
      `/internal/v1/executions/${encodeURIComponent(proposalId)}/confirm`,
      this.options.targetBaseUrl,
    ).toString();

    try {
      const [task] = await this.client.createTask({
        parent,
        task: {
          name: taskName,
          scheduleTime: { seconds: Math.floor(scheduledAt.getTime() / 1_000) },
          httpRequest: {
            httpMethod: "POST",
            url: targetUrl,
            headers: {
              "content-type": "application/json",
              "x-coffergate-task-token": this.options.internalTaskToken,
            },
            oidcToken: {
              serviceAccountEmail: this.options.oidcServiceAccountEmail,
              audience: this.options.targetBaseUrl,
            },
          },
        },
      });
      return { status: "SCHEDULED", taskName: task.name ?? taskName };
    } catch (error) {
      if ((error as { code?: number }).code === 6) {
        return { status: "ALREADY_SCHEDULED", taskName };
      }
      throw error;
    }
  }
}

export class ExecutionTaskScheduler {
  private readonly client: CloudTasksClientLike;

  constructor(private readonly options: ConfirmationTaskSchedulerOptions) {
    this.client = options.client ?? new CloudTasksClient();
  }

  async schedule(proposalId: string): Promise<ExecutionTaskScheduleResult> {
    const parent = this.client.queuePath(
      this.options.projectId,
      this.options.location,
      this.options.queue,
    );
    const taskId = `submit-${createHash("sha256")
      .update(proposalId)
      .digest("hex")
      .slice(0, 32)}`;
    const taskName = this.client.taskPath(
      this.options.projectId,
      this.options.location,
      this.options.queue,
      taskId,
    );
    const targetUrl = new URL(
      `/internal/v1/executions/${encodeURIComponent(proposalId)}/submit`,
      this.options.targetBaseUrl,
    ).toString();

    try {
      const [task] = await this.client.createTask({
        parent,
        task: {
          name: taskName,
          httpRequest: {
            httpMethod: "POST",
            url: targetUrl,
            headers: {
              "content-type": "application/json",
              "x-coffergate-task-token": this.options.internalTaskToken,
            },
            oidcToken: {
              serviceAccountEmail: this.options.oidcServiceAccountEmail,
              audience: this.options.targetBaseUrl,
            },
          },
        },
      });
      return { status: "SCHEDULED", taskName: task.name ?? taskName };
    } catch (error) {
      if ((error as { code?: number }).code === 6) {
        return { status: "ALREADY_SCHEDULED", taskName };
      }
      throw error;
    }
  }
}
