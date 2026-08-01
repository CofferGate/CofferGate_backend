import { z } from "zod";
import type {
  SolPriceObservation,
  SolPriceProvider,
} from "../services/proposal-generation-context.js";

const priceEntrySchema = z.object({
  createdAt: z.string().datetime(),
  usdPrice: z.number().positive(),
  blockId: z.number().int().nonnegative(),
  decimals: z.number().int().nonnegative(),
  liquidity: z.number().nonnegative().optional(),
  priceChange24h: z.number().optional(),
});

export interface JupiterPriceProviderOptions {
  apiKey: string;
  solMint: string;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class JupiterPriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JupiterPriceError";
  }
}

export class JupiterSolPriceProvider implements SolPriceProvider {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: JupiterPriceProviderOptions) {
    if (!options.apiKey || !options.solMint) {
      throw new Error("Jupiter API key and SOL mint are required.");
    }
    this.endpoint = options.endpoint ?? "https://api.jup.ag/price/v3";
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async getSolPrice(): Promise<SolPriceObservation> {
    const url = new URL(this.endpoint);
    url.searchParams.set("ids", this.options.solMint);
    const response = await this.fetchImplementation(url, {
      method: "GET",
      headers: { "x-api-key": this.options.apiKey },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new JupiterPriceError(
        `Jupiter Price API returned HTTP ${response.status}.`,
      );
    }

    const payload: unknown = await response.json();
    const record = z.record(z.string(), priceEntrySchema).parse(payload);
    const price = record[this.options.solMint];
    if (!price) {
      throw new JupiterPriceError("Jupiter returned no SOL price.");
    }

    return {
      priceUsd: price.usdPrice,
      observedAt: price.createdAt,
      evidenceRef: {
        id: `jupiter-price:${this.options.solMint}:${price.blockId}`,
        label: "Jupiter SOL/USD price",
        sourceType: "PRICE_FEED",
        observedAt: price.createdAt,
        url: url.toString(),
      },
    };
  }
}
