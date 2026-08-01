import type { Proposal } from "../contracts/index.js";
import type { DemoAttestationRepository } from "../repositories/proposal-repository.js";

export interface DemoAttestationSigner {
  sign(payload: Buffer): Promise<{ signature: string; keyVersion: string }>;
}

export type DemoAttestationResult =
  | { status: "ATTESTED"; proposal: Proposal }
  | { status: "ALREADY_ATTESTED"; proposal: Proposal }
  | { status: "NOT_FOUND" }
  | { status: "NOT_ELIGIBLE" }
  | { status: "CONFLICT" };

export class DemoAttestationService {
  constructor(
    private readonly repository: DemoAttestationRepository,
    private readonly signer: DemoAttestationSigner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async attest(proposalId: string): Promise<DemoAttestationResult> {
    const proposal = await this.repository.findById(proposalId);
    if (!proposal) return { status: "NOT_FOUND" };
    if (proposal.status === "SIMULATED") {
      return { status: "ALREADY_ATTESTED", proposal };
    }
    if (
      proposal.status !== "POLICY_APPROVED" ||
      proposal.decision !== "AUTO" ||
      proposal.action !== "SWAP"
    ) {
      return { status: "NOT_ELIGIBLE" };
    }

    const attestedAt = this.now().toISOString();
    const payload = Buffer.from(JSON.stringify({
      schema: "coffergate.devnet.attestation.v1",
      proposalId: proposal.proposalId,
      policyVersion: proposal.policyVersion,
      action: proposal.action,
      amountUsd: proposal.amountUsd,
      attestedAt,
    }));
    const signed = await this.signer.sign(payload);
    const simulated: Proposal = {
      ...proposal,
      status: "SIMULATED",
      execution: {
        mode: "demo",
        kmsRequested: true,
        kmsKeyVersion: signed.keyVersion,
        attestationSignature: signed.signature,
        attestedAt,
      },
    };
    const saved = await this.repository.saveDemoAttestation(simulated);
    if (saved === "SAVED") return { status: "ATTESTED", proposal: simulated };
    if (saved === "ALREADY_SAVED") {
      return { status: "ALREADY_ATTESTED", proposal: simulated };
    }
    return { status: saved === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT" };
  }
}
