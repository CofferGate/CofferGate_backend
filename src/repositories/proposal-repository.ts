import { z } from "zod";
import {
  proposalSchema,
  type Proposal,
  type ProposalStatus,
} from "../contracts/index.js";
import type { FirestoreDatabase } from "../infrastructure/firestore.js";

export interface ProposalRepository {
  create(proposal: Proposal): Promise<ProposalCreateResult>;
  list(): Promise<Proposal[]>;
  findById(proposalId: string): Promise<Proposal | null>;
  savePolicyEvaluation(
    proposal: Proposal,
    expectedStatus: ProposalStatus,
  ): Promise<ProposalEvaluationSaveResult>;
}

export interface DevnetPaymentExecutionRepository {
  findById(proposalId: string): Promise<Proposal | null>;
  claimDevnetPayment(proposalId: string): Promise<ProposalExecutionClaimResult>;
}

export interface DemoAttestationRepository {
  findById(proposalId: string): Promise<Proposal | null>;
  saveDemoAttestation(
    proposal: Proposal,
  ): Promise<ProposalDemoAttestationSaveResult>;
}

export type ProposalCreateResult =
  | "CREATED"
  | "ALREADY_EXISTS"
  | "ID_CONFLICT";

export type ProposalEvaluationSaveResult =
  | "SAVED"
  | "NOT_FOUND"
  | "STATUS_CONFLICT";

export type ProposalExecutionClaimResult =
  | { status: "CLAIMED"; proposal: Proposal }
  | { status: "ALREADY_CLAIMED"; proposal: Proposal }
  | { status: "NOT_FOUND" }
  | { status: "NOT_ELIGIBLE" };

export type ProposalDemoAttestationSaveResult =
  | "SAVED"
  | "ALREADY_SAVED"
  | "NOT_FOUND"
  | "STATUS_CONFLICT";

function validateProposalCreation(proposal: Proposal): Proposal {
  const validatedProposal = proposalSchema.parse(proposal);
  if (
    validatedProposal.status !== "AI_REVIEWED" ||
    validatedProposal.decision !== undefined ||
    validatedProposal.ruleChecks.length !== 0 ||
    validatedProposal.execution !== undefined
  ) {
    throw new Error("Proposal does not contain a valid creation state.");
  }
  return validatedProposal;
}

function proposalsMatch(left: Proposal, right: Proposal): boolean {
  return (
    JSON.stringify(proposalCreationFields(left)) ===
    JSON.stringify(proposalCreationFields(right))
  );
}

function proposalCreationFields(proposal: Proposal) {
  const {
    decision: _decision,
    status: _status,
    ruleChecks: _ruleChecks,
    execution: _execution,
    ...creationFields
  } = proposal;
  return creationFields;
}

export class FirestoreProposalRepository implements ProposalRepository {
  constructor(
    private readonly database: FirestoreDatabase,
    private readonly collectionName = "proposals",
  ) {}

  async create(proposal: Proposal): Promise<ProposalCreateResult> {
    const validatedProposal = validateProposalCreation(proposal);
    const reference = this.database
      .collection(this.collectionName)
      .doc(validatedProposal.proposalId);

    return this.database.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (document.exists) {
        const existingProposal = this.parseDocument(
          document.id,
          document.data(),
        );
        return proposalsMatch(existingProposal, validatedProposal)
          ? "ALREADY_EXISTS"
          : "ID_CONFLICT";
      }
      transaction.set(reference, validatedProposal);
      return "CREATED";
    });
  }

  async list(): Promise<Proposal[]> {
    const snapshot = await this.database.collection(this.collectionName).get();
    return snapshot.docs.map((document) =>
      this.parseDocument(document.id, document.data()),
    );
  }

  async findById(proposalId: string): Promise<Proposal | null> {
    const document = await this.database
      .collection(this.collectionName)
      .doc(proposalId)
      .get();

    return document.exists
      ? this.parseDocument(document.id, document.data())
      : null;
  }

  async savePolicyEvaluation(
    proposal: Proposal,
    expectedStatus: ProposalStatus,
  ): Promise<ProposalEvaluationSaveResult> {
    const validatedProposal = proposalSchema.parse(proposal);
    const reference = this.database
      .collection(this.collectionName)
      .doc(validatedProposal.proposalId);

    return this.database.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) {
        return "NOT_FOUND";
      }

      const currentProposal = this.parseDocument(document.id, document.data());
      if (currentProposal.status !== expectedStatus) {
        return "STATUS_CONFLICT";
      }

      transaction.set(reference, validatedProposal);
      return "SAVED";
    });
  }

  async claimDevnetPayment(proposalId: string): Promise<ProposalExecutionClaimResult> {
    const reference = this.database.collection(this.collectionName).doc(proposalId);
    return this.database.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) return { status: "NOT_FOUND" };
      const current = this.parseDocument(document.id, document.data());
      if (current.status === "EXECUTING") {
        return { status: "ALREADY_CLAIMED", proposal: current };
      }
      if (!isDevnetPaymentEligible(current)) return { status: "NOT_ELIGIBLE" };
      const claimed = createExecutionClaim(current);
      transaction.set(reference, claimed);
      return { status: "CLAIMED", proposal: claimed };
    });
  }

  async saveDemoAttestation(
    proposal: Proposal,
  ): Promise<ProposalDemoAttestationSaveResult> {
    const validatedProposal = validateDemoAttestation(proposal);
    const reference = this.database
      .collection(this.collectionName)
      .doc(validatedProposal.proposalId);

    return this.database.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) return "NOT_FOUND";
      const current = this.parseDocument(document.id, document.data());
      if (current.status === "SIMULATED") {
        return current.execution?.attestationSignature ===
          validatedProposal.execution?.attestationSignature
          ? "ALREADY_SAVED"
          : "STATUS_CONFLICT";
      }
      if (current.status !== "POLICY_APPROVED") return "STATUS_CONFLICT";
      transaction.set(reference, validatedProposal);
      return "SAVED";
    });
  }

  private parseDocument(documentId: string, data: unknown): Proposal {
    const proposal = proposalSchema.parse(data);
    if (proposal.proposalId !== documentId) {
      throw new Error(
        `Proposal document ID ${documentId} does not match proposalId ${proposal.proposalId}.`,
      );
    }
    return proposal;
  }

}

