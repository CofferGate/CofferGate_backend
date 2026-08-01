import { z } from "zod";
import type { TreasurySnapshotProvider } from "../services/proposal-generation-context.js";
import type {
  SolanaNativeBalance,
  SolanaTokenBalance,
} from "./solana-rpc.js";

interface TreasurySolanaRpc {
  getNativeBalance(walletAddress: string): Promise<SolanaNativeBalance>;
  getTokenBalance(tokenAccount: string): Promise<SolanaTokenBalance>;
}

const optionsSchema = z.object({
  walletAddress: z.string().min(1),
  usdcTokenAccount: z.string().min(1),
  solMint: z.string().min(1),
  usdcMint: z.string().min(1),
  targetUsdcBalance: z.string().regex(/^\d+(?:\.\d+)?$/),
});

export interface SolanaTreasurySnapshotProviderOptions {
  rpc: TreasurySolanaRpc;
  walletAddress: string;
  usdcTokenAccount: string;
  solMint: string;
  usdcMint: string;
  targetUsdcBalance: string;
  now?: () => Date;
}

export class SolanaTreasurySnapshotProvider
  implements TreasurySnapshotProvider
{
  private readonly validatedOptions: z.infer<typeof optionsSchema>;

  constructor(private readonly options: SolanaTreasurySnapshotProviderOptions) {
    this.validatedOptions = optionsSchema.parse(options);
  }

  async getSnapshot() {
    const [solBalance, usdcBalance] = await Promise.all([
      this.options.rpc.getNativeBalance(this.validatedOptions.walletAddress),
      this.options.rpc.getTokenBalance(this.validatedOptions.usdcTokenAccount),
    ]);
    const observedAt = (this.options.now ?? (() => new Date()))().toISOString();

    return {
      solBalance: formatAtomicAmount(solBalance.amountAtomic, solBalance.decimals),
      usdcBalance: formatAtomicAmount(
        usdcBalance.amountAtomic,
        usdcBalance.decimals,
      ),
      targetUsdcBalance: this.validatedOptions.targetUsdcBalance,
      assetMints: {
        SOL: this.validatedOptions.solMint,
        USDC: this.validatedOptions.usdcMint,
      },
      observedAt,
      evidenceRefs: [
        {
          id: `sol-balance:${this.validatedOptions.walletAddress}:${observedAt}`,
          label: "Operations wallet SOL balance",
          sourceType: "ONCHAIN_BALANCE" as const,
          observedAt,
        },
        {
          id: `usdc-balance:${this.validatedOptions.usdcTokenAccount}:${observedAt}`,
          label: "Operations wallet USDC balance",
          sourceType: "ONCHAIN_BALANCE" as const,
          observedAt,
        },
      ],
    };
  }
}

export function formatAtomicAmount(amountAtomic: string, decimals: number): string {
  if (!/^\d+$/.test(amountAtomic) || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Atomic amount and decimals must be nonnegative integers.");
  }
  const padded = amountAtomic.padStart(decimals + 1, "0");
  if (decimals === 0) return padded;
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
