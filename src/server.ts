import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createRepositories } from "./repositories/create-repositories.js";
import { TaskTokenAuthorizer } from "./security/task-request-authorizer.js";
import { createProposalGenerationEvaluationService } from "./services/create-proposal-generation-evaluation.js";
import { createLiveReadinessService } from "./services/create-live-readiness-service.js";
import { createDemoAttestationService } from "./services/create-demo-attestation.js";

const config = loadConfig();
const repositories = createRepositories(config);
const internalDependencies =
  config.REPOSITORY_MODE === "firestore" && config.INTERNAL_TASK_TOKEN
    ? {
        trustedProposalGenerationService:
          createProposalGenerationEvaluationService(config, repositories),
        demoAttestationService: createDemoAttestationService(
          config,
          repositories.proposalRepository,
        ),
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
