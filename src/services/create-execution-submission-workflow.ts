import type { AppConfig } from "../config.js";
import { createFirestoreDatabase } from "../infrastructure/firestore.js";
import { CloudKmsTransactionSigner } from "../providers/cloud-kms-signer.js";
import { ConfirmationTaskScheduler } from "../providers/cloud-tasks.js";
import { JupiterQuoteProvider } from "../providers/jupiter-quote.js";
import { JupiterSwapProvider } from "../providers/jupiter-swap.js";
import { SolanaRpcProvider } from "../providers/solana-rpc.js";
import { FirestoreExecutionSubmissionRepository } from "../repositories/execution-submission-repository.js";
import type { AppRepositories } from "../repositories/create-repositories.js";
import { ExecutionSimulationService } from "./execution-simulation.js";
import { ExecutionSubmissionWorkflow } from "./execution-submission-workflow.js";
import { SolanaProgramAllowlistValidator } from "./solana-program-allowlist.js";

export function createExecutionSubmissionWorkflow(
  config: AppConfig,
  repositories: AppRepositories,
): ExecutionSubmissionWorkflow {
  const projectId = required(config.GOOGLE_CLOUD_PROJECT, "GOOGLE_CLOUD_PROJECT");
  const apiKey = required(config.JUPITER_API_KEY, "JUPITER_API_KEY");
  const outputTokenAccount = required(config.USDC_TOKEN_ACCOUNT, "USDC_TOKEN_ACCOUNT");
  const keyVersionName = required(config.CLOUD_KMS_KEY_VERSION, "CLOUD_KMS_KEY_VERSION");
  const location = required(config.CLOUD_TASKS_LOCATION, "CLOUD_TASKS_LOCATION");
  const queue = required(config.CLOUD_TASKS_QUEUE, "CLOUD_TASKS_QUEUE");
  const targetBaseUrl = required(config.CLOUD_TASKS_TARGET_BASE_URL, "CLOUD_TASKS_TARGET_BASE_URL");
  const serviceAccount = required(config.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL, "CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL");
  const internalToken = required(config.INTERNAL_TASK_TOKEN, "INTERNAL_TASK_TOKEN");
  const solanaRpc = new SolanaRpcProvider({
    endpoint: config.SOLANA_RPC_URL,
    timeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
  });

  return new ExecutionSubmissionWorkflow({
    proposalRepository: repositories.proposalRepository,
    policyRepository: repositories.policyRepository,
    submissionRepository: new FirestoreExecutionSubmissionRepository(
      createFirestoreDatabase(config),
      config.FIRESTORE_PROPOSALS_COLLECTION,
      config.FIRESTORE_EXECUTION_INTENTS_COLLECTION,
    ),
    quoteProvider: new JupiterQuoteProvider({
      apiKey,
      endpoint: config.JUPITER_QUOTE_API_URL,
      timeoutMs: config.JUPITER_TIMEOUT_MS,
    }),
    swapProvider: new JupiterSwapProvider({
      apiKey,
      userPublicKey: config.OPERATIONS_WALLET_ADDRESS,
      maxPriorityFeeLamports: config.MAX_PRIORITY_FEE_LAMPORTS,
      endpoint: config.JUPITER_SWAP_API_URL,
      timeoutMs: config.JUPITER_TIMEOUT_MS,
    }),
    simulationService: new ExecutionSimulationService(solanaRpc, {
      computeUnitMarginBps: config.SIMULATION_COMPUTE_MARGIN_BPS,
      maxComputeUnits: config.MAX_COMPUTE_UNITS,
    }),
    signer: new CloudKmsTransactionSigner({
      keyVersionName,
      expectedSignerPublicKey: config.OPERATIONS_WALLET_ADDRESS,
    }),
    submitter: solanaRpc,
    blockHeightProvider: solanaRpc,
    balanceProvider: solanaRpc,
    confirmationScheduler: new ConfirmationTaskScheduler({
      projectId,
      location,
      queue,
      targetBaseUrl,
      oidcServiceAccountEmail: serviceAccount,
      internalTaskToken: internalToken,
      scheduleDelaySeconds: config.CLOUD_TASKS_SCHEDULE_DELAY_SECONDS,
    }),
    programAllowlistValidator: new SolanaProgramAllowlistValidator(),
    outputTokenAccount,
  });
}

function required(value: string | undefined, name: string): string {
  if (!value || value === "unconfigured") {
    throw new Error(`${name} is required for transaction execution.`);
  }
  return value;
}
