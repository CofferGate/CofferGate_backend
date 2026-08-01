import type { AppConfig } from "../config.js";
import { CloudKmsAttestationSigner } from "../providers/cloud-kms-attestation.js";
import type { DemoAttestationRepository } from "../repositories/proposal-repository.js";
import { DemoAttestationService } from "./demo-attestation.js";

export function createDemoAttestationService(
  config: AppConfig,
  repository: DemoAttestationRepository,
): DemoAttestationService {
  if (!config.CLOUD_KMS_KEY_VERSION) {
    throw new Error("CLOUD_KMS_KEY_VERSION is required for demo attestation.");
  }
  return new DemoAttestationService(
    repository,
    new CloudKmsAttestationSigner(config.CLOUD_KMS_KEY_VERSION),
  );
}
