import assert from "node:assert/strict";
import test from "node:test";
import {
  SolanaRpcError,
  SolanaRpcProvider,
} from "../../src/providers/solana-rpc.js";

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

test("Solana RPC provider returns confirmed signature with block time", async () => {
  const mock = createFetch([
    {
      jsonrpc: "2.0",
      result: {
        value: [
          { slot: 123, err: null, confirmationStatus: "finalized" },
        ],
      },
      id: 1,
    },
    { jsonrpc: "2.0", result: 1_775_000_000, id: 2 },
  ]);
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: mock.fetch,
  });

  const result = await provider.getSignatureStatus("signature_01");

  assert.deepEqual(result, {
    status: "CONFIRMED",
    slot: 123,
    commitment: "finalized",
    confirmedAt: new Date(1_775_000_000_000).toISOString(),
  });
  assert.deepEqual(
    (mock.requests[0] as { method: string }).method,
    "getSignatureStatuses",
  );
  assert.deepEqual(
    (mock.requests[1] as { method: string }).method,
    "getBlockTime",
  );
});

test("Solana RPC provider distinguishes pending, failed, and missing signatures", async () => {
  const statuses = [
    { slot: 1, err: null, confirmationStatus: "processed" },
    { slot: 2, err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" },
    null,
  ];
  for (const expected of ["PENDING", "FAILED", "NOT_FOUND"] as const) {
    const provider = new SolanaRpcProvider({
      endpoint: "https://api.devnet.solana.com",
      fetch: createFetch([
        { jsonrpc: "2.0", result: { value: [statuses.shift()] }, id: 1 },
      ]).fetch,
    });
    assert.equal((await provider.getSignatureStatus("signature_01")).status, expected);
  }
});

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

test("Solana RPC provider simulates unsigned transactions", async () => {
  const mock = createFetch([
    {
      jsonrpc: "2.0",
      result: {
        context: { slot: 393226680 },
        value: {
          err: null,
          logs: ["Program swap success"],
          unitsConsumed: 1714,
          replacementBlockhash: {
            blockhash: "replacement-blockhash",
            lastValidBlockHeight: 381186895,
          },
        },
      },
      id: 1,
    },
  ]);
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: mock.fetch,
  });

  assert.deepEqual(await provider.simulateTransaction(Buffer.from([1, 2, 3]), 324307186), {
    ok: true,
    slot: 393226680,
    unitsConsumed: 1714,
    logs: ["Program swap success"],
    replacementBlockhash: "replacement-blockhash",
    lastValidBlockHeight: 381186895,
  });
  const request = mock.requests[0] as {
    method: string;
    params: [string, Record<string, unknown>];
  };
  assert.equal(request.method, "simulateTransaction");
  assert.equal(request.params[0], Buffer.from([1, 2, 3]).toString("base64"));
  assert.deepEqual(request.params[1], {
    commitment: "confirmed",
    encoding: "base64",
    replaceRecentBlockhash: true,
    sigVerify: false,
    minContextSlot: 324307186,
  });
});

test("Solana RPC provider returns simulation program failures", async () => {
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: createFetch([
      {
        jsonrpc: "2.0",
        result: {
          context: { slot: 393226680 },
          value: {
            err: { InstructionError: [2, { Custom: 6001 }] },
            logs: ["Program log: Slippage tolerance exceeded"],
            unitsConsumed: 201234,
          },
        },
        id: 1,
      },
    ]).fetch,
  });

  assert.deepEqual(await provider.simulateTransaction(Buffer.from([1])), {
    ok: false,
    slot: 393226680,
    error: { InstructionError: [2, { Custom: 6001 }] },
    unitsConsumed: 201234,
    logs: ["Program log: Slippage tolerance exceeded"],
  });
});

test("Solana RPC provider rejects invalid simulation inputs and responses", async () => {
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: createFetch([]).fetch,
  });
  await assert.rejects(() => provider.simulateTransaction(Buffer.alloc(0)));
  await assert.rejects(() => provider.simulateTransaction(Buffer.alloc(1_233)));
  await assert.rejects(() => provider.simulateTransaction(Buffer.from([1]), -1));
});

test("Solana RPC provider submits signed transactions with preflight", async () => {
  const signature = Buffer.alloc(64, 1);
  const signedTransaction = Buffer.concat([
    Buffer.from([1]), signature, Buffer.from([0x80, 1, 0, 0]),
  ]);
  const expectedSignature =
    "2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2";
  const mock = createFetch([
    { jsonrpc: "2.0", result: expectedSignature, id: 1 },
  ]);
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: mock.fetch,
  });

  assert.equal(
    await provider.sendTransaction(signedTransaction, {
      minContextSlot: 324307186,
      maxRetries: 5,
    }),
    expectedSignature,
  );
  const request = mock.requests[0] as {
    method: string;
    params: [string, Record<string, unknown>];
  };
  assert.equal(request.method, "sendTransaction");
  assert.equal(request.params[0], signedTransaction.toString("base64"));
  assert.deepEqual(request.params[1], {
    encoding: "base64",
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
    minContextSlot: 324307186,
  });
});

test("Solana RPC provider rejects unsafe transaction submissions", async () => {
  const signature = Buffer.alloc(64, 1);
  const signedTransaction = Buffer.concat([
    Buffer.from([1]), signature, Buffer.from([0x80, 1, 0, 0]),
  ]);
  const provider = new SolanaRpcProvider({
    endpoint: "https://api.devnet.solana.com",
    fetch: createFetch([
      { jsonrpc: "2.0", result: "mismatched-signature", id: 1 },
    ]).fetch,
  });

  await assert.rejects(
    () => provider.sendTransaction(signedTransaction),
    /mismatched transaction signature/,
  );
  await assert.rejects(
    () => provider.sendTransaction(Buffer.concat([
      Buffer.from([1]), Buffer.alloc(64), Buffer.from([0x80, 1, 0, 0]),
    ])),
    /must be signed/,
  );
  await assert.rejects(() => provider.sendTransaction(signedTransaction, { maxRetries: -1 }));
  await assert.rejects(() => provider.sendTransaction(signedTransaction, { minContextSlot: -1 }));
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
