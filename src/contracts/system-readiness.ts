import { z } from "zod";

export const SYSTEM_SERVICE_IDS = [
  "control-plane",
  "vertex-ai",
  "firestore",
  "private-executor",
  "cloud-kms",
  "jupiter-api",
  "solana-rpc",
] as const;

export const systemServiceIdSchema = z.enum(SYSTEM_SERVICE_IDS);
export const serviceReadinessStatusSchema = z.enum([
  "healthy",
  "degraded",
  "down",
  "unknown",
]);

export const serviceReadinessSchema = z.object({
  serviceId: systemServiceIdSchema,
  status: serviceReadinessStatusSchema,
  checkedAt: z.string().datetime(),
  impact: z.string().optional(),
  action: z.string().optional(),
});

export const systemReadinessSchema = z
  .object({
    overallStatus: serviceReadinessStatusSchema,
    checkedAt: z.string().datetime(),
    dataMode: z.enum(["mock", "live"]),
    network: z.literal("devnet"),
    services: z.array(serviceReadinessSchema),
  })
  .superRefine((readiness, context) => {
    const serviceIds = readiness.services.map((service) => service.serviceId);
    const includesEveryService = SYSTEM_SERVICE_IDS.every((serviceId) =>
      serviceIds.includes(serviceId),
    );

    if (
      !includesEveryService ||
      new Set(serviceIds).size !== SYSTEM_SERVICE_IDS.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["services"],
        message: "Readiness must contain each supported service exactly once.",
      });
    }

    const statuses = readiness.services.map((service) => service.status);
    const derivedOverallStatus = statuses.includes("down")
      ? "down"
      : statuses.includes("degraded")
        ? "degraded"
        : statuses.every((status) => status === "healthy")
          ? "healthy"
          : "unknown";

    if (readiness.overallStatus !== derivedOverallStatus) {
      context.addIssue({
        code: "custom",
        path: ["overallStatus"],
        message: "Overall readiness does not match service readiness.",
      });
    }
  });

export type SystemServiceId = z.infer<typeof systemServiceIdSchema>;
export type ServiceReadinessStatus = z.infer<
  typeof serviceReadinessStatusSchema
>;
export type ServiceReadiness = z.infer<typeof serviceReadinessSchema>;
export type SystemReadiness = z.infer<typeof systemReadinessSchema>;
