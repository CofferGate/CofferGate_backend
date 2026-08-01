import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createRepositories } from "./repositories/create-repositories.js";
import { TaskTokenAuthorizer } from "./security/task-request-authorizer.js";
import { createExecutionConfirmationPoller } from "./services/create-execution-confirmation-poller.js";
import { createProposalGenerationEvaluationService } from "./services/create-proposal-generation-evaluation.js";
import { createExecutionSubmissionWorkflow } from "./services/create-execution-submission-workflow.js";
import { createLiveReadinessService } from "./services/create-live-readiness-service.js";

const config = loadConfig();
const repositories = createRepositories(config);
const internalDependencies =
  config.REPOSITORY_MODE === "firestore" && config.INTERNAL_TASK_TOKEN
    ? {
        executionConfirmationPoller: createExecutionConfirmationPoller(
          config,
          repositories.proposalRepository,
        ),
        executionSubmissionWorkflow: createExecutionSubmissionWorkflow(
          config,
          repositories,
        ),
        trustedProposalGenerationService:
          createProposalGenerationEvaluationService(config, repositories),
        taskRequestAuthorizer: new TaskTokenAuthorizer(
          config.INTERNAL_TASK_TOKEN,
        ),
        readinessService: createLiveReadinessService(config),
      }
    : {};
const app = createApp({ config, ...repositories, ...internalDependencies });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
