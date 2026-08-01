import assert from "node:assert/strict";
import test from "node:test";
import type { JupiterQuote } from "../../src/providers/jupiter-quote.js";
import {
  decodeUnsignedVersionedTransaction,
  JupiterSwapError,
  JupiterSwapProvider,
} from "../../src/providers/jupiter-swap.js";

const quoteResponse = {
  inputMint: "sol-mint",
  inAmount: "100000000",
  outputMint: "usdc-mint",
  outAmount: "17057460",
  otherAmountThreshold: "16886885",
  swapMode: "ExactIn" as const,
  slippageBps: 100,
  priceImpactPct: "0.0001",
  routePlan: [{
    swapInfo: {
      ammKey: "amm-key",
      label: "Meteora DLMM",
      inputMint: "sol-mint",
      outputMint: "usdc-mint",
      inAmount: "100000000",
      outAmount: "17057460",
      feeAmount: "1285",
      feeMint: "usdc-mint",
    },
    percent: 100,
  }],
  contextSlot: 324307186,
  timeTaken: 0.012,
};

const quote: JupiterQuote = {
  routeLabel: "Meteora DLMM",
  inputAmountAtomic: "100000000",
  expectedOutputAmountAtomic: "17057460",
  minimumOutputAmountAtomic: "16886885",
  slippageBps: 100,
  priceImpactBps: 1,
  contextSlot: 324307186,
  response: quoteResponse,
};

function unsignedVersionedTransaction(): string {
  return Buffer.concat([
    Buffer.from([1]),
    Buffer.alloc(64),
    Buffer.from([0x80, 1, 0, 0]),
  ]).toString("base64");
}

function createProvider(
  payload: unknown,
  status = 200,
  capture?: (request: Request) => void,
) {
  return new JupiterSwapProvider({
    apiKey: "api-key",
    userPublicKey: "wallet-public-key",
    maxPriorityFeeLamports: 1_000_000,
    fetch: (async (input, init) => {
      const request = new Request(input, init);
      capture?.(request);
      return new Response(JSON.stringify(payload), { status });
    }) as typeof fetch,
  });
}

test("Jupiter swap provider returns an unsigned versioned transaction", async () => {
  let captured: Request | undefined;
  const provider = createProvider(
    {
      swapTransaction: unsignedVersionedTransaction(),
      lastValidBlockHeight: 324307300,
      prioritizationFeeLamports: 254600,
    },
    200,
    (request) => {
      captured = request;
    },
  );

  const result = await provider.createUnsignedTransaction(quote);
  const body = await captured!.json() as Record<string, unknown>;

  assert.equal(result.lastValidBlockHeight, 324307300);
  assert.equal(result.prioritizationFeeLamports, 254600);
  assert.equal(body?.userPublicKey, "wallet-public-key");
  assert.equal(body?.dynamicComputeUnitLimit, true);
  assert.equal(body?.dynamicSlippage, false);
  assert.deepEqual(body?.quoteResponse, quoteResponse);
});

test("Jupiter swap provider enforces the priority fee maximum", async () => {
  await assert.rejects(
    () => createProvider({
      swapTransaction: unsignedVersionedTransaction(),
      lastValidBlockHeight: 324307300,
      prioritizationFeeLamports: 1_000_001,
    }).createUnsignedTransaction(quote),
    /exceeds the configured maximum/,
  );
});

test("Jupiter swap provider rejects signed and legacy transactions", () => {
  const signed = Buffer.concat([
    Buffer.from([1]), Buffer.alloc(64, 1), Buffer.from([0x80, 1]),
  ]).toString("base64");
  const legacy = Buffer.concat([
    Buffer.from([1]), Buffer.alloc(64), Buffer.from([1, 1]),
  ]).toString("base64");

  assert.throws(() => decodeUnsignedVersionedTransaction(signed), /must be unsigned/);
  assert.throws(() => decodeUnsignedVersionedTransaction(legacy), /message version 0/);
  assert.throws(() => decodeUnsignedVersionedTransaction("not base64"), /valid Base64/);
});

test("Jupiter swap provider maps HTTP failures", async () => {
  await assert.rejects(
    () => createProvider({ error: "rate limited" }, 429).createUnsignedTransaction(quote),
    (error: unknown) => error instanceof JupiterSwapError && /HTTP 429/.test(error.message),
  );
});
