import assert from "node:assert/strict";
import test from "node:test";
import {
  JupiterPriceError,
  JupiterSolPriceProvider,
} from "../../src/providers/jupiter-price.js";

const solMint = "So11111111111111111111111111111111111111112";

function createProvider(payload: unknown, status = 200, capture?: (request: Request) => void) {
  return new JupiterSolPriceProvider({
    apiKey: "secret-api-key",
    solMint,
    now: () => new Date("2026-08-01T06:00:01.000Z"),
    fetch: (async (input, init) => {
      const request = new Request(input, init);
      capture?.(request);
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
}

test("Jupiter provider returns SOL price evidence", async () => {
  let captured: Request | undefined;
  const provider = createProvider(
    {
      [solMint]: {
        createdAt: "2026-08-01T06:00:00.000Z",
        liquidity: 621_679_197.67,
        usdPrice: 147.48,
        blockId: 348_004_023,
        decimals: 9,
        priceChange24h: 1.29,
      },
    },
    200,
    (request) => {
      captured = request;
    },
  );

  assert.deepEqual(await provider.getSolPrice(), {
    priceUsd: 147.48,
    observedAt: "2026-08-01T06:00:01.000Z",
    evidenceRef: {
      id: `jupiter-price:${solMint}:348004023`,
      label: "Jupiter SOL/USD price",
      sourceType: "PRICE_FEED",
      observedAt: "2026-08-01T06:00:01.000Z",
      url: `https://api.jup.ag/price/v3?ids=${solMint}`,
    },
  });
  assert.equal(captured?.headers.get("x-api-key"), "secret-api-key");
});

test("Jupiter provider rejects HTTP errors and missing prices", async () => {
  await assert.rejects(
    () => createProvider({ error: "rate limited" }, 429).getSolPrice(),
    (error: unknown) =>
      error instanceof JupiterPriceError && /HTTP 429/.test(error.message),
  );
  await assert.rejects(
    () => createProvider({}).getSolPrice(),
    /no SOL price/,
  );
});

test("Jupiter provider rejects malformed and nonpositive prices", async () => {
  for (const usdPrice of [0, -1, "147.48"] as const) {
    await assert.rejects(() =>
      createProvider({
        [solMint]: {
          createdAt: "2026-08-01T06:00:00.000Z",
          usdPrice,
          blockId: 348_004_023,
          decimals: 9,
        },
      }).getSolPrice(),
    );
  }
});
