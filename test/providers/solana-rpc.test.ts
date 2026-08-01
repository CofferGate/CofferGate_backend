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
