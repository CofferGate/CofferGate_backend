import { z } from "zod";

export const proposalStatusSchema = z.enum([
  "OBSERVED",
  "PROPOSED",
  "AI_REVIEWED",
  "POLICY_APPROVED",
  "ESCALATED",
  "BLOCKED",
  "EXECUTING",
  "SUBMITTED",
  "CONFIRMED",
  "FAILED",
  "EXPIRED",
  "RECONCILED",
]);

export const policyDecisionSchema = z.enum(["AUTO", "ESCALATE", "BLOCK"]);
export const proposalActionSchema = z.enum(["NO_ACTION", "SWAP"]);
export const assetSymbolSchema = z.enum(["SOL", "USDC"]);
export const ruleCheckResultSchema = z.enum(["PASS", "REVIEW", "FAIL"]);
export const evidenceSourceTypeSchema = z.enum([
  "PRICE_FEED",
  "ONCHAIN_BALANCE",
  "MARKET_DATA",
  "POLICY_DOCUMENT",
]);
export const commitmentLevelSchema = z.enum([
  "processed",
  "confirmed",
  "finalized",
]);
export const reconciliationStatusSchema = z.enum([
  "MATCHED",
  "MISMATCHED",
  "PENDING",
]);

export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
export type ProposalAction = z.infer<typeof proposalActionSchema>;
export type AssetSymbol = z.infer<typeof assetSymbolSchema>;
