import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signatureBytes,
  type Transaction,
} from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token";

export interface DevnetTokenPaymentInput {
  signerAddress: string;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  mintAddress: string;
  amountAtomic: string;
  decimals: number;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface PreparedDevnetTokenPayment {
  transaction: Transaction;
  message: Buffer;
  unsignedTransaction: Buffer;
}

export function buildDevnetTokenPayment(
  input: DevnetTokenPaymentInput,
): PreparedDevnetTokenPayment {
  if (!/^\d+$/.test(input.amountAtomic) || BigInt(input.amountAtomic) <= 0n) {
    throw new Error("Devnet payment amount must be a positive atomic amount.");
  }
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 18) {
    throw new Error("Devnet payment decimals are invalid.");
  }
  if (!Number.isSafeInteger(input.lastValidBlockHeight) || input.lastValidBlockHeight <= 0) {
    throw new Error("Devnet payment block height is invalid.");
  }

  const signerAddress = address(input.signerAddress);
  const transfer = getTransferCheckedInstruction({
    source: address(input.sourceTokenAccount),
    mint: address(input.mintAddress),
    destination: address(input.destinationTokenAccount),
    authority: signerAddress,
    amount: BigInt(input.amountAtomic),
    decimals: input.decimals,
  });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) =>
      setTransactionMessageFeePayer(signerAddress, transactionMessage),
    (transactionMessage) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash(input.recentBlockhash),
          lastValidBlockHeight: BigInt(input.lastValidBlockHeight),
        },
        transactionMessage,
      ),
    (transactionMessage) =>
      appendTransactionMessageInstruction(transfer, transactionMessage),
  );
  const transaction = compileTransaction(message);
  const requiredSigners = Object.keys(transaction.signatures);
  if (requiredSigners.length !== 1 || requiredSigners[0] !== input.signerAddress) {
    throw new Error("Devnet payment must require exactly the configured KMS signer.");
  }

  return {
    transaction,
    message: Buffer.from(transaction.messageBytes),
    unsignedTransaction: Buffer.from(getTransactionEncoder().encode(transaction)),
  };
}

export function attachDevnetTokenPaymentSignature(
  transaction: Transaction,
  signerAddress: string,
  signature: Buffer,
): Buffer {
  const requiredSigners = Object.keys(transaction.signatures);
  if (requiredSigners.length !== 1 || requiredSigners[0] !== signerAddress) {
    throw new Error("Devnet payment signer does not match the transaction.");
  }
  if (signature.length !== 64) {
    throw new Error("Devnet payment signature must be 64 bytes.");
  }
  const signedTransaction: Transaction = {
    ...transaction,
    signatures: {
      ...transaction.signatures,
      [signerAddress]: signatureBytes(signature),
    },
  };
  return Buffer.from(getTransactionEncoder().encode(signedTransaction));
}

export function decodeSolanaAddress(value: string): Buffer {
  return Buffer.from(getAddressEncoder().encode(address(value)));
}
