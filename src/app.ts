import Fastify, { type FastifyInstance } from "fastify";
import { apiResponseSchema, systemReadinessSchema } from "./contracts/index.js";
import type { AppConfig } from "./config.js";
import { SystemReadinessService } from "./services/system-readiness.js";

export interface AppDependencies {
  config: AppConfig;
  readinessService?: SystemReadinessService;
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

  return app;
}
