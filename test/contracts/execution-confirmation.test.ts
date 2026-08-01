import assert from "node:assert/strict";
import test from "node:test";
import { executionConfirmationObservationSchema } from "../../src/contracts/index.js";

const observation = {
  transactionSignature: "signature_01",
  commitment: "confirmed",
  confirmedAt: "2026-08-01T06:02:00.000Z",
  asset: "USDC",
  beforeBalanceAtomic: "10000000",
  afterBalanceAtomic: "14830000",
  expectedDeltaAtomic: "4830000",
} as const;

test("execution confirmation accepts atomic balance observations", () => {
  assert.equal(
    executionConfirmationObservationSchema.safeParse(observation).success,
    true,
  );
});

test("execution confirmation rejects processed and decimal observations", () => {
  assert.equal(
    executionConfirmationObservationSchema.safeParse({
      ...observation,
      commitment: "processed",
    }).success,
    false,
  );
  assert.equal(
    executionConfirmationObservationSchema.safeParse({
      ...observation,
      afterBalanceAtomic: "14.83",
    }).success,
    false,
  );
});
