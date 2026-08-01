import assert from "node:assert/strict";
import test from "node:test";
import { encodeBase58 } from "../../src/encoding/base58.js";
import { SolanaProgramAllowlistValidator } from "../../src/services/solana-program-allowlist.js";

function transaction(programIndex = 1): Buffer {
  const message = Buffer.concat([
    Buffer.from([0x80, 1, 0, 0, 2]),
    Buffer.alloc(32),
    Buffer.alloc(32, 1),
    Buffer.alloc(32, 2),
    Buffer.from([1, programIndex, 0, 0, 0]),
  ]);
  return Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
}

test("Solana program allowlist accepts static program IDs", () => {
  const programId = encodeBase58(Buffer.alloc(32, 1));
  assert.deepEqual(
    new SolanaProgramAllowlistValidator().validate(transaction(), [programId]),
    [programId],
  );
});

test("Solana program allowlist rejects denied and lookup-table programs", () => {
  const validator = new SolanaProgramAllowlistValidator();
  assert.throws(() => validator.validate(transaction(), []), /non-allowlisted program/);
  assert.throws(() => validator.validate(transaction(2), []), /Lookup-table program IDs/);
  assert.throws(() => validator.validate(transaction().subarray(0, -1), []), /malformed/);
});
