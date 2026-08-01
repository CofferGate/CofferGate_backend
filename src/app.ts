import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  apiResponseSchema,
  consoleSnapshotSchema,
  policySchema,
  proposalSchema,
  systemReadinessSchema,
} from "./contracts/index.js";
import type { AppConfig } from "./config.js";
import { HttpApiError } from "./errors/http-api-error.js";
import {
  InMemoryPolicyRepository,
  type PolicyRepository,
} from "./repositories/policy-repository.js";
import {
  InMemoryProposalRepository,
  type ProposalRepository,
} from "./repositories/proposal-repository.js";
import { SystemReadinessService } from "./services/system-readiness.js";
import { DashboardSnapshotService } from "./services/dashboard-snapshot.js";
import type { TaskRequestAuthorizer } from "./security/task-request-authorizer.js";
import type { TrustedProposalGenerationService } from "./services/trusted-proposal-generation.js";
import { createScheduledProposalId } from "./services/scheduled-proposal-id.js";

const internalProposalGenerationRequestSchema = z.object({
  proposalId: z.string().min(1),
});

type ApiConfig = Pick<
  AppConfig,
  | "ENVIRONMENT"
  | "DATA_MODE"
  | "OPERATIONS_WALLET_ADDRESS"
  | "LOG_LEVEL"
>;

export interface AppDependencies {
  config: ApiConfig;
  readinessService?: SystemReadinessService;
  proposalRepository?: ProposalRepository;
  policyRepository?: PolicyRepository;
  dashboardSnapshotService?: DashboardSnapshotService;
  trustedProposalGenerationService?: TrustedProposalGenerationService;
  taskRequestAuthorizer?: TaskRequestAuthorizer;
}

