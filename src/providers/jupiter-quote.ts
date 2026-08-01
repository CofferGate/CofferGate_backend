import { z } from "zod";

const atomicAmountSchema = z.string().regex(/^\d+$/);
const routeStepSchema = z.object({
  swapInfo: z.object({
    ammKey: z.string().min(1),
    label: z.string().min(1),
    inputMint: z.string().min(1),
    outputMint: z.string().min(1),
    inAmount: atomicAmountSchema,
    outAmount: atomicAmountSchema,
    feeAmount: atomicAmountSchema,
    feeMint: z.string().min(1),
  }),
  percent: z.number().positive().max(100),
});

export const jupiterQuoteResponseSchema = z.object({
  inputMint: z.string().min(1),
  inAmount: atomicAmountSchema,
  outputMint: z.string().min(1),
  outAmount: atomicAmountSchema,
  otherAmountThreshold: atomicAmountSchema,
  swapMode: z.literal("ExactIn"),
  slippageBps: z.number().int().min(0).max(65_535),
  priceImpactPct: z.string().regex(/^\d+(?:\.\d+)?$/),
  routePlan: z.array(routeStepSchema).min(1),
  contextSlot: z.number().int().nonnegative(),
  timeTaken: z.number().nonnegative(),
}).passthrough();

export type JupiterQuoteResponse = z.infer<typeof jupiterQuoteResponseSchema>;

export interface JupiterQuoteRequest {
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  slippageBps: number;
}

export interface JupiterQuote {
  routeLabel: string;
  inputAmountAtomic: string;
  expectedOutputAmountAtomic: string;
  minimumOutputAmountAtomic: string;
  slippageBps: number;
  priceImpactBps: number;
  contextSlot: number;
  response: JupiterQuoteResponse;
}

export interface JupiterQuoteProviderOptions {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class JupiterQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JupiterQuoteError";
  }
}

export class JupiterQuoteProvider {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: JupiterQuoteProviderOptions) {
    if (!options.apiKey) throw new Error("Jupiter API key is required.");
    this.endpoint = options.endpoint ?? "https://api.jup.ag/swap/v1/quote";
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async getExactInQuote(request: JupiterQuoteRequest): Promise<JupiterQuote> {
    this.validateRequest(request);
    const url = new URL(this.endpoint);
    url.searchParams.set("inputMint", request.inputMint);
    url.searchParams.set("outputMint", request.outputMint);
    url.searchParams.set("amount", request.amountAtomic);
    url.searchParams.set("slippageBps", String(request.slippageBps));
    url.searchParams.set("swapMode", "ExactIn");
    url.searchParams.set("restrictIntermediateTokens", "true");

    const httpResponse = await this.fetchImplementation(url, {
      method: "GET",
      headers: { "x-api-key": this.options.apiKey },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!httpResponse.ok) {
      throw new JupiterQuoteError(`Jupiter Quote API returned HTTP ${httpResponse.status}.`);
    }
    const response = jupiterQuoteResponseSchema.parse(await httpResponse.json());
    if (
      response.inputMint !== request.inputMint ||
      response.outputMint !== request.outputMint ||
      response.inAmount !== request.amountAtomic ||
      response.slippageBps !== request.slippageBps
    ) {
      throw new JupiterQuoteError("Jupiter quote does not match the request.");
    }
    if (
      BigInt(response.outAmount) <= 0n ||
      BigInt(response.otherAmountThreshold) <= 0n ||
      BigInt(response.otherAmountThreshold) > BigInt(response.outAmount)
    ) {
      throw new JupiterQuoteError("Jupiter quote contains invalid output amounts.");
    }

    return {
      routeLabel: [...new Set(response.routePlan.map((step) => step.swapInfo.label))].join(" → "),
      inputAmountAtomic: response.inAmount,
      expectedOutputAmountAtomic: response.outAmount,
      minimumOutputAmountAtomic: response.otherAmountThreshold,
      slippageBps: response.slippageBps,
      priceImpactBps: Number(response.priceImpactPct) * 10_000,
      contextSlot: response.contextSlot,
      response,
    };
  }

  private validateRequest(request: JupiterQuoteRequest): void {
    if (!request.inputMint || !request.outputMint || request.inputMint === request.outputMint) {
      throw new Error("Quote mints must be present and different.");
    }
    if (!/^\d+$/.test(request.amountAtomic)) throw new Error("Quote amount must be atomic.");
    const amount = BigInt(request.amountAtomic);
    if (amount <= 0n || amount > 18_446_744_073_709_551_615n) {
      throw new Error("Quote amount must fit uint64.");
    }
    if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps > 65_535) {
      throw new Error("Quote slippage must fit uint16.");
    }
  }
}
