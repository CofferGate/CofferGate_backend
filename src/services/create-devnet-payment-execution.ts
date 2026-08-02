import type { AppConfig } from "../config.js";
import { CloudKmsTransactionSigner } from "../providers/cloud-kms-transaction-signer.js";
import { SolanaRpcProvider } from "../providers/solana-rpc.js";
import type { DevnetPaymentExecutionRepository, ProposalRepository } from "../repositories/proposal-repository.js";
import { DevnetPaymentExecutionService } from "./devnet-payment-execution.js";

export function createDevnetPaymentExecutionService(
  config: AppConfig,
  repository: ProposalRepository & DevnetPaymentExecutionRepository,
): DevnetPaymentExecutionService {
  if (!config.CLOUD_KMS_KEY_VERSION || !config.USDC_MINT || !config.USDC_TOKEN_ACCOUNT ||
    !config.DEVNET_PAYMENT_DESTINATION_TOKEN_ACCOUNT || !config.DEVNET_PAYMENT_AMOUNT_ATOMIC ||
    config.OPERATIONS_WALLET_ADDRESS === "unconfigured") {
    throw new Error("Devnet payment execution configuration is incomplete.");
  }
  return new DevnetPaymentExecutionService(
    repository,
    new SolanaRpcProvider({ endpoint: config.SOLANA_RPC_URL, timeoutMs: config.SOLANA_RPC_TIMEOUT_MS }),
    new CloudKmsTransactionSigner(config.CLOUD_KMS_KEY_VERSION, config.OPERATIONS_WALLET_ADDRESS),
    {
      signerAddress: config.OPERATIONS_WALLET_ADDRESS,
      sourceTokenAccount: config.USDC_TOKEN_ACCOUNT,
      destinationTokenAccount: config.DEVNET_PAYMENT_DESTINATION_TOKEN_ACCOUNT,
      mintAddress: config.USDC_MINT,
      amountAtomic: config.DEVNET_PAYMENT_AMOUNT_ATOMIC,
      decimals: config.DEVNET_PAYMENT_DECIMALS,
    },
  );
}
