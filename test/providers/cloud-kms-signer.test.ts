import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import crc32c from "fast-crc32c";
import {
  CloudKmsSigningError,
  CloudKmsTransactionSigner,
  type KmsClient,
} from "../../src/providers/cloud-kms-signer.js";

const keyVersionName =
  "projects/project/locations/global/keyRings/ring/cryptoKeys/key/cryptoKeyVersions/1";

function unsignedTransaction(): Buffer {
  return Buffer.concat([
    Buffer.from([1]),
    Buffer.alloc(64),
    Buffer.from([0x80, 1, 0, 0]),
  ]);
}

function encodeBase58(value: Buffer): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${value.toString("hex")}`);
  let encoded = "";
  while (number > 0n) {
    encoded = alphabet[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  const leadingZeros = value.findIndex((byte) => byte !== 0);
  return "1".repeat(leadingZeros < 0 ? value.length : leadingZeros) + encoded;
}

function createFixture(overrides: {
  algorithm?: string;
  publicKeyCrc?: number;
  signatureCrc?: number;
  verifiedDataCrc32c?: boolean;
  corruptSignature?: boolean;
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const rawPublicKey = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32);
  let capturedRequest: { data: Buffer; dataCrc32c: { value: number } } | undefined;
  const client: KmsClient = {
    async getPublicKey() {
      return [{
        name: keyVersionName,
        algorithm: overrides.algorithm ?? "EC_SIGN_ED25519",
        pem,
        pemCrc32c:
          overrides.publicKeyCrc ?? crc32c.calculate(Buffer.from(pem)),
      }];
    },
    async asymmetricSign(request: {
      name: string;
      data: Buffer;
      dataCrc32c: { value: number };
    }) {
      capturedRequest = request;
      const validSignature = sign(null, request.data, privateKey);
      const signature = overrides.corruptSignature
        ? Buffer.from(validSignature).fill(1, 0, 1)
        : validSignature;
      return [{
        name: keyVersionName,
        signature,
        signatureCrc32c:
          overrides.signatureCrc ?? crc32c.calculate(signature),
        verifiedDataCrc32c: overrides.verifiedDataCrc32c ?? true,
      }];
    },
  };
  return {
    client,
    expectedSignerPublicKey: encodeBase58(rawPublicKey),
    getCapturedRequest: () => capturedRequest,
  };
}

test("Cloud KMS signer signs only the versioned transaction message", async () => {
  const fixture = createFixture();
  const signer = new CloudKmsTransactionSigner({
    keyVersionName,
    expectedSignerPublicKey: fixture.expectedSignerPublicKey,
    client: fixture.client,
  });

  const result = await signer.signTransaction(unsignedTransaction());

  assert.equal(result.signature.length, 64);
  assert.equal(result.kmsKeyVersion, keyVersionName);
  assert.deepEqual(result.serializedTransaction.subarray(1, 65), result.signature);
  assert.deepEqual(fixture.getCapturedRequest()?.data, Buffer.from([0x80, 1, 0, 0]));
  assert.equal(
    fixture.getCapturedRequest()?.dataCrc32c.value,
    crc32c.calculate(Buffer.from([0x80, 1, 0, 0])),
  );
});

test("Cloud KMS signer rejects algorithms and public key mismatches", async () => {
  const wrongAlgorithm = createFixture({ algorithm: "EC_SIGN_P256_SHA256" });
  await assert.rejects(
    () => new CloudKmsTransactionSigner({
      keyVersionName,
      expectedSignerPublicKey: wrongAlgorithm.expectedSignerPublicKey,
      client: wrongAlgorithm.client,
    }).signTransaction(unsignedTransaction()),
    /not the expected Ed25519/,
  );

  const wrongSigner = createFixture();
  await assert.rejects(
    () => new CloudKmsTransactionSigner({
      keyVersionName,
      expectedSignerPublicKey: "11111111111111111111111111111111",
      client: wrongSigner.client,
    }).signTransaction(unsignedTransaction()),
    /does not match/,
  );
});

test("Cloud KMS signer rejects CRC32C and signature tampering", async () => {
  for (const fixture of [
    createFixture({ publicKeyCrc: 1 }),
    createFixture({ signatureCrc: 1 }),
    createFixture({ verifiedDataCrc32c: false }),
    createFixture({ corruptSignature: true }),
  ]) {
    await assert.rejects(
      () => new CloudKmsTransactionSigner({
        keyVersionName,
        expectedSignerPublicKey: fixture.expectedSignerPublicKey,
        client: fixture.client,
      }).signTransaction(unsignedTransaction()),
      (error: unknown) => error instanceof CloudKmsSigningError,
    );
  }
});

test("Cloud KMS signer rejects multi-signer transactions", async () => {
  const transaction = Buffer.concat([
    Buffer.from([2]), Buffer.alloc(128), Buffer.from([0x80, 2, 0, 0]),
  ]);
  const fixture = createFixture();
  await assert.rejects(
    () => new CloudKmsTransactionSigner({
      keyVersionName,
      expectedSignerPublicKey: fixture.expectedSignerPublicKey,
      client: fixture.client,
    }).signTransaction(transaction),
    /exactly one transaction signer/,
  );
});
