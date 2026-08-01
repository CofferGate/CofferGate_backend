import { KeyManagementServiceClient, protos } from "@google-cloud/kms";
import type { AppConfig } from "../config.js";
import { createFirestoreDatabase } from "../infrastructure/firestore.js";
import { JupiterSolPriceProvider } from "../providers/jupiter-price.js";
import { SolanaRpcProvider } from "../providers/solana-rpc.js";
import { SystemReadinessService, type ReadinessProbes } from "./system-readiness.js";

export interface LiveReadinessDependencies {
  checkFirestore(): Promise<void>;
  checkKms(): Promise<void>;
  checkJupiter(): Promise<void>;
  checkSolana(): Promise<void>;
}

export type ReadinessProbeFailureReporter = (
  serviceId: string,
  error: unknown,
) => void;

export function createLiveReadinessProbes(
  config: AppConfig,
  dependencies: LiveReadinessDependencies,
  reportFailure: ReadinessProbeFailureReporter = reportProbeFailure,
): ReadinessProbes {
  return {
    "vertex-ai": async () => configured(
      Boolean(config.GOOGLE_CLOUD_PROJECT && config.VERTEX_AI_LOCATION && config.VERTEX_AI_MODEL),
      "Vertex AI runtime configuration is incomplete.",
    ),
    firestore: () => checked("firestore", dependencies.checkFirestore, reportFailure),
    "private-executor": async () => configured(
      Boolean(
        config.CLOUD_KMS_KEY_VERSION && config.OPERATIONS_WALLET_ADDRESS !== "unconfigured" &&
        config.USDC_TOKEN_ACCOUNT && config.CLOUD_TASKS_QUEUE,
      ),
      "Private Executor runtime configuration is incomplete.",
    ),
    "cloud-kms": () => checked("cloud-kms", dependencies.checkKms, reportFailure),
    "jupiter-api": () => checked("jupiter-api", dependencies.checkJupiter, reportFailure),
    "solana-rpc": () => checked("solana-rpc", dependencies.checkSolana, reportFailure),
  };
}

export function createLiveReadinessService(config: AppConfig): SystemReadinessService {
  required(config.GOOGLE_CLOUD_PROJECT, "GOOGLE_CLOUD_PROJECT");
  const keyVersionName = required(config.CLOUD_KMS_KEY_VERSION, "CLOUD_KMS_KEY_VERSION");
  const apiKey = required(config.JUPITER_API_KEY, "JUPITER_API_KEY");
  const database = createFirestoreDatabase(config);
  const kms = new KeyManagementServiceClient();
  const jupiter = new JupiterSolPriceProvider({
    apiKey,
    solMint: config.SOL_MINT,
    endpoint: config.JUPITER_PRICE_API_URL,
    timeoutMs: config.JUPITER_TIMEOUT_MS,
  });
  const solana = new SolanaRpcProvider({
    endpoint: config.SOLANA_RPC_URL,
    timeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
  });
  const dependencies: LiveReadinessDependencies = {
    async checkFirestore() {
      await database.collection(config.FIRESTORE_PROPOSALS_COLLECTION).doc("__readiness__").get();
    },
    async checkKms() {
      const [key] = await kms.getPublicKey({ name: keyVersionName });
      if (
        !key.pem ||
        key.algorithm !== protos.google.cloud.kms.v1.CryptoKeyVersion.CryptoKeyVersionAlgorithm.EC_SIGN_ED25519
      ) throw new Error("Configured KMS key is not Ed25519.");
    },
    async checkJupiter() { await jupiter.getSolPrice(); },
    async checkSolana() { await solana.getBlockHeight(); },
  };
  return new SystemReadinessService({
    dataMode: config.DATA_MODE,
    network: "devnet",
    probes: createLiveReadinessProbes(config, dependencies),
  });
}

async function checked(
  serviceId: string,
  check: () => Promise<void>,
  reportFailure: ReadinessProbeFailureReporter,
) {
  try {
    await check();
    return { status: "healthy" as const };
  } catch (error) {
    reportFailure(serviceId, error);
    throw error;
  }
}

function reportProbeFailure(serviceId: string, error: unknown): void {
  console.error(JSON.stringify({
    event: "readiness.probe.failed",
    serviceId,
    error: error instanceof Error ? error.message : "Unknown readiness probe error.",
  }));
}

function configured(isConfigured: boolean, impact: string) {
  return isConfigured
    ? { status: "healthy" as const }
    : { status: "down" as const, impact, action: "Complete the required runtime configuration." };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for live readiness probes.`);
  return value;
}
