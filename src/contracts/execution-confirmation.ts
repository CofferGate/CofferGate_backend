import { z } from "zod";
import { assetSymbolSchema } from "./enums.js";

const atomicBalanceSchema = z.string().regex(/^\d+$/);
const atomicDeltaSchema = z.string().regex(/^-?\d+$/);

export const executionConfirmationObservationSchema = z.object({
  transactionSignature: z.string().min(1),
  commitment: z.enum(["confirmed", "finalized"]),
  confirmedAt: z.string().datetime(),
  asset: assetSymbolSchema,
  beforeBalanceAtomic: atomicBalanceSchema,
  afterBalanceAtomic: atomicBalanceSchema,
  expectedDeltaAtomic: atomicDeltaSchema,
});

export type ExecutionConfirmationObservation = z.infer<
  typeof executionConfirmationObservationSchema
>;
