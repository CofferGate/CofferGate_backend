import {
  SYSTEM_SERVICE_IDS,
  systemReadinessSchema,
  type ServiceReadiness,
  type ServiceReadinessStatus,
  type SystemReadiness,
  type SystemServiceId,
} from "../contracts/index.js";

export interface ReadinessProbeResult {
  status: ServiceReadinessStatus;
  impact?: string;
  action?: string;
}

export type ReadinessProbe = () =>
  | ReadinessProbeResult
  | Promise<ReadinessProbeResult>;

export type ReadinessProbes = Partial<Record<SystemServiceId, ReadinessProbe>>;

export interface SystemReadinessServiceOptions {
  dataMode: "mock" | "live";
  network: "devnet";
  probes?: ReadinessProbes;
  now?: () => Date;
}

function deriveOverallStatus(
  services: ServiceReadiness[],
): ServiceReadinessStatus {
  const statuses = services.map((service) => service.status);
  if (statuses.includes("down")) return "down";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.every((status) => status === "healthy")) return "healthy";
  return "unknown";
}

export class SystemReadinessService {
  private readonly dataMode: "mock" | "live";
  private readonly network: "devnet";
  private readonly probes: ReadinessProbes;
  private readonly now: () => Date;

  constructor(options: SystemReadinessServiceOptions) {
    this.dataMode = options.dataMode;
    this.network = options.network;
    this.probes = options.probes ?? {};
    this.now = options.now ?? (() => new Date());
  }

  async getReadiness(): Promise<SystemReadiness> {
    const checkedAt = this.now().toISOString();
    const services = await Promise.all(
      SYSTEM_SERVICE_IDS.map(async (serviceId) =>
        this.checkService(serviceId, checkedAt),
      ),
    );
    const readiness = {
      overallStatus: deriveOverallStatus(services),
      checkedAt,
      dataMode: this.dataMode,
      network: this.network,
      services,
    };

    return systemReadinessSchema.parse(readiness);
  }

  private async checkService(
    serviceId: SystemServiceId,
    checkedAt: string,
  ): Promise<ServiceReadiness> {
    const probe = this.probes[serviceId];
    if (!probe) {
      return {
        serviceId,
        status: serviceId === "control-plane" ? "healthy" : "unknown",
        checkedAt,
      };
    }

    try {
      return { serviceId, ...(await probe()), checkedAt };
    } catch {
      return {
        serviceId,
        status: "down",
        checkedAt,
        impact: `${serviceId} readiness probe failed.`,
        action: "Inspect the service logs and dependency configuration.",
      };
    }
  }
}
