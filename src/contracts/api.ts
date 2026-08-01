import { z } from "zod";

export const apiEnvironmentSchema = z.enum(["mock", "devnet", "mainnet-beta"]);

export const apiMetaSchema = z.object({
  requestId: z.string().min(1),
  generatedAt: z.string().datetime(),
  environment: apiEnvironmentSchema,
});

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  proposalId: z.string().min(1).optional(),
  requestId: z.string().min(1),
});

export function apiResponseSchema<DataSchema extends z.ZodType>(
  dataSchema: DataSchema,
) {
  return z.object({
    data: dataSchema,
    meta: apiMetaSchema,
  });
}

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type ApiMeta = z.infer<typeof apiMetaSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiResponse<Data> = { data: Data; meta: ApiMeta };
