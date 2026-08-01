import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  apiResponseSchema,
  proposalSchema,
  systemReadinessSchema,
} from "./contracts/index.js";
import type { AppConfig } from "./config.js";
import { HttpApiError } from "./errors/http-api-error.js";
import {
  InMemoryProposalRepository,
  type ProposalRepository,
} from "./repositories/proposal-repository.js";
import { SystemReadinessService } from "./services/system-readiness.js";

export interface AppDependencies {
  config: AppConfig;
  readinessService?: SystemReadinessService;
  proposalRepository?: ProposalRepository;
}

export function createApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  const readinessService =
    dependencies.readinessService ??
    new SystemReadinessService({
      dataMode: dependencies.config.DATA_MODE,
      network:
        dependencies.config.ENVIRONMENT === "mainnet-beta"
          ? "mainnet-beta"
          : "devnet",
    });
  const proposalRepository =
    dependencies.proposalRepository ?? new InMemoryProposalRepository();

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

  return app;
}
