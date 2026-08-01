import type { ExecutionSummary, Proposal } from "../contracts/index.js";
import { encodeBase58 } from "../encoding/base58.js";
import type { JupiterQuote, JupiterQuoteRequest } from "../providers/jupiter-quote.js";
import type { SignedSolanaTransaction } from "../providers/cloud-kms-signer.js";
import type { UnsignedJupiterSwapTransaction } from "../providers/jupiter-swap.js";
import type { ExecutionIntent, ExecutionSubmissionRepository } from "../repositories/execution-submission-repository.js";
import type { ProposalRepository } from "../repositories/proposal-repository.js";
import type { PolicyRepository } from "../repositories/policy-repository.js";
import type { ExecutionSimulationService } from "./execution-simulation.js";

interface QuoteProvider { getExactInQuote(request: JupiterQuoteRequest): Promise<JupiterQuote> }
interface SwapProvider { createUnsignedTransaction(quote: JupiterQuote): Promise<UnsignedJupiterSwapTransaction> }
interface TransactionSigner { signTransaction(transaction: Buffer): Promise<SignedSolanaTransaction> }
interface TransactionSubmitter { sendTransaction(transaction: Buffer, options?: { minContextSlot?: number }): Promise<string> }
interface BlockHeightProvider { getBlockHeight(minContextSlot?: number): Promise<number> }
interface BalanceProvider { getTokenBalance(account: string): Promise<{ amountAtomic: string }> }
interface ConfirmationScheduler { schedule(proposalId: string): Promise<unknown> }
interface ProgramAllowlistValidator { validate(transaction: Buffer, allowedPrograms: readonly string[]): unknown }

export type ExecutionSubmissionResult =
  | { status: "SUBMITTED"; signature: string }
  | { status: "NOT_FOUND" | "NOT_EXECUTABLE" | "POLICY_REJECTED" | "PROGRAM_REJECTED" | "SIMULATION_FAILED" | "INTENT_EXPIRED" | "CONFLICT" };

export interface ExecutionSubmissionWorkflowDependencies {
  proposalRepository: ProposalRepository;
  policyRepository: PolicyRepository;
  submissionRepository: ExecutionSubmissionRepository;
  quoteProvider: QuoteProvider;
  swapProvider: SwapProvider;
  simulationService: ExecutionSimulationService;
  signer: TransactionSigner;
  submitter: TransactionSubmitter;
  blockHeightProvider: BlockHeightProvider;
  balanceProvider: BalanceProvider;
  confirmationScheduler: ConfirmationScheduler;
  programAllowlistValidator: ProgramAllowlistValidator;
  outputTokenAccount: string;
  now?: () => Date;
}

export class ExecutionSubmissionWorkflow {
  constructor(private readonly dependencies: ExecutionSubmissionWorkflowDependencies) {}

