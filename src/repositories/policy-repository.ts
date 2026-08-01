import { policySchema, type Policy } from "../contracts/index.js";

export interface PolicyRepository {
  getCurrent(): Promise<Policy | null>;
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
