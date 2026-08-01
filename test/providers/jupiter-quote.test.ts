import assert from "node:assert/strict";
import test from "node:test";
import {
  JupiterQuoteError,
  JupiterQuoteProvider,
} from "../../src/providers/jupiter-quote.js";

const request = {
  inputMint: "sol-mint",
  outputMint: "usdc-mint",
  amountAtomic: "100000000",
  slippageBps: 100,
};

const response = {
  inputMint: request.inputMint,
  inAmount: request.amountAtomic,
  outputMint: request.outputMint,
  outAmount: "17057460",
  otherAmountThreshold: "16886885",
  swapMode: "ExactIn",
  slippageBps: request.slippageBps,
  priceImpactPct: "0.0001",
  routePlan: [
    {
      swapInfo: {
        ammKey: "amm-key",
        label: "Meteora DLMM",
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inAmount: request.amountAtomic,
        outAmount: "17057460",
        feeAmount: "1285",
        feeMint: request.outputMint,
      },
      percent: 100,
    },
  ],
  contextSlot: 324307186,
  timeTaken: 0.012,
};

function createProvider(payload: unknown, status = 200, capture?: (request: Request) => void) {
  return new JupiterQuoteProvider({
    apiKey: "api-key",
    fetch: (async (input, init) => {
      const captured = new Request(input, init);
      capture?.(captured);
      return new Response(JSON.stringify(payload), { status });
    }) as typeof fetch,
  });
}

test("Jupiter quote provider returns exact-in execution amounts", async () => {
  let captured: Request | undefined;
  const quote = await createProvider(response, 200, (value) => { captured = value; })
    .getExactInQuote(request);

  assert.equal(quote.routeLabel, "Meteora DLMM");
  assert.equal(quote.expectedOutputAmountAtomic, "17057460");
  assert.equal(quote.minimumOutputAmountAtomic, "16886885");
  assert.equal(quote.priceImpactBps, 1);
  assert.equal(captured?.headers.get("x-api-key"), "api-key");
  assert.equal(new URL(captured!.url).searchParams.get("restrictIntermediateTokens"), "true");
});

test("Jupiter quote provider rejects request and response mismatches", async () => {
  await assert.rejects(
    () => createProvider({ ...response, inputMint: "other" }).getExactInQuote(request),
    /does not match/,
  );
  await assert.rejects(
    () => createProvider({ ...response, otherAmountThreshold: "18000000" }).getExactInQuote(request),
    /invalid output amounts/,
  );
});

test("Jupiter quote provider validates atomic limits and HTTP errors", async () => {
  await assert.rejects(() => createProvider(response).getExactInQuote({ ...request, amountAtomic: "0" }));
  await assert.rejects(() => createProvider(response).getExactInQuote({ ...request, amountAtomic: "18446744073709551616" }));
  await assert.rejects(
    () => createProvider({ error: "rate limited" }, 429).getExactInQuote(request),
    (error: unknown) => error instanceof JupiterQuoteError && /HTTP 429/.test(error.message),
  );
});
