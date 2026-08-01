import { createPublicKey, verify } from "node:crypto";
import { KeyManagementServiceClient, protos } from "@google-cloud/kms";
import crc32c from "fast-crc32c";

interface KmsClient {
  getPublicKey(request: { name: string }): Promise<[{
    name?: string | null;
    algorithm?: string | number | null;
    pem?: string | null;
    pemCrc32c?: unknown;
  }]>;
  asymmetricSign(request: {
    name: string;
    data: Buffer;
    dataCrc32c: { value: number };
  }): Promise<[{
    name?: string | null;
    signature?: Uint8Array | string | null;
    signatureCrc32c?: unknown;
    verifiedDataCrc32c?: boolean | null;
  }]>;
}

export class CloudKmsAttestationSigner {
  private readonly client: KmsClient;

  constructor(
    private readonly keyVersion: string,
    client?: KmsClient,
  ) {
    if (!/\/cryptoKeyVersions\/[^/]+$/.test(keyVersion)) {
      throw new Error("A Cloud KMS CryptoKeyVersion resource name is required.");
    }
    this.client = client ?? new KeyManagementServiceClient() as unknown as KmsClient;
  }

  async sign(payload: Buffer): Promise<{ signature: string; keyVersion: string }> {
    if (payload.length === 0 || payload.length > 4096) {
      throw new Error("Attestation payload has an invalid size.");
    }
    const [key] = await this.client.getPublicKey({ name: this.keyVersion });
    const ed25519 =
      protos.google.cloud.kms.v1.CryptoKeyVersion.CryptoKeyVersionAlgorithm
        .EC_SIGN_ED25519;
    if (
      key.name !== this.keyVersion ||
      (key.algorithm !== "EC_SIGN_ED25519" && key.algorithm !== ed25519) ||
      !key.pem ||
      readCrc32c(key.pemCrc32c) !== crc32c.calculate(Buffer.from(key.pem))
    ) {
      throw new Error("Cloud KMS attestation key is invalid.");
    }
    const publicKey = createPublicKey(key.pem);
    const [response] = await this.client.asymmetricSign({
      name: this.keyVersion,
      data: payload,
      dataCrc32c: { value: crc32c.calculate(payload) },
    });
    const signature = toBuffer(response.signature);
    if (
      response.name !== this.keyVersion ||
      response.verifiedDataCrc32c !== true ||
      signature.length !== 64 ||
      readCrc32c(response.signatureCrc32c) !== crc32c.calculate(signature) ||
      !verify(null, payload, publicKey, signature)
    ) {
      throw new Error("Cloud KMS attestation signature is invalid.");
    }
    return {
      signature: signature.toString("base64"),
      keyVersion: this.keyVersion,
    };
  }
}

function readCrc32c(value: unknown): number {
  const raw = typeof value === "object" && value !== null && "value" in value
    ? (value as { value: unknown }).value
    : value;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Cloud KMS returned an invalid CRC32C value.");
  }
  return parsed;
}

function toBuffer(value: Uint8Array | string | null | undefined): Buffer {
  if (typeof value === "string") return Buffer.from(value, "base64");
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error("Cloud KMS returned no attestation signature.");
}
