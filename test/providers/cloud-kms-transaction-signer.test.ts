import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
} from "node:crypto";
import test from "node:test";
import { getBase58Decoder } from "@solana/kit";
import crc32c from "fast-crc32c";
import { CloudKmsTransactionSigner } from "../../src/providers/cloud-kms-transaction-signer.js";

function createKmsFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const rawPublicKey = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32);
  return {
    privateKey,
    pem,
    signerAddress: getBase58Decoder().decode(rawPublicKey),
  };
}

test("Cloud KMS signs a Solana message only for the configured signer", async () => {
  const fixture = createKmsFixture();
  const keyVersion = "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1";
  const signer = new CloudKmsTransactionSigner(
    keyVersion,
    fixture.signerAddress,
    {
      async getPublicKey() {
        return [{
          name: keyVersion,
          algorithm: "EC_SIGN_ED25519",
          pem: fixture.pem,
          pemCrc32c: { value: crc32c.calculate(Buffer.from(fixture.pem)) },
        }];
      },
      async asymmetricSign(request) {
        assert.equal(request.dataCrc32c.value, crc32c.calculate(request.data));
        const signature = sign(null, request.data, fixture.privateKey);
        return [{
          name: keyVersion,
          signature,
          signatureCrc32c: { value: crc32c.calculate(signature) },
          verifiedDataCrc32c: true,
        }];
      },
    },
  );

  const result = await signer.sign(Buffer.from("compiled-solana-message"));
  assert.equal(result.keyVersion, keyVersion);
  assert.equal(result.signature.length, 64);
});

test("Cloud KMS rejects a key that does not own the payment wallet", async () => {
  const fixture = createKmsFixture();
  const otherFixture = createKmsFixture();
  const keyVersion = "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1";
  const signer = new CloudKmsTransactionSigner(
    keyVersion,
    otherFixture.signerAddress,
    {
      async getPublicKey() {
        return [{
          name: keyVersion,
          algorithm: "EC_SIGN_ED25519",
          pem: fixture.pem,
          pemCrc32c: { value: crc32c.calculate(Buffer.from(fixture.pem)) },
        }];
      },
      async asymmetricSign() {
        throw new Error("must not sign");
      },
    },
  );

  await assert.rejects(
    () => signer.sign(Buffer.from("compiled-solana-message")),
    /does not match/,
  );
});

test("Cloud KMS rejects tampered transaction signature metadata", async () => {
  const fixture = createKmsFixture();
  const keyVersion = "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1";
  const signer = new CloudKmsTransactionSigner(
    keyVersion,
    fixture.signerAddress,
    {
      async getPublicKey() {
        return [{
          name: keyVersion,
          algorithm: "EC_SIGN_ED25519",
          pem: fixture.pem,
          pemCrc32c: { value: crc32c.calculate(Buffer.from(fixture.pem)) },
        }];
      },
      async asymmetricSign(request) {
        const signature = sign(null, request.data, fixture.privateKey);
        return [{
          name: keyVersion,
          signature,
          signatureCrc32c: { value: 0 },
          verifiedDataCrc32c: true,
        }];
      },
    },
  );

  await assert.rejects(
    () => signer.sign(Buffer.from("compiled-solana-message")),
    /signature is invalid/,
  );
});
