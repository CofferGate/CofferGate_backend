import type { AppConfig } from "../config.js";
import { createFirestoreDatabase } from "../infrastructure/firestore.js";
import { SolanaRpcProvider } from "../providers/solana-rpc.js";
import { FirestoreExecutionCompletionRepository } from "../repositories/execution-completion-repository.js";
import type { ProposalRepository } from "../repositories/proposal-repository.js";
import { ExecutionCompletionWorkflow } from "./execution-completion-workflow.js";
import { ExecutionConfirmationPoller } from "./execution-confirmation-poller.js";
import { ExecutionReconciliationService } from "./execution-reconciliation.js";
import { SolanaConfirmationObservationService } from "./solana-confirmation-observation.js";

export function createExecutionConfirmationPoller(
  config: AppConfig,
  proposalRepository: ProposalRepository,
): ExecutionConfirmationPoller {
  const database = createFirestoreDatabase(config);
  const completionRepository = new FirestoreExecutionCompletionRepository(
    database,
    config.FIRESTORE_PROPOSALS_COLLECTION,
    config.FIRESTORE_DAILY_USAGE_COLLECTION,
    config.FIRESTORE_DAILY_USAGE_LEDGER_COLLECTION,
  );
  const reconciliationService = new ExecutionReconciliationService();
  return new ExecutionConfirmationPoller(
    proposalRepository,
    new SolanaConfirmationObservationService(
      new SolanaRpcProvider({
        endpoint: config.SOLANA_RPC_URL,
        timeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
      }),
    ),
    new ExecutionCompletionWorkflow({
      proposalRepository,
      reconciliationService,
      completionRepository,
    }),
  );
}
