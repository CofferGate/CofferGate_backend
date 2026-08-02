import { createPublicKey, verify } from "node:crypto";
import { KeyManagementServiceClient, protos } from "@google-cloud/kms";
import crc32c from "fast-crc32c";
import { decodeSolanaAddress } from "./devnet-token-payment.js";

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

export class CloudKmsTransactionSigner {
  private readonly client: KmsClient;

  constructor(
    private readonly keyVersion: string,
    private readonly expectedSignerAddress: string,
    client?: KmsClient,
  ) {
    if (!/\/cryptoKeyVersions\/[^/]+$/.test(keyVersion)) {
      throw new Error("A Cloud KMS CryptoKeyVersion resource name is required.");
    }
    decodeSolanaAddress(expectedSignerAddress);
    this.client = client ?? new KeyManagementServiceClient() as unknown as KmsClient;
  }

  async sign(message: Buffer): Promise<{ signature: Buffer; keyVersion: string }> {
    if (message.length === 0 || message.length > 1_232) {
      throw new Error("Solana transaction message has an invalid size.");
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
      throw new Error("Cloud KMS transaction key is invalid.");
    }
    const publicKey = createPublicKey(key.pem);
    const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
    const rawPublicKey = Buffer.from(publicKeyDer).subarray(-32);
    if (!rawPublicKey.equals(decodeSolanaAddress(this.expectedSignerAddress))) {
      throw new Error("Cloud KMS key does not match the configured Solana signer.");
    }

    const [response] = await this.client.asymmetricSign({
      name: this.keyVersion,
      data: message,
      dataCrc32c: { value: crc32c.calculate(message) },
    });
    const signature = toBuffer(response.signature);
    if (
      response.name !== this.keyVersion ||
      response.verifiedDataCrc32c !== true ||
      signature.length !== 64 ||
      readCrc32c(response.signatureCrc32c) !== crc32c.calculate(signature) ||
      !verify(null, message, publicKey, signature)
    ) {
      throw new Error("Cloud KMS transaction signature is invalid.");
    }
    return { signature, keyVersion: this.keyVersion };
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
  throw new Error("Cloud KMS returned no transaction signature.");
}
