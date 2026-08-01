import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  evidenceReferenceSchema,
  proposalSchema,
  type Proposal,
} from "../contracts/index.js";

const vertexProposalDecisionSchema = z
  .object({
    action: z.enum(["NO_ACTION", "SWAP"]),
    inputSymbol: z.enum(["SOL", "USDC"]).optional(),
    outputSymbol: z.enum(["SOL", "USDC"]).optional(),
    amountUsd: z.number().positive().optional(),
    rationale: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((value, context) => {
    if (
      value.action === "SWAP" &&
      (!value.inputSymbol || !value.outputSymbol || value.amountUsd === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "SWAP decisions require input, output, and amountUsd.",
      });
    }
    if (
      value.action === "SWAP" &&
      value.inputSymbol === value.outputSymbol
    ) {
      context.addIssue({ code: "custom", message: "Swap assets must differ." });
    }
  });

export const vertexProposalGenerationInputSchema = z.object({
  proposalId: z.string().min(1),
  policyVersion: z.string().min(1),
  dataAsOf: z.string().datetime(),
  expiresAt: z.string().datetime(),
  solBalance: z.string().regex(/^\d+(?:\.\d+)?$/),
  usdcBalance: z.string().regex(/^\d+(?:\.\d+)?$/),
  targetUsdcBalance: z.string().regex(/^\d+(?:\.\d+)?$/),
  solPriceUsd: z.number().positive(),
  assetMints: z.object({ SOL: z.string().min(1), USDC: z.string().min(1) }),
  evidenceRefs: z.array(evidenceReferenceSchema),
});

export type VertexProposalGenerationInput = z.infer<
  typeof vertexProposalGenerationInputSchema
>;

interface VertexClient {
  models: {
    generateContent(request: unknown): Promise<{ text: string | undefined }>;
  };
}

export interface VertexProposalProviderOptions {
  projectId: string;
  location: string;
  model: string;
  client?: VertexClient;
}

export class VertexProposalProvider {
  private readonly client: VertexClient;

  constructor(private readonly options: VertexProposalProviderOptions) {
    this.client =
      options.client ??
      new GoogleGenAI({
        vertexai: true,
        project: options.projectId,
        location: options.location,
      });
  }

  async generate(input: VertexProposalGenerationInput): Promise<Proposal> {
    const validatedInput = vertexProposalGenerationInputSchema.parse(input);
    const response = await this.client.models.generateContent({
      model: this.options.model,
      contents: this.buildPrompt(validatedInput),
      config: {
        temperature: 0,
        seed: 0,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          additionalProperties: false,
          required: ["action", "rationale", "confidence"],
          properties: {
            action: { type: "string", enum: ["NO_ACTION", "SWAP"] },
            inputSymbol: { type: "string", enum: ["SOL", "USDC"] },
            outputSymbol: { type: "string", enum: ["SOL", "USDC"] },
            amountUsd: { type: "number", exclusiveMinimum: 0 },
            rationale: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    });
    if (!response.text) {
      throw new Error("Vertex AI returned no proposal content.");
    }
    const decision = vertexProposalDecisionSchema.parse(JSON.parse(response.text));
    const swapFields =
      decision.action === "SWAP"
        ? {
            inputSymbol: decision.inputSymbol,
            outputSymbol: decision.outputSymbol,
            inputMint: validatedInput.assetMints[decision.inputSymbol!],
            outputMint: validatedInput.assetMints[decision.outputSymbol!],
            amountUsd: decision.amountUsd,
          }
        : {};

    return proposalSchema.parse({
      proposalId: validatedInput.proposalId,
      action: decision.action,
      ...swapFields,
      rationale: decision.rationale,
      confidence: decision.confidence,
      evidenceRefs: validatedInput.evidenceRefs,
      dataAsOf: validatedInput.dataAsOf,
      expiresAt: validatedInput.expiresAt,
      policyVersion: validatedInput.policyVersion,
      status: "AI_REVIEWED",
      ruleChecks: [],
    });
  }

  private buildPrompt(input: VertexProposalGenerationInput): string {
    return [
      "Decide whether the operations wallet needs a SOL/USDC swap.",
      "Return NO_ACTION when no trade is needed. Do not invent evidence or identifiers.",
      JSON.stringify({
        solBalance: input.solBalance,
        usdcBalance: input.usdcBalance,
        targetUsdcBalance: input.targetUsdcBalance,
        solPriceUsd: input.solPriceUsd,
      }),
    ].join("\n");
  }
}
