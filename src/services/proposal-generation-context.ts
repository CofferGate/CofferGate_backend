import { z } from "zod";
import {
  evidenceReferenceSchema,
  type EvidenceReference,
} from "../contracts/index.js";
import {
  vertexProposalGenerationInputSchema,
  type VertexProposalGenerationInput,
} from "../providers/vertex-proposal.js";
import type { PolicyRepository } from "../repositories/policy-repository.js";

const treasurySnapshotSchema = z.object({
  solBalance: z.string().regex(/^\d+(?:\.\d+)?$/),
  usdcBalance: z.string().regex(/^\d+(?:\.\d+)?$/),
  targetUsdcBalance: z.string().regex(/^\d+(?:\.\d+)?$/),
  assetMints: z.object({ SOL: z.string().min(1), USDC: z.string().min(1) }),
  observedAt: z.string().datetime(),
  evidenceRefs: z.array(evidenceReferenceSchema),
});

const solPriceObservationSchema = z.object({
  priceUsd: z.number().positive(),
  observedAt: z.string().datetime(),
  evidenceRef: evidenceReferenceSchema,
});

export type TreasurySnapshot = z.infer<typeof treasurySnapshotSchema>;
export type SolPriceObservation = z.infer<typeof solPriceObservationSchema>;

export interface TreasurySnapshotProvider {
  getSnapshot(): Promise<TreasurySnapshot>;
}

export interface SolPriceProvider {
  getSolPrice(): Promise<SolPriceObservation>;
}

export interface ProposalGenerationContextDependencies {
  policyRepository: PolicyRepository;
  treasurySnapshotProvider: TreasurySnapshotProvider;
  solPriceProvider: SolPriceProvider;
  proposalTtlSeconds: number;
  now?: () => Date;
}

export type ProposalGenerationContextResult =
  | { status: "READY"; input: VertexProposalGenerationInput }
  | { status: "POLICY_NOT_CONFIGURED" };

export class ProposalGenerationContextService {
  constructor(
    private readonly dependencies: ProposalGenerationContextDependencies,
  ) {
    if (
      !Number.isInteger(dependencies.proposalTtlSeconds) ||
      dependencies.proposalTtlSeconds <= 0
    ) {
      throw new Error("Proposal TTL must be a positive integer.");
    }
  }

  async build(proposalId: string): Promise<ProposalGenerationContextResult> {
    const policy = await this.dependencies.policyRepository.getCurrent();
    if (!policy) {
      return { status: "POLICY_NOT_CONFIGURED" };
    }

    const [rawTreasurySnapshot, rawPriceObservation] = await Promise.all([
      this.dependencies.treasurySnapshotProvider.getSnapshot(),
      this.dependencies.solPriceProvider.getSolPrice(),
    ]);
    const treasurySnapshot = treasurySnapshotSchema.parse(rawTreasurySnapshot);
    const priceObservation = solPriceObservationSchema.parse(
      rawPriceObservation,
    );
    const now = (this.dependencies.now ?? (() => new Date()))();
    this.rejectFutureObservation(treasurySnapshot.observedAt, now);
    this.rejectFutureObservation(priceObservation.observedAt, now);

    return {
      status: "READY",
      input: vertexProposalGenerationInputSchema.parse({
        proposalId,
        policyVersion: policy.policyVersion,
        dataAsOf: this.earliestObservation([
          treasurySnapshot.observedAt,
          priceObservation.observedAt,
        ]),
        expiresAt: new Date(
          now.getTime() + this.dependencies.proposalTtlSeconds * 1_000,
        ).toISOString(),
        solBalance: treasurySnapshot.solBalance,
        usdcBalance: treasurySnapshot.usdcBalance,
        targetUsdcBalance: treasurySnapshot.targetUsdcBalance,
        solPriceUsd: priceObservation.priceUsd,
        assetMints: treasurySnapshot.assetMints,
        evidenceRefs: this.uniqueEvidence([
          ...treasurySnapshot.evidenceRefs,
          priceObservation.evidenceRef,
        ]),
      }),
    };
  }

  private rejectFutureObservation(observedAt: string, now: Date): void {
    if (Date.parse(observedAt) > now.getTime()) {
      throw new Error("Proposal evidence must not be observed in the future.");
    }
  }

  private earliestObservation(observations: string[]): string {
    return observations.reduce((earliest, current) =>
      Date.parse(current) < Date.parse(earliest) ? current : earliest,
    );
  }

  private uniqueEvidence(evidenceRefs: EvidenceReference[]): EvidenceReference[] {
    const ids = new Set<string>();
    return evidenceRefs.filter((evidenceRef) => {
      if (ids.has(evidenceRef.id)) {
        throw new Error(`Duplicate proposal evidence ID: ${evidenceRef.id}.`);
      }
      ids.add(evidenceRef.id);
      return true;
    });
  }
}
