import type {
  Policy,
  Proposal,
  RuleCheck,
} from "../contracts/index.js";

export interface PolicyEvaluationContext {
  dailyUsageUsd: number;
  now?: Date;
}

export interface PolicyGateDependencies {
  getCurrentPolicy(): Promise<Policy | null>;
}

export class PolicyGateService {
  constructor(private readonly dependencies: PolicyGateDependencies) {}

  async evaluate(
    proposal: Proposal,
    context: PolicyEvaluationContext,
  ): Promise<Proposal> {
    const policy = await this.dependencies.getCurrentPolicy();
    const now = context.now ?? new Date();
    const ruleChecks = policy
      ? this.evaluatePolicy(proposal, policy, context.dailyUsageUsd, now)
      : [
          this.fail(
            "POLICY_CONFIGURED",
            "Current policy configured",
            false,
            true,
            "No current policy is configured.",
          ),
        ];
    const hasFailure = ruleChecks.some((check) => check.result === "FAIL");
    const hasReview = ruleChecks.some((check) => check.result === "REVIEW");
    const decision = hasFailure ? "BLOCK" : hasReview ? "ESCALATE" : "AUTO";
    const { execution: existingExecution, ...unevaluatedProposal } = proposal;
    void existingExecution;

    return {
      ...unevaluatedProposal,
      decision,
      status:
        decision === "BLOCK"
          ? "BLOCKED"
          : decision === "ESCALATE"
            ? "ESCALATED"
            : "POLICY_APPROVED",
      ruleChecks,
      ...(decision === "BLOCK"
        ? { execution: { kmsRequested: false } }
        : {}),
    };
  }

  private evaluatePolicy(
    proposal: Proposal,
    policy: Policy,
    dailyUsageUsd: number,
    now: Date,
  ): RuleCheck[] {
    const checks: RuleCheck[] = [
      this.check(
        "CIRCUIT_BREAKER",
        "Circuit breaker active",
        policy.circuitBreakerStatus === "ACTIVE",
        policy.circuitBreakerStatus,
        "ACTIVE",
        "The circuit breaker must be active.",
      ),
      this.check(
        "POLICY_VERSION",
        "Policy version matches",
        proposal.policyVersion === policy.policyVersion,
        proposal.policyVersion,
        policy.policyVersion,
        "The proposal must use the current policy version.",
      ),
      this.check(
        "PROPOSAL_NOT_EXPIRED",
        "Proposal is not expired",
        this.isFutureTimestamp(proposal.expiresAt, now),
        proposal.expiresAt,
        now.toISOString(),
        "The proposal must not be expired.",
      ),
      this.check(
        "DAILY_USAGE_VALID",
        "Daily usage is valid",
        Number.isFinite(dailyUsageUsd) && dailyUsageUsd >= 0,
        Number.isFinite(dailyUsageUsd) ? dailyUsageUsd : "invalid",
        "nonnegative number",
        "Daily usage must be a nonnegative finite number.",
      ),
    ];

    if (proposal.action === "NO_ACTION") {
      return checks;
    }

    checks.push(
      this.requiredFieldCheck("INPUT_MINT_PRESENT", "Input mint present", proposal.inputMint),
      this.requiredFieldCheck("OUTPUT_MINT_PRESENT", "Output mint present", proposal.outputMint),
      this.requiredFieldCheck("INPUT_ASSET_PRESENT", "Input asset present", proposal.inputSymbol),
      this.requiredFieldCheck("OUTPUT_ASSET_PRESENT", "Output asset present", proposal.outputSymbol),
      this.numberFieldCheck("AMOUNT_USD_PRESENT", "USD amount present", proposal.amountUsd),
    );

    if (proposal.inputMint) {
      checks.push(
        this.check(
          "INPUT_MINT_ALLOWLIST",
          "Input mint allowed",
          policy.allowedInputMints.includes(proposal.inputMint),
          proposal.inputMint,
          "allowlisted mint",
          "The input mint must be allowlisted.",
        ),
      );
    }
    if (proposal.outputMint) {
      checks.push(
        this.check(
          "OUTPUT_MINT_ALLOWLIST",
          "Output mint allowed",
          policy.allowedOutputMints.includes(proposal.outputMint),
          proposal.outputMint,
          "allowlisted mint",
          "The output mint must be allowlisted.",
        ),
      );
    }
    for (const asset of [proposal.inputSymbol, proposal.outputSymbol]) {
      if (asset) {
        checks.push(
          this.check(
            `ASSET_ALLOWLIST_${asset}`,
            `${asset} asset allowed`,
            policy.allowedAssets.includes(asset),
            asset,
            "allowlisted asset",
            "Every proposal asset must be allowlisted.",
          ),
        );
      }
    }
    if (
      proposal.amountUsd !== undefined &&
      Number.isFinite(dailyUsageUsd) &&
      dailyUsageUsd >= 0
    ) {
      checks.push(
        this.check(
          "MAX_TRANSACTION_USD",
          "Transaction limit",
          proposal.amountUsd <= policy.maxTransactionUsd,
          proposal.amountUsd,
          policy.maxTransactionUsd,
          "The transaction amount must not exceed the policy limit.",
        ),
        this.check(
          "DAILY_LIMIT_USD",
          "Daily limit",
          dailyUsageUsd + proposal.amountUsd <= policy.dailyLimitUsd,
          dailyUsageUsd + proposal.amountUsd,
          policy.dailyLimitUsd,
          "The transaction must not exceed the daily limit.",
        ),
      );
    }

    return checks;
  }

  private isFutureTimestamp(value: string, now: Date): boolean {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp > now.getTime();
  }

  private requiredFieldCheck(
    code: string,
    label: string,
    value: string | undefined,
  ): RuleCheck {
    return this.check(
      code,
      label,
      Boolean(value),
      value ?? "missing",
      "required",
      `${label} is required for a swap.`,
    );
  }

  private numberFieldCheck(
    code: string,
    label: string,
    value: number | undefined,
  ): RuleCheck {
    return this.check(
      code,
      label,
      value !== undefined && Number.isFinite(value) && value > 0,
      value ?? "missing",
      "positive number",
      `${label} must be a positive number for a swap.`,
    );
  }

  private check(
    code: string,
    label: string,
    passed: boolean,
    actual: string | number | boolean,
    expected: string | number | boolean,
    failureMessage: string,
  ): RuleCheck {
    return {
      code,
      label,
      result: passed ? "PASS" : "FAIL",
      actual,
      expected,
      message: passed ? "Policy rule passed." : failureMessage,
    };
  }

  private fail(
    code: string,
    label: string,
    actual: string | number | boolean,
    expected: string | number | boolean,
    message: string,
  ): RuleCheck {
    return { code, label, result: "FAIL", actual, expected, message };
  }
}
