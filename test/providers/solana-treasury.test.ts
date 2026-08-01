import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAtomicAmount,
  SolanaTreasurySnapshotProvider,
} from "../../src/providers/solana-treasury.js";

test("Solana treasury provider builds concurrent balance evidence", async () => {
  const calls: string[] = [];
  const provider = new SolanaTreasurySnapshotProvider({
    rpc: {
      async getNativeBalance(address) {
        calls.push(`SOL:${address}`);
        return { amountAtomic: "1250000000", decimals: 9 };
      },
      async getTokenBalance(account) {
        calls.push(`USDC:${account}`);
        return { amountAtomic: "14830000", decimals: 6 };
      },
    },
    walletAddress: "wallet-address",
    usdcTokenAccount: "usdc-account",
    solMint: "sol-mint",
    usdcMint: "usdc-mint",
    targetUsdcBalance: "20",
    now: () => new Date("2026-08-01T06:00:00.000Z"),
  });

  const snapshot = await provider.getSnapshot();

  assert.equal(snapshot.solBalance, "1.25");
  assert.equal(snapshot.usdcBalance, "14.83");
  assert.deepEqual(snapshot.assetMints, { SOL: "sol-mint", USDC: "usdc-mint" });
  assert.deepEqual(calls, ["SOL:wallet-address", "USDC:usdc-account"]);
  assert.equal(snapshot.evidenceRefs.length, 2);
});

test("atomic amount formatting preserves precision", () => {
  assert.equal(formatAtomicAmount("1", 9), "0.000000001");
  assert.equal(formatAtomicAmount("1000000", 6), "1");
  assert.equal(formatAtomicAmount("9007199254740993123456", 6), "9007199254740993.123456");
  assert.throws(() => formatAtomicAmount("1.5", 6));
});
