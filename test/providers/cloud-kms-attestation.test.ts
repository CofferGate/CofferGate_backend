import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import crc32c from "fast-crc32c";
import { CloudKmsAttestationSigner } from "../../src/providers/cloud-kms-attestation.js";

test("Cloud KMS attestation verifies CRC32C and Ed25519 signature", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyVersion = "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1";
  const signer = new CloudKmsAttestationSigner(keyVersion, {
    async getPublicKey() {
      return [{ name: keyVersion, algorithm: "EC_SIGN_ED25519", pem, pemCrc32c: { value: crc32c.calculate(Buffer.from(pem)) } }];
    },
    async asymmetricSign(request) {
      const signature = sign(null, request.data, privateKey);
      assert.equal(request.dataCrc32c.value, crc32c.calculate(request.data));
      return [{ name: keyVersion, signature, signatureCrc32c: { value: crc32c.calculate(signature) }, verifiedDataCrc32c: true }];
    },
  });

  const result = await signer.sign(Buffer.from("approved-demo-proposal"));
  assert.equal(result.keyVersion, keyVersion);
  assert.equal(Buffer.from(result.signature, "base64").length, 64);
});

test("Cloud KMS attestation rejects tampered integrity metadata", async () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyVersion = "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1";
  const signer = new CloudKmsAttestationSigner(keyVersion, {
    async getPublicKey() {
      return [{ name: keyVersion, algorithm: "EC_SIGN_ED25519", pem, pemCrc32c: { value: 0 } }];
    },
    async asymmetricSign() { throw new Error("must not sign"); },
  });
  await assert.rejects(() => signer.sign(Buffer.from("payload")), /key is invalid/);
});
