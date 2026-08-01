import type { AppConfig } from "../config.js";
import { createFirestoreDatabase } from "../infrastructure/firestore.js";
import {
  FirestorePolicyRepository,
  InMemoryPolicyRepository,
  type PolicyRepository,
} from "./policy-repository.js";
import {
  FirestoreProposalRepository,
  InMemoryProposalRepository,
  type ProposalRepository,
} from "./proposal-repository.js";

export interface AppRepositories {
  proposalRepository: ProposalRepository;
  policyRepository: PolicyRepository;
}

export function createRepositories(config: AppConfig): AppRepositories {
  if (config.REPOSITORY_MODE === "memory") {
    return {
      proposalRepository: new InMemoryProposalRepository(),
      policyRepository: new InMemoryPolicyRepository(),
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
  };
}
