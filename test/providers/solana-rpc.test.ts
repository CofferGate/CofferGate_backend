import assert from "node:assert/strict";
import test from "node:test";
import { getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import {
  SolanaRpcError,
  SolanaRpcProvider,
} from "../../src/providers/solana-rpc.js";
import {
  attachDevnetTokenPaymentSignature,
  buildDevnetTokenPayment,
} from "../../src/providers/devnet-token-payment.js";

function createFetch(responses: unknown[], requests: unknown[] = []) {
  return {
    requests,
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      const payload = responses.shift();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  };
}
test("Solana RPC provider returns atomic token balances", async () => {
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: createFetch([
      {
        jsonrpc: "2.0",
        result: { value: { amount: "14830000", decimals: 6 } },
        id: 1,
      },
    ]).fetch,
  });

  assert.deepEqual(await provider.getTokenBalance("token-account"), {
    amountAtomic: "14830000",
    decimals: 6,
  });
});

test("Solana RPC provider returns atomic native balance", async () => {
  const mock = createFetch([
    { jsonrpc: "2.0", result: { value: 1_250_000_000 }, id: 1 },
  ]);
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: mock.fetch,
  });

  assert.deepEqual(await provider.getNativeBalance("wallet-address"), {
    amountAtomic: "1250000000",
    decimals: 9,
  });
  assert.equal((mock.requests[0] as { method: string }).method, "getBalance");
});

test("Solana RPC provider rejects RPC errors and malformed balances", async () => {
  const rpcErrorProvider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: createFetch([
      { jsonrpc: "2.0", error: { code: -32602, message: "Invalid params" }, id: 1 },
    ]).fetch,
  });
  await assert.rejects(
    () => rpcErrorProvider.getTokenBalance("invalid"),
    (error: unknown) =>
      error instanceof SolanaRpcError && error.code === -32602,
  );

  const malformedProvider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: createFetch([
      {
        jsonrpc: "2.0",
        result: { value: { amount: "14.83", decimals: 6 } },
        id: 1,
      },
    ]).fetch,
  });
  await assert.rejects(() => malformedProvider.getTokenBalance("invalid"));
});

test("Solana RPC provider returns confirmed block height", async () => {
  const mock = createFetch([{ jsonrpc: "2.0", result: 324307200, id: 1 }]);
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: mock.fetch,
  });

  assert.equal(await provider.getBlockHeight(324307186), 324307200);
  assert.deepEqual(mock.requests[0], {
    jsonrpc: "2.0", id: 1, method: "getBlockHeight",
    params: [{ commitment: "confirmed", minContextSlot: 324307186 }],
  });
  await assert.rejects(() => provider.getBlockHeight(-1));
});

test("Solana RPC provider prepares, simulates, and submits transactions", async () => {
  const prepared = buildDevnetTokenPayment({
    signerAddress: "HagEUkB4BY95ndDkiGmfQEDrATmuow6UwEehsriqAsDZ",
    sourceTokenAccount: "5cB6k64vh1VvBxd6q4tYYLoi1o5gH2ecSi9LKBuLzAiq",
    destinationTokenAccount: "4Nd1mYbN4JrJ7fFWVQxZFKJysXcXGkqYqVUgVd1G7GmA",
    mintAddress: "AYneHfKF7XxhEM3EXdk7EykSPzjfc58bRSotwkECXntQ",
    amountAtomic: "10000",
    decimals: 6,
    recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 324307200,
  });
  const signedTransaction = attachDevnetTokenPaymentSignature(
    prepared.transaction,
    "HagEUkB4BY95ndDkiGmfQEDrATmuow6UwEehsriqAsDZ",
    Buffer.alloc(64, 7),
  );
  const expectedSignature = getSignatureFromTransaction(
    getTransactionDecoder().decode(signedTransaction),
  );
  const mock = createFetch([
    {
      jsonrpc: "2.0",
      result: {
        context: { slot: 324307186 },
        value: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 324307200,
        },
      },
      id: 1,
    },
    {
      jsonrpc: "2.0",
      result: {
        context: { slot: 324307187 },
        value: { err: null, logs: ["Program log: success"], unitsConsumed: 6210 },
      },
      id: 2,
    },
    { jsonrpc: "2.0", result: expectedSignature, id: 3 },
  ]);
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: mock.fetch,
  });

  assert.deepEqual(await provider.getLatestBlockhash(), {
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 324307200,
    slot: 324307186,
  });
  assert.deepEqual(await provider.simulateTransaction(Buffer.alloc(200)), {
    ok: true,
    slot: 324307187,
    unitsConsumed: 6210,
    logs: ["Program log: success"],
  });
  assert.equal(
    await provider.sendTransaction(signedTransaction),
    expectedSignature,
  );
  assert.equal((mock.requests[0] as { method: string }).method, "getLatestBlockhash");
  assert.equal((mock.requests[1] as { method: string }).method, "simulateTransaction");
  assert.equal((mock.requests[2] as { method: string }).method, "sendTransaction");
});

test("Solana RPC provider exposes failed simulation evidence", async () => {
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: createFetch([
      {
        jsonrpc: "2.0",
        result: {
          context: { slot: 324307187 },
          value: {
            err: { InstructionError: [0, "Custom"] },
            logs: ["Program log: failed"],
            unitsConsumed: 1000,
          },
        },
        id: 1,
      },
    ]).fetch,
  });

  assert.deepEqual(await provider.simulateTransaction(Buffer.alloc(200)), {
    ok: false,
    slot: 324307187,
    unitsConsumed: 1000,
    logs: ["Program log: failed"],
    error: { InstructionError: [0, "Custom"] },
  });
  await assert.rejects(() => provider.sendTransaction(Buffer.alloc(1_233)));
});

test("Solana RPC provider rejects a mismatched submission signature", async () => {
  const prepared = buildDevnetTokenPayment({
    signerAddress: "HagEUkB4BY95ndDkiGmfQEDrATmuow6UwEehsriqAsDZ",
    sourceTokenAccount: "5cB6k64vh1VvBxd6q4tYYLoi1o5gH2ecSi9LKBuLzAiq",
    destinationTokenAccount: "4Nd1mYbN4JrJ7fFWVQxZFKJysXcXGkqYqVUgVd1G7GmA",
    mintAddress: "AYneHfKF7XxhEM3EXdk7EykSPzjfc58bRSotwkECXntQ",
    amountAtomic: "10000",
    decimals: 6,
    recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 324307200,
  });
  const signedTransaction = attachDevnetTokenPaymentSignature(
    prepared.transaction,
    "HagEUkB4BY95ndDkiGmfQEDrATmuow6UwEehsriqAsDZ",
    Buffer.alloc(64, 7),
  );
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: createFetch([
      { jsonrpc: "2.0", result: "different-signature", id: 1 },
    ]).fetch,
  });

  await assert.rejects(
    () => provider.sendTransaction(signedTransaction),
    /mismatched transaction signature/,
  );
});
