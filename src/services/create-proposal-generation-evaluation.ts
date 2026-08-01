import type { AppConfig } from "../config.js";
import { VertexProposalProvider } from "../providers/vertex-proposal.js";
import type { DailyUsageRepository } from "../repositories/daily-usage-repository.js";
import type { PolicyRepository } from "../repositories/policy-repository.js";
import type { ProposalRepository } from "../repositories/proposal-repository.js";
import { PolicyGateService } from "./policy-gate.js";
import { ProposalGenerationEvaluationService } from "./proposal-generation-evaluation.js";
import { ProposalGenerationService } from "./proposal-generation.js";
import { ProposalPolicyEvaluationService } from "./proposal-policy-evaluation.js";

export function createProposalGenerationEvaluationService(
  config: AppConfig,
  repositories: {
    proposalRepository: ProposalRepository;
    policyRepository: PolicyRepository;
    dailyUsageRepository: DailyUsageRepository;
  },
): ProposalGenerationEvaluationService {
  if (!config.GOOGLE_CLOUD_PROJECT) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required for Vertex AI.");
  }

  return new ProposalGenerationEvaluationService({
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
  });
}
