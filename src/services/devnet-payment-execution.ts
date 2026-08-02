import type { Proposal } from "../contracts/index.js";
import {
  attachDevnetTokenPaymentSignature,
  buildDevnetTokenPayment,
  type DevnetTokenPaymentInput,
} from "../providers/devnet-token-payment.js";
import type {
  DevnetPaymentExecutionRepository,
  ProposalEvaluationSaveResult,
} from "../repositories/proposal-repository.js";

interface PaymentRepository extends DevnetPaymentExecutionRepository {
  savePolicyEvaluation(
    proposal: Proposal,
    expectedStatus: "EXECUTING",
  ): Promise<ProposalEvaluationSaveResult>;
}

export interface DevnetPaymentRpc {
  getTokenBalance(tokenAccount: string): Promise<{ amountAtomic: string; decimals: number }>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number; slot: number }>;
  simulateTransaction(transaction: Buffer): Promise<{
    ok: boolean;
    unitsConsumed?: number;
    error?: unknown;
  }>;
  sendTransaction(transaction: Buffer): Promise<string>;
  confirmTransaction(
    signature: string,
    lastValidBlockHeight: number,
  ): Promise<{ commitment: "confirmed" | "finalized" }>;
}

export interface DevnetPaymentSigner {
  sign(message: Buffer): Promise<{ signature: Buffer; keyVersion: string }>;
}

export interface DevnetPaymentExecutionOptions {
  signerAddress: string;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  mintAddress: string;
  amountAtomic: string;
  decimals: number;
}

export type DevnetPaymentExecutionResult =
  | { status: "RECONCILED"; proposal: Proposal }
  | { status: "FAILED"; proposal: Proposal }
  | { status: "NOT_FOUND" | "NOT_ELIGIBLE" | "ALREADY_EXECUTING" | "CONFLICT" };

export class DevnetPaymentExecutionService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly rpc: DevnetPaymentRpc,
    private readonly signer: DevnetPaymentSigner,
    private readonly options: DevnetPaymentExecutionOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(proposalId: string): Promise<DevnetPaymentExecutionResult> {
    const claim = await this.repository.claimDevnetPayment(proposalId);
    if (claim.status === "NOT_FOUND" || claim.status === "NOT_ELIGIBLE") return claim;
    if (claim.status === "ALREADY_CLAIMED") return { status: "ALREADY_EXECUTING" };

    const proposal = claim.proposal;
    try {
      const before = await this.rpc.getTokenBalance(this.options.destinationTokenAccount);
      if (before.decimals !== this.options.decimals) {
        throw new Error("Destination token decimals do not match the configured payment mint.");
      }
      const lifetime = await this.rpc.getLatestBlockhash();
      const paymentInput: DevnetTokenPaymentInput = {
        ...this.options,
        recentBlockhash: lifetime.blockhash,
        lastValidBlockHeight: lifetime.lastValidBlockHeight,
      };
      const prepared = buildDevnetTokenPayment(paymentInput);
      const simulation = await this.rpc.simulateTransaction(prepared.unsignedTransaction);
      if (!simulation.ok) throw new Error("Devnet payment simulation failed.");
      const signed = await this.signer.sign(prepared.message);
      const transaction = attachDevnetTokenPaymentSignature(
        prepared.transaction,
        this.options.signerAddress,
        signed.signature,
      );
      const submittedAt = this.now().toISOString();
      const transactionSignature = await this.rpc.sendTransaction(transaction);
      const confirmation = await this.rpc.confirmTransaction(
        transactionSignature,
        lifetime.lastValidBlockHeight,
      );
      const confirmedAt = this.now().toISOString();
      const after = await this.rpc.getTokenBalance(this.options.destinationTokenAccount);
      const actualDelta = BigInt(after.amountAtomic) - BigInt(before.amountAtomic);
      const expectedDelta = BigInt(this.options.amountAtomic);
      const reconciliationStatus = actualDelta === expectedDelta ? "MATCHED" : "MISMATCHED";
      const completed: Proposal = {
        ...proposal,
        status: "RECONCILED",
        execution: {
          mode: "demo",
          routeLabel: "Devnet SPL Token TransferChecked",
          expectedInputAmount: this.options.amountAtomic,
          expectedOutputAmount: this.options.amountAtomic,
          simulation: {
            ok: true,
            ...(simulation.unitsConsumed === undefined ? {} : { unitsConsumed: simulation.unitsConsumed }),
          },
          kmsRequested: true,
          kmsKeyVersion: signed.keyVersion,
          transactionSignature,
          submittedAt,
          outputTokenAccount: this.options.destinationTokenAccount,
          beforeOutputBalanceAtomic: before.amountAtomic,
          expectedOutputDeltaAtomic: this.options.amountAtomic,
          confirmedAt,
          commitment: confirmation.commitment,
          reconciliation: {
            beforeBalance: before.amountAtomic,
            afterBalance: after.amountAtomic,
            expectedDelta: expectedDelta.toString(),
            actualDelta: actualDelta.toString(),
            status: reconciliationStatus,
          },
        },
      };
      const saved = await this.repository.savePolicyEvaluation(completed, "EXECUTING");
      return saved === "SAVED" ? { status: "RECONCILED", proposal: completed } : { status: "CONFLICT" };
    } catch (error) {
      const failed: Proposal = {
        ...proposal,
        status: "FAILED",
        execution: {
          ...proposal.execution,
          mode: "demo",
          kmsRequested: proposal.execution?.kmsRequested ?? false,
          failure: {
            code: "DEVNET_PAYMENT_FAILED",
            message: error instanceof Error ? error.message : "Devnet payment failed.",
            observedAt: this.now().toISOString(),
          },
        },
      };
      const saved = await this.repository.savePolicyEvaluation(failed, "EXECUTING");
      return saved === "SAVED" ? { status: "FAILED", proposal: failed } : { status: "CONFLICT" };
    }
  }
}
