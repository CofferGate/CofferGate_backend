import type { AppConfig } from "../config.js";
import { VertexProposalProvider } from "../providers/vertex-proposal.js";
import { JupiterSolPriceProvider } from "../providers/jupiter-price.js";
import { SolanaRpcProvider } from "../providers/solana-rpc.js";
import { SolanaTreasurySnapshotProvider } from "../providers/solana-treasury.js";
import type { DailyUsageRepository } from "../repositories/daily-usage-repository.js";
import type { PolicyRepository } from "../repositories/policy-repository.js";
import type { ProposalRepository } from "../repositories/proposal-repository.js";
import { PolicyGateService } from "./policy-gate.js";
import { ProposalGenerationEvaluationService } from "./proposal-generation-evaluation.js";
import { ProposalGenerationService } from "./proposal-generation.js";
import { ProposalPolicyEvaluationService } from "./proposal-policy-evaluation.js";
import { ProposalGenerationContextService } from "./proposal-generation-context.js";
import { TrustedProposalGenerationService } from "./trusted-proposal-generation.js";
import { ExecutionTaskScheduler } from "../providers/cloud-tasks.js";

export function createProposalGenerationEvaluationService(
  config: AppConfig,
  repositories: {
    proposalRepository: ProposalRepository;
    policyRepository: PolicyRepository;
    dailyUsageRepository: DailyUsageRepository;
  },
): TrustedProposalGenerationService {
  if (
    !config.GOOGLE_CLOUD_PROJECT ||
    !config.JUPITER_API_KEY ||
    !config.USDC_MINT ||
    !config.USDC_TOKEN_ACCOUNT ||
    !config.TARGET_USDC_BALANCE ||
    !config.CLOUD_TASKS_LOCATION ||
    !config.CLOUD_TASKS_QUEUE ||
    !config.CLOUD_TASKS_TARGET_BASE_URL ||
    !config.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL ||
    !config.INTERNAL_TASK_TOKEN
  ) {
    throw new Error("Trusted proposal generation configuration is incomplete.");
  }

  const generationEvaluator = new ProposalGenerationEvaluationService({
    proposalGeneration: new ProposalGenerationService({
      proposalRepository: repositories.proposalRepository,
      proposalGenerator: new VertexProposalProvider({
        projectId: config.GOOGLE_CLOUD_PROJECT,
        location: config.VERTEX_AI_LOCATION,
        model: config.VERTEX_AI_MODEL,
      }),
    }),
    proposalPolicyEvaluation: new ProposalPolicyEvaluationService({
      proposalRepository: repositories.proposalRepository,
      dailyUsageRepository: repositories.dailyUsageRepository,
      policyGate: new PolicyGateService({
        getCurrentPolicy: () => repositories.policyRepository.getCurrent(),
      }),
    }),
    executionTaskScheduler: new ExecutionTaskScheduler({
      projectId: config.GOOGLE_CLOUD_PROJECT,
      location: config.CLOUD_TASKS_LOCATION,
      queue: config.CLOUD_TASKS_QUEUE,
      targetBaseUrl: config.CLOUD_TASKS_TARGET_BASE_URL,
      oidcServiceAccountEmail: config.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL,
      internalTaskToken: config.INTERNAL_TASK_TOKEN,
    }),
  });
  const solanaRpc = new SolanaRpcProvider({
    endpoint: config.SOLANA_RPC_URL,
    timeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
  });
  const contextBuilder = new ProposalGenerationContextService({
    policyRepository: repositories.policyRepository,
    proposalTtlSeconds: config.PROPOSAL_TTL_SECONDS,
    treasurySnapshotProvider: new SolanaTreasurySnapshotProvider({
      rpc: solanaRpc,
      walletAddress: config.OPERATIONS_WALLET_ADDRESS,
      usdcTokenAccount: config.USDC_TOKEN_ACCOUNT,
      solMint: config.SOL_MINT,
      usdcMint: config.USDC_MINT,
      targetUsdcBalance: config.TARGET_USDC_BALANCE,
    }),
    solPriceProvider: new JupiterSolPriceProvider({
      apiKey: config.JUPITER_API_KEY,
      solMint: config.SOL_MINT,
      endpoint: config.JUPITER_PRICE_API_URL,
      timeoutMs: config.JUPITER_TIMEOUT_MS,
    }),
  });
  return new TrustedProposalGenerationService(contextBuilder, generationEvaluator);
}
