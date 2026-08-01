import { policySchema, type Policy } from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

export interface PolicyRepository {
  getCurrent(): Promise<Policy | null>;
}

export class FirestorePolicyRepository implements PolicyRepository {
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly collectionName = "policies",
    private readonly currentPolicyDocument = "current",
  ) {}

  async getCurrent(): Promise<Policy | null> {
    const document = await this.database
      .collection(this.collectionName)
      .doc(this.currentPolicyDocument)
      .get();

    return document.exists ? policySchema.parse(document.data()) : null;
  }
}

export class InMemoryPolicyRepository implements PolicyRepository {
  private readonly currentPolicy: Policy | null;

  constructor(currentPolicy: Policy | null = null) {
    this.currentPolicy = currentPolicy
      ? policySchema.parse(currentPolicy)
      : null;
  }

  async getCurrent(): Promise<Policy | null> {
    return this.currentPolicy;
  }
}
