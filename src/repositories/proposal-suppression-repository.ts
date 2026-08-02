import { z } from "zod";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

const suppressionDocumentSchema = z.object({
  lastClaimedAt: z.string().datetime(),
});

export type ProposalSuppressionClaimResult = "CLAIMED" | "SUPPRESSED";

export interface ProposalSuppressionRepository {
  claim(
    fingerprint: string,
    claimedAt: Date,
    cooldownSeconds: number,
  ): Promise<ProposalSuppressionClaimResult>;
}

export class FirestoreProposalSuppressionRepository
  implements ProposalSuppressionRepository
{
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly collectionName = "proposalSuppressions",
  ) {}

  async claim(
    fingerprint: string,
    claimedAt: Date,
    cooldownSeconds: number,
  ): Promise<ProposalSuppressionClaimResult> {
    const reference = this.database.collection(this.collectionName).doc(fingerprint);

    return this.database.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (document.exists) {
        const current = suppressionDocumentSchema.parse(document.data());
        const elapsedMs = claimedAt.getTime() - Date.parse(current.lastClaimedAt);
        if (elapsedMs >= 0 && elapsedMs < cooldownSeconds * 1_000) {
          return "SUPPRESSED";
        }
      }
      transaction.set(reference, { lastClaimedAt: claimedAt.toISOString() });
      return "CLAIMED";
    });
  }
}

export class InMemoryProposalSuppressionRepository
  implements ProposalSuppressionRepository
{
  private readonly claimedAtByFingerprint = new Map<string, number>();

  async claim(
    fingerprint: string,
    claimedAt: Date,
    cooldownSeconds: number,
  ): Promise<ProposalSuppressionClaimResult> {
    const current = this.claimedAtByFingerprint.get(fingerprint);
    if (
      current !== undefined &&
      claimedAt.getTime() >= current &&
      claimedAt.getTime() - current < cooldownSeconds * 1_000
    ) {
      return "SUPPRESSED";
    }
    this.claimedAtByFingerprint.set(fingerprint, claimedAt.getTime());
    return "CLAIMED";
  }
}
