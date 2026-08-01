import { z } from "zod";
import { assetSymbolSchema } from "./enums.js";

export const circuitBreakerStatusSchema = z.enum(["ACTIVE", "HALTED"]);

export const circuitBreakerParametersSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .nullable();

export const policySchema = z.object({
  policyVersion: z.string().min(1),
  effectiveFrom: z.string().datetime().nullable(),
  allowedInputMints: z.array(z.string()),
  allowedOutputMints: z.array(z.string()),
  allowedAssets: z.array(assetSymbolSchema),
  maxTransactionUsd: z.number().nonnegative(),
  dailyLimitUsd: z.number().nonnegative(),
  minimumReserve: z.object({
    amount: z.number().nonnegative(),
    asset: assetSymbolSchema,
  }),
  maxSlippageBps: z.number().int().nonnegative(),
  maxPriceImpactBps: z.number().int().nonnegative(),
  quoteMaxAgeSeconds: z.number().int().nonnegative(),
  allowedPrograms: z.array(z.string()),
  allowedSigners: z.array(z.string()),
  simulationRequired: z.boolean(),
  circuitBreakerParameters: circuitBreakerParametersSchema,
  circuitBreakerStatus: circuitBreakerStatusSchema,
});

export type Policy = z.infer<typeof policySchema>;
export type CircuitBreakerStatus = z.infer<
  typeof circuitBreakerStatusSchema
>;
