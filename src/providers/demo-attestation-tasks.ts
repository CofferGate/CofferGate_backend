import { createHash } from "node:crypto";
import { CloudTasksClient } from "@google-cloud/tasks";

type TasksClient = Pick<CloudTasksClient, "queuePath" | "taskPath" | "createTask">;

export interface DemoAttestationTaskOptions {
  projectId: string;
  location: string;
  queue: string;
  targetBaseUrl: string;
  oidcServiceAccountEmail: string;
  internalTaskToken: string;
  client?: TasksClient;
}

export class DemoAttestationTaskScheduler {
  private readonly client: TasksClient;

  constructor(private readonly options: DemoAttestationTaskOptions) {
    this.client = options.client ?? new CloudTasksClient();
  }

  async schedule(proposalId: string) {
    const parent = this.client.queuePath(
      this.options.projectId,
      this.options.location,
      this.options.queue,
    );
    const taskId = `attest-${createHash("sha256").update(proposalId).digest("hex").slice(0, 32)}`;
    const taskName = this.client.taskPath(
      this.options.projectId,
      this.options.location,
      this.options.queue,
      taskId,
    );
    try {
      const [task] = await this.client.createTask({
        parent,
        task: {
          name: taskName,
          httpRequest: {
            httpMethod: "POST",
            url: new URL(
              `/internal/v1/devnet-payments/${encodeURIComponent(proposalId)}`,
              this.options.targetBaseUrl,
            ).toString(),
            headers: { "x-coffergate-task-token": this.options.internalTaskToken },
            oidcToken: {
              serviceAccountEmail: this.options.oidcServiceAccountEmail,
              audience: this.options.targetBaseUrl,
            },
          },
        },
      });
      return { status: "SCHEDULED" as const, taskName: task.name ?? taskName };
    } catch (error) {
      if ((error as { code?: number }).code === 6) {
        return { status: "ALREADY_SCHEDULED" as const, taskName };
      }
      throw error;
    }
  }
}
