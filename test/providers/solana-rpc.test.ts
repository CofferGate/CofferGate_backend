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
