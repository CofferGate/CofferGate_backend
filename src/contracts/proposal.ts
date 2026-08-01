import { z } from "zod";
import {
  assetSymbolSchema,
  commitmentLevelSchema,
  evidenceSourceTypeSchema,
  policyDecisionSchema,
  proposalActionSchema,
  proposalStatusSchema,
  reconciliationStatusSchema,
  ruleCheckResultSchema,
} from "./enums.js";

export const evidenceReferenceSchema = z.object({
  id: z.string(),
  label: z.string(),
  sourceType: evidenceSourceTypeSchema,
  observedAt: z.string(),
  url: z.url().optional(),
});

export const ruleCheckSchema = z.object({
  code: z.string(),
  label: z.string(),
  result: ruleCheckResultSchema,
  actual: z.union([z.string(), z.number(), z.boolean()]).optional(),
  expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
  message: z.string(),
});

export const simulationResultSchema = z.object({
  ok: z.boolean(),
  unitsConsumed: z.number().optional(),
  error: z.string().optional(),
});

export const reconciliationSchema = z.object({
  beforeBalance: z.string(),
  afterBalance: z.string(),
  expectedDelta: z.string(),
  actualDelta: z.string(),
  status: reconciliationStatusSchema,
});

export const executionSummarySchema = z.object({
  routeLabel: z.string().optional(),
  expectedInputAmount: z.string().optional(),
  expectedOutputAmount: z.string().optional(),
  minimumOutputAmount: z.string().optional(),
  slippageBps: z.number().optional(),
  priceImpactBps: z.number().optional(),
  simulation: simulationResultSchema.optional(),
  computeUnits: z.number().optional(),
  kmsKeyVersion: z.string().optional(),
  kmsRequested: z.boolean(),
  transactionSignature: z.string().optional(),
  submittedAt: z.string().optional(),
  outputTokenAccount: z.string().optional(),
  beforeOutputBalanceAtomic: z.string().regex(/^\d+$/).optional(),
  expectedOutputDeltaAtomic: z.string().regex(/^-?\d+$/).optional(),
  confirmedAt: z.string().optional(),
  commitment: commitmentLevelSchema.optional(),
  reconciliation: reconciliationSchema.optional(),
  failure: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1).max(1000),
      observedAt: z.string().datetime(),
    })
    .optional(),
});

export const proposalSchema = z.object({
  proposalId: z.string(),
  action: proposalActionSchema,
  inputMint: z.string().optional(),
  outputMint: z.string().optional(),
  inputSymbol: assetSymbolSchema.optional(),
  outputSymbol: assetSymbolSchema.optional(),
  amountAtomic: z.string().optional(),
  amountDisplay: z.string().optional(),
  amountUsd: z.number().optional(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(evidenceReferenceSchema),
  dataAsOf: z.string(),
  expiresAt: z.string(),
  policyVersion: z.string(),
  decision: policyDecisionSchema.optional(),
  status: proposalStatusSchema,
  ruleChecks: z.array(ruleCheckSchema),
  execution: executionSummarySchema.optional(),
});

export type Proposal = z.infer<typeof proposalSchema>;
export type ExecutionSummary = z.infer<typeof executionSummarySchema>;
export type RuleCheck = z.infer<typeof ruleCheckSchema>;