export function createApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: dependencies.config.LOG_LEVEL
      ? {
          level: dependencies.config.LOG_LEVEL,
          redact: {
            paths: ["req.headers.x-coffergate-task-token"],
            censor: "[REDACTED]",
          },
        }
      : false,
  });
  const readinessService =
    dependencies.readinessService ??
    new SystemReadinessService({
      dataMode: dependencies.config.DATA_MODE,
      network: "devnet",
    });
  const proposalRepository =
    dependencies.proposalRepository ?? new InMemoryProposalRepository();
  const policyRepository =
    dependencies.policyRepository ?? new InMemoryPolicyRepository();
  const dashboardSnapshotService =
    dependencies.dashboardSnapshotService ??
    new DashboardSnapshotService({
      dataMode: dependencies.config.DATA_MODE,
      policyRepository,
      walletStateProvider: {
        async getState() {
          return { address: dependencies.config.OPERATIONS_WALLET_ADDRESS };
        },
      },
    });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpApiError) {
      return reply.status(error.statusCode).send(error.toResponse(request.id));
    }

    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected server error occurred.",
      retryable: false,
      requestId: request.id,
    });
  });

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/api/v1/system/readiness", async (request) => {
    const response = {
      data: await readinessService.getReadiness(),
      meta: {
        requestId: request.id,
        generatedAt: new Date().toISOString(),
        environment: dependencies.config.ENVIRONMENT,
      },
    };

    return apiResponseSchema(systemReadinessSchema).parse(response);
  });

  app.get("/api/v1/proposals", async (request) => {
    const response = {
      data: await proposalRepository.list(),
      meta: {
        requestId: request.id,
        generatedAt: new Date().toISOString(),
        environment: dependencies.config.ENVIRONMENT,
      },
    };

    return apiResponseSchema(z.array(proposalSchema)).parse(response);
  });

  app.get<{ Params: { proposalId: string } }>(
    "/api/v1/proposals/:proposalId",
    async (request) => {
      const proposal = await proposalRepository.findById(
        request.params.proposalId,
      );
      if (!proposal) {
        throw new HttpApiError({
          statusCode: 404,
          code: "PROPOSAL_NOT_FOUND",
          message: "The requested proposal was not found.",
          retryable: false,
          proposalId: request.params.proposalId,
        });
      }

      const response = {
        data: proposal,
        meta: {
          requestId: request.id,
          generatedAt: new Date().toISOString(),
          environment: dependencies.config.ENVIRONMENT,
        },
      };

      return apiResponseSchema(proposalSchema).parse(response);
    },
  );

  app.get("/api/v1/policy/current", async (request) => {
    const response = {
      data: await policyRepository.getCurrent(),
      meta: {
        requestId: request.id,
        generatedAt: new Date().toISOString(),
        environment: dependencies.config.ENVIRONMENT,
      },
    };

    return apiResponseSchema(policySchema.nullable()).parse(response);
  });

  app.get("/api/v1/dashboard", async (request) => {
    const meta = {
      requestId: request.id,
      generatedAt: new Date().toISOString(),
      environment: dependencies.config.ENVIRONMENT,
    };
    const response = {
      data: await dashboardSnapshotService.getSnapshot(meta),
      meta,
    };

    return apiResponseSchema(consoleSnapshotSchema).parse(response);
  });

  if (
    dependencies.trustedProposalGenerationService &&
    !dependencies.taskRequestAuthorizer
  ) {
    throw new Error("Task request authorizer is required for internal routes.");
  }

  if (dependencies.trustedProposalGenerationService) {
    const trustedProposalGenerationService =
      dependencies.trustedProposalGenerationService;
    app.post<{ Body: { proposalId: string } }>(
      "/internal/v1/proposals/generate",
      async (request, reply) => {
        const taskToken = request.headers["x-coffergate-task-token"];
        if (!dependencies.taskRequestAuthorizer?.authorize(
          typeof taskToken === "string" ? taskToken : undefined,
        )) {
          return reply.status(401).send({ status: "UNAUTHORIZED", retryable: false });
        }
        const parsedRequest = internalProposalGenerationRequestSchema.safeParse(
          request.body,
        );
        if (!parsedRequest.success) {
          return reply.status(400).send({
            status: "INVALID_REQUEST",
            retryable: false,
          });
        }

        const result = await trustedProposalGenerationService.generate(
          parsedRequest.data.proposalId,
        );
        request.log.info({
          event: "proposal.generation.completed",
          proposalId: parsedRequest.data.proposalId,
          resultStatus: result.status,
        });
        if (result.status === "POLICY_NOT_CONFIGURED") {
          return reply.status(409).send({ ...result, retryable: false });
        }
        if (result.status === "PERSISTENCE_INCONSISTENCY") {
          return reply
            .header("retry-after", "5")
            .status(503)
            .send({ ...result, retryable: true });
        }
        if (result.status === "CONFLICT") {
          return reply.status(409).send({ ...result, retryable: true });
        }
        if (result.status === "ID_CONFLICT") {
          return reply.status(409).send({ ...result, retryable: false });
        }
        return reply.status(200).send({ ...result, retryable: false });
      },
    );

    app.post("/internal/v1/proposals/generate/scheduled", async (request, reply) => {
      const taskToken = request.headers["x-coffergate-task-token"];
      if (!dependencies.taskRequestAuthorizer?.authorize(
        typeof taskToken === "string" ? taskToken : undefined,
      )) {
        return reply.status(401).send({ status: "UNAUTHORIZED", retryable: false });
      }
      const jobName = request.headers["x-cloudscheduler-jobname"];
      const scheduleTime = request.headers["x-cloudscheduler-scheduletime"];
      let proposalId: string;
      try {
        proposalId = createScheduledProposalId(
          typeof jobName === "string" ? jobName : "",
          typeof scheduleTime === "string" ? scheduleTime : "",
        );
      } catch {
        return reply.status(400).send({ status: "INVALID_SCHEDULER_REQUEST", retryable: false });
      }
      const result = await trustedProposalGenerationService.generate(proposalId);
      request.log.info({
        event: "proposal.generation.scheduled.completed",
        proposalId,
        resultStatus: result.status,
      });
      if (result.status === "PERSISTENCE_INCONSISTENCY") {
        return reply.header("retry-after", "5").status(503).send({ ...result, retryable: true });
      }
      if (result.status === "CONFLICT") {
        return reply.status(409).send({ ...result, retryable: true });
      }
      if (result.status === "ID_CONFLICT" || result.status === "POLICY_NOT_CONFIGURED") {
        return reply.status(409).send({ ...result, retryable: false });
      }
      return reply.status(200).send({ ...result, retryable: false });
    });
  }

  return app;
}
