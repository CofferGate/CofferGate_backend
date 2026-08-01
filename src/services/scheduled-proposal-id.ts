import { createHash } from "node:crypto";
import { z } from "zod";

const schedulerInvocationSchema = z.object({
  jobName: z.string().min(1),
  scheduleTime: z.string().datetime({ offset: true }),
});

export function createScheduledProposalId(
  jobName: string,
  scheduleTime: string,
): string {
  const invocation = schedulerInvocationSchema.parse({ jobName, scheduleTime });
  const digest = createHash("sha256")
    .update(`${invocation.jobName}\n${invocation.scheduleTime}`)
    .digest("hex")
    .slice(0, 24);
  return `proposal_${digest}`;
}
