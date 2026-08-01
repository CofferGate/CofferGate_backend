import { createPublicKey, verify } from "node:crypto";
import { KeyManagementServiceClient, protos } from "@google-cloud/kms";
import crc32c from "fast-crc32c";
import { decodeBase58 } from "../encoding/base58.js";
import { inspectUnsignedVersionedTransaction } from "./jupiter-swap.js";

export interface KmsClient {
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

export interface CloudKmsSignerOptions {
  keyVersionName: string;
  expectedSignerPublicKey: string;
  client?: KmsClient;
}

export interface SignedSolanaTransaction {
  serializedTransaction: Buffer;
  signature: Buffer;
  kmsKeyVersion: string;
}

export class CloudKmsSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudKmsSigningError";
  }
}

export class CloudKmsTransactionSigner {
  private readonly client: KmsClient;

  constructor(private readonly options: CloudKmsSignerOptions) {
    if (!/\/cryptoKeyVersions\/[^/]+$/.test(options.keyVersionName)) {
      throw new Error("A Cloud KMS CryptoKeyVersion resource name is required.");
    }
    if (!options.expectedSignerPublicKey) {
      throw new Error("Expected Solana signer public key is required.");
    }
    this.client =
      options.client ??
      (new KeyManagementServiceClient() as unknown as KmsClient);
  }

  async signTransaction(transaction: Buffer): Promise<SignedSolanaTransaction> {
    const envelope = inspectUnsignedVersionedTransaction(transaction);
    if (envelope.signatureCount !== 1) {
      throw new CloudKmsSigningError("KMS signing requires exactly one transaction signer.");
    }
    const [publicKeyResponse] = await this.client.getPublicKey({
      name: this.options.keyVersionName,
    });
    if (
      publicKeyResponse.name !== this.options.keyVersionName ||
      publicKeyResponse.algorithm !== "EC_SIGN_ED25519" &&
      publicKeyResponse.algorithm !==
        protos.google.cloud.kms.v1.CryptoKeyVersion.CryptoKeyVersionAlgorithm
          .EC_SIGN_ED25519 ||
      !publicKeyResponse.pem
    ) {
      throw new CloudKmsSigningError("Cloud KMS key is not the expected Ed25519 key version.");
    }
    const pem = Buffer.from(publicKeyResponse.pem);
    if (readCrc32c(publicKeyResponse.pemCrc32c) !== crc32c.calculate(pem)) {
      throw new CloudKmsSigningError("Cloud KMS public key CRC32C verification failed.");
    }
    const publicKey = createPublicKey(publicKeyResponse.pem);
    const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
    const rawPublicKey = publicKeyDer.subarray(-32);
    if (
      rawPublicKey.length !== 32 ||
      !rawPublicKey.equals(decodeSolanaPublicKey(this.options.expectedSignerPublicKey))
    ) {
      throw new CloudKmsSigningError("Cloud KMS public key does not match the Solana signer.");
    }

    const dataCrc32c = crc32c.calculate(envelope.message);
    const [signResponse] = await this.client.asymmetricSign({
      name: this.options.keyVersionName,
      data: envelope.message,
      dataCrc32c: { value: dataCrc32c },
    });
    const signature = toBuffer(signResponse.signature);
    if (
      signResponse.name !== this.options.keyVersionName ||
      signResponse.verifiedDataCrc32c !== true ||
      signature.length !== 64 ||
      readCrc32c(signResponse.signatureCrc32c) !== crc32c.calculate(signature)
    ) {
      throw new CloudKmsSigningError("Cloud KMS signature integrity verification failed.");
    }
    if (!verify(null, envelope.message, publicKey, signature)) {
      throw new CloudKmsSigningError("Cloud KMS returned an invalid Ed25519 signature.");
    }

    const signedTransaction = Buffer.from(transaction);
    signature.copy(signedTransaction, envelope.signatureOffset);
    return {
      serializedTransaction: signedTransaction,
      signature,
      kmsKeyVersion: this.options.keyVersionName,
    };
  }
}

function readCrc32c(value: unknown): number {
  const wrapped = value as { value?: unknown } | null | undefined;
  const raw =
    wrapped !== null &&
    typeof wrapped === "object" &&
    "value" in wrapped
      ? wrapped.value
      : value;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CloudKmsSigningError("Cloud KMS returned an invalid CRC32C value.");
  }
  return parsed;
}

function toBuffer(value: Uint8Array | string | null | undefined): Buffer {
  if (typeof value === "string") return Buffer.from(value, "base64");
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new CloudKmsSigningError("Cloud KMS returned no signature.");
}

function decodeSolanaPublicKey(value: string): Buffer {
  try {
    return decodeBase58(value);
  } catch {
    throw new CloudKmsSigningError("Solana signer public key is not Base58.");
  }
}