export class InMemoryProposalRepository implements ProposalRepository {
  private readonly proposals: Map<string, Proposal>;

  constructor(proposals: Proposal[] = []) {
    const validatedProposals = z.array(proposalSchema).parse(proposals);
    this.proposals = new Map(
      validatedProposals.map((proposal) => [proposal.proposalId, proposal]),
    );
  }

  async create(proposal: Proposal): Promise<ProposalCreateResult> {
    const validatedProposal = validateProposalCreation(proposal);
    const existingProposal = this.proposals.get(validatedProposal.proposalId);
    if (existingProposal) {
      return proposalsMatch(existingProposal, validatedProposal)
        ? "ALREADY_EXISTS"
        : "ID_CONFLICT";
    }
    this.proposals.set(validatedProposal.proposalId, validatedProposal);
    return "CREATED";
  }

  async list(): Promise<Proposal[]> {
    return Array.from(this.proposals.values());
  }

  async findById(proposalId: string): Promise<Proposal | null> {
    return this.proposals.get(proposalId) ?? null;
  }

  async savePolicyEvaluation(
    proposal: Proposal,
    expectedStatus: ProposalStatus,
  ): Promise<ProposalEvaluationSaveResult> {
    const validatedProposal = proposalSchema.parse(proposal);
    const currentProposal = this.proposals.get(validatedProposal.proposalId);
    if (!currentProposal) {
      return "NOT_FOUND";
    }
    if (currentProposal.status !== expectedStatus) {
      return "STATUS_CONFLICT";
    }

    this.proposals.set(validatedProposal.proposalId, validatedProposal);
    return "SAVED";
  }

  async claimDevnetPayment(proposalId: string): Promise<ProposalExecutionClaimResult> {
    const current = this.proposals.get(proposalId);
    if (!current) return { status: "NOT_FOUND" };
    if (current.status === "EXECUTING") {
      return { status: "ALREADY_CLAIMED", proposal: current };
    }
    if (!isDevnetPaymentEligible(current)) return { status: "NOT_ELIGIBLE" };
    const claimed = createExecutionClaim(current);
    this.proposals.set(proposalId, claimed);
    return { status: "CLAIMED", proposal: claimed };
  }

  async saveDemoAttestation(
    proposal: Proposal,
  ): Promise<ProposalDemoAttestationSaveResult> {
    const validatedProposal = validateDemoAttestation(proposal);
    const current = this.proposals.get(validatedProposal.proposalId);
    if (!current) return "NOT_FOUND";
    if (current.status === "SIMULATED") {
      return current.execution?.attestationSignature ===
        validatedProposal.execution?.attestationSignature
        ? "ALREADY_SAVED"
        : "STATUS_CONFLICT";
    }
    if (current.status !== "POLICY_APPROVED") return "STATUS_CONFLICT";
    this.proposals.set(validatedProposal.proposalId, validatedProposal);
    return "SAVED";
  }
}

function isDevnetPaymentEligible(proposal: Proposal): boolean {
  return proposal.status === "POLICY_APPROVED" &&
    proposal.decision === "AUTO" &&
    proposal.action === "SWAP" &&
    proposal.execution === undefined;
}

function createExecutionClaim(proposal: Proposal): Proposal {
  return proposalSchema.parse({
    ...proposal,
    status: "EXECUTING",
    execution: { mode: "demo", kmsRequested: false },
  });
}

function validateDemoAttestation(proposal: Proposal): Proposal {
  const validated = proposalSchema.parse(proposal);
  if (
    validated.status !== "SIMULATED" ||
    validated.decision !== "AUTO" ||
    validated.execution?.mode !== "demo" ||
    validated.execution.kmsRequested !== true ||
    !validated.execution.kmsKeyVersion ||
    !validated.execution.attestationSignature ||
    !validated.execution.attestedAt ||
    validated.execution.transactionSignature ||
    validated.execution.submittedAt
  ) {
    throw new Error("Proposal does not contain a valid demo attestation.");
  }
  return validated;
}
