import type { AppConfig } from "../config.js";
import { createFirestoreDatabase } from "../infrastructure/firestore.js";
import {
  FirestoreDailyUsageRepository,
  InMemoryDailyUsageRepository,
  type DailyUsageRepository,
} from "./daily-usage-repository.js";
import {
  FirestorePolicyRepository,
  InMemoryPolicyRepository,
  type PolicyRepository,
} from "./policy-repository.js";
import {
  FirestoreProposalRepository,
  InMemoryProposalRepository,
  type ProposalRepository,
  type DemoAttestationRepository,
  type DevnetPaymentExecutionRepository,
} from "./proposal-repository.js";

export interface AppRepositories {
  proposalRepository: ProposalRepository & DemoAttestationRepository & DevnetPaymentExecutionRepository;
  policyRepository: PolicyRepository;
  dailyUsageRepository: DailyUsageRepository;
}

export function createRepositories(config: AppConfig): AppRepositories {
  if (config.REPOSITORY_MODE === "memory") {
    return {
      proposalRepository: new InMemoryProposalRepository(),
      policyRepository: new InMemoryPolicyRepository(),
      dailyUsageRepository: new InMemoryDailyUsageRepository(),
    };
  }

  const database = createFirestoreDatabase(config);
  return {
    proposalRepository: new FirestoreProposalRepository(
      database,
      config.FIRESTORE_PROPOSALS_COLLECTION,
    ),
    policyRepository: new FirestorePolicyRepository(
      database,
      config.FIRESTORE_POLICIES_COLLECTION,
      config.FIRESTORE_CURRENT_POLICY_DOCUMENT,
    ),
    dailyUsageRepository: new FirestoreDailyUsageRepository(
      database,
      config.FIRESTORE_DAILY_USAGE_COLLECTION,
    ),
  };
}