  async execute(proposalId: string): Promise<ExecutionSubmissionResult> {
    const proposal = await this.dependencies.proposalRepository.findById(proposalId);
    if (!proposal) return { status: "NOT_FOUND" };
    if (proposal.status === "EXECUTING") {
      const intent = await this.dependencies.submissionRepository.findPrepared(proposalId);
      return intent ? this.submitPrepared(intent) : { status: "CONFLICT" };
    }
    if (!this.isExecutable(proposal)) return { status: "NOT_EXECUTABLE" };
    const now = this.dependencies.now?.() ?? new Date();
    const policy = await this.dependencies.policyRepository.getCurrent();
    if (
      !policy ||
      policy.policyVersion !== proposal.policyVersion ||
      policy.circuitBreakerStatus !== "ACTIVE" ||
      Date.parse(proposal.expiresAt) <= now.getTime()
    ) {
      return { status: "POLICY_REJECTED" };
    }

    const quote = await this.dependencies.quoteProvider.getExactInQuote({
      inputMint: proposal.inputMint,
      outputMint: proposal.outputMint,
      amountAtomic: proposal.amountAtomic,
      slippageBps: policy.maxSlippageBps,
    });
    if (quote.priceImpactBps > policy.maxPriceImpactBps) {
      return { status: "POLICY_REJECTED" };
    }
    const unsigned = await this.dependencies.swapProvider.createUnsignedTransaction(quote);
    try {
      this.dependencies.programAllowlistValidator.validate(
        unsigned.serializedTransaction,
        policy.allowedPrograms,
      );
    } catch {
      return { status: "PROGRAM_REJECTED" };
    }
    const simulation = await this.dependencies.simulationService.simulate(
      unsigned.serializedTransaction,
      quote.contextSlot,
    );
    if (simulation.status !== "PASSED") return { status: "SIMULATION_FAILED" };
    const beforeBalance = await this.dependencies.balanceProvider.getTokenBalance(
      this.dependencies.outputTokenAccount,
    );
    const execution: ExecutionSummary = {
      routeLabel: quote.routeLabel,
      expectedInputAmount: quote.inputAmountAtomic,
      expectedOutputAmount: quote.expectedOutputAmountAtomic,
      minimumOutputAmount: quote.minimumOutputAmountAtomic,
      slippageBps: quote.slippageBps,
      priceImpactBps: quote.priceImpactBps,
      simulation: simulation.simulation,
      computeUnits: simulation.computeUnitLimit,
      kmsRequested: true,
      outputTokenAccount: this.dependencies.outputTokenAccount,
      beforeOutputBalanceAtomic: beforeBalance.amountAtomic,
      expectedOutputDeltaAtomic: quote.expectedOutputAmountAtomic,
    };
    const signed = await this.dependencies.signer.signTransaction(unsigned.serializedTransaction);
    const prepared = await this.dependencies.submissionRepository.prepare(proposalId, {
      proposalId,
      serializedTransactionBase64: signed.serializedTransaction.toString("base64"),
      transactionSignature: encodeBase58(signed.signature),
      minContextSlot: quote.contextSlot,
      lastValidBlockHeight: unsigned.lastValidBlockHeight,
      execution: {
        ...execution,
        kmsKeyVersion: signed.kmsKeyVersion,
      },
      preparedAt: now.toISOString(),
    });
    if (!("intent" in prepared)) {
      return { status: "CONFLICT" };
    }
    return this.submitPrepared(prepared.intent);
  }

  private async submitPrepared(intent: ExecutionIntent): Promise<ExecutionSubmissionResult> {
    const currentBlockHeight = await this.dependencies.blockHeightProvider.getBlockHeight(
      intent.minContextSlot,
    );
    if (currentBlockHeight > intent.lastValidBlockHeight) {
      const expired = await this.dependencies.submissionRepository.expire(
        intent.proposalId,
        intent.transactionSignature,
        (this.dependencies.now?.() ?? new Date()).toISOString(),
      );
      return expired === "EXPIRED"
        ? { status: "INTENT_EXPIRED" }
        : { status: "CONFLICT" };
    }
    const serializedTransaction = Buffer.from(intent.serializedTransactionBase64, "base64");
    const signature = await this.dependencies.submitter.sendTransaction(
      serializedTransaction,
      { minContextSlot: intent.minContextSlot },
    );
    if (signature !== intent.transactionSignature) return { status: "CONFLICT" };
    const submittedExecution: ExecutionSummary = {
      ...intent.execution,
      kmsRequested: true,
      transactionSignature: signature,
      submittedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
    };
    const saved = await this.dependencies.submissionRepository.markSubmitted(
      intent.proposalId,
      submittedExecution,
    );
    if (saved !== "SUBMITTED" && saved !== "ALREADY_SUBMITTED") {
      return { status: "CONFLICT" };
    }
    await this.dependencies.confirmationScheduler.schedule(intent.proposalId);
    return { status: "SUBMITTED", signature };
  }

  private isExecutable(proposal: Proposal): proposal is Proposal & {
    inputMint: string; outputMint: string; amountAtomic: string;
  } {
    return proposal.status === "POLICY_APPROVED" && proposal.decision === "AUTO" &&
      proposal.action === "SWAP" && Boolean(proposal.inputMint && proposal.outputMint && proposal.amountAtomic);
  }
}
