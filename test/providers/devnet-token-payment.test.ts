import assert from "node:assert/strict";
import test from "node:test";
import { address, getTransactionDecoder } from "@solana/kit";
import {
  attachDevnetTokenPaymentSignature,
  buildDevnetTokenPayment,
} from "../../src/providers/devnet-token-payment.js";

const payment = {
  signerAddress: "HagEUkB4BY95ndDkiGmfQEDrATmuow6UwEehsriqAsDZ",
  sourceTokenAccount: "5cB6k64vh1VvBxd6q4tYYLoi1o5gH2ecSi9LKBuLzAiq",
  destinationTokenAccount: "4Nd1mYbN4JrJ7fFWVQxZFKJysXcXGkqYqVUgVd1G7GmA",
  mintAddress: "AYneHfKF7XxhEM3EXdk7EykSPzjfc58bRSotwkECXntQ",
  amountAtomic: "10000",
  decimals: 6,
  recentBlockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 324307200,
};

test("Devnet token payment requires one configured KMS signer", () => {
  const prepared = buildDevnetTokenPayment(payment);

  assert.deepEqual(Object.keys(prepared.transaction.signatures), [payment.signerAddress]);
  assert.equal(prepared.message.length > 0, true);
  assert.equal(prepared.unsignedTransaction.length <= 1_232, true);

  const signed = attachDevnetTokenPaymentSignature(
    prepared.transaction,
    payment.signerAddress,
    Buffer.alloc(64, 7),
  );
  const decoded = getTransactionDecoder().decode(signed);
  assert.equal(decoded.signatures[address(payment.signerAddress)]?.length, 64);
});

test("Devnet token payment rejects unsafe amounts and signer mismatches", () => {
  assert.throws(
    () => buildDevnetTokenPayment({ ...payment, amountAtomic: "0" }),
    /positive atomic amount/,
  );
  assert.throws(
    () => buildDevnetTokenPayment({ ...payment, amountAtomic: "1.5" }),
    /positive atomic amount/,
  );
  const prepared = buildDevnetTokenPayment(payment);
  assert.throws(
    () => attachDevnetTokenPaymentSignature(
      prepared.transaction,
      "C56cDPCV4Tv7QFMQpnTLPm9ArYcKZLKjdHkaJ6ioEboM",
      Buffer.alloc(64),
    ),
    /does not match/,
  );
  assert.throws(
    () => attachDevnetTokenPaymentSignature(
      prepared.transaction,
      payment.signerAddress,
      Buffer.alloc(63),
    ),
    /64 bytes/,
  );
});
