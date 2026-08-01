import type { AppConfig } from "../config.js";
import { SolanaRpcProvider } from "../providers/solana-rpc.js";
import { formatAtomicAmount } from "../providers/solana-treasury.js";
import type { DailyUsageRepository } from "../repositories/daily-usage-repository.js";
import type { PolicyRepository } from "../repositories/policy-repository.js";
import {
  DashboardSnapshotService,
  type OperationsWalletState,
  type OperationsWalletStateProvider,
} from "./dashboard-snapshot.js";

function todayDateKey(now: () => Date = () => new Date()): string {
  return now().toISOString().slice(0, 10);
}

function reportWalletStateFailure(error: unknown): void {
  console.error(
    JSON.stringify({
      event: "dashboard.wallet_state.failed",
      error: error instanceof Error ? error.message : "Unknown wallet state error.",
    }),
  );
}

export function createLiveWalletStateProvider(
  config: AppConfig,
  dailyUsageRepository: DailyUsageRepository,
): OperationsWalletStateProvider {
  const rpc = new SolanaRpcProvider({
    endpoint: config.SOLANA_RPC_URL,
    timeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
  });

  return {
    async getState(): Promise<OperationsWalletState> {
      const address = config.OPERATIONS_WALLET_ADDRESS;
      if (address === "unconfigured" || !config.USDC_TOKEN_ACCOUNT) {
        return { address };
      }

      try {
        const [solBalance, usdcBalance, dailyUsageUsd] = await Promise.all([
          rpc.getNativeBalance(address),
          rpc.getTokenBalance(config.USDC_TOKEN_ACCOUNT),
          dailyUsageRepository.getUsageUsd(todayDateKey()),
        ]);

        return {
          address,
          solBalance: formatAtomicAmount(solBalance.amountAtomic, solBalance.decimals),
          usdcBalance: formatAtomicAmount(usdcBalance.amountAtomic, usdcBalance.decimals),
          ...(config.TARGET_USDC_BALANCE
            ? { targetUsdcBalance: config.TARGET_USDC_BALANCE }
            : {}),
          dailyUsageUsd,
          lastSyncedAt: new Date().toISOString(),
        };
      } catch (error) {
        reportWalletStateFailure(error);
        return { address };
      }
    },
  };
}

export function createDashboardSnapshotService(
  config: AppConfig,
  policyRepository: PolicyRepository,
  dailyUsageRepository: DailyUsageRepository,
): DashboardSnapshotService {
  return new DashboardSnapshotService({
    dataMode: config.DATA_MODE,
    policyRepository,
    walletStateProvider: createLiveWalletStateProvider(config, dailyUsageRepository),
  });
}
