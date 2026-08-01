import {
  consoleSnapshotSchema,
  type ApiMeta,
  type ConsoleSnapshot,
} from "../contracts/index.js";
import type { PolicyRepository } from "../repositories/policy-repository.js";

export interface OperationsWalletState {
  address: string;
  solBalance?: string;
  usdcBalance?: string;
  targetUsdcBalance?: string;
  dailyUsageUsd?: number;
  lastSyncedAt?: string;
}

export interface OperationsWalletStateProvider {
  getState(): Promise<OperationsWalletState>;
}

export interface DashboardSnapshotServiceOptions {
  dataMode: "mock" | "live";
  policyRepository: PolicyRepository;
  walletStateProvider: OperationsWalletStateProvider;
}

export class DashboardSnapshotService {
  private readonly dataMode: "mock" | "live";
  private readonly policyRepository: PolicyRepository;
  private readonly walletStateProvider: OperationsWalletStateProvider;

  constructor(options: DashboardSnapshotServiceOptions) {
    this.dataMode = options.dataMode;
    this.policyRepository = options.policyRepository;
    this.walletStateProvider = options.walletStateProvider;
  }

  async getSnapshot(meta: ApiMeta): Promise<ConsoleSnapshot> {
    const [policy, walletState] = await Promise.all([
      this.policyRepository.getCurrent(),
      this.walletStateProvider.getState(),
    ]);
    const balances = {
      ...(walletState.solBalance ? { sol: walletState.solBalance } : {}),
      ...(walletState.usdcBalance ? { usdc: walletState.usdcBalance } : {}),
    };
    const snapshot = {
      network: "devnet" as const,
      dataMode: this.dataMode,
      circuitBreaker: policy?.circuitBreakerStatus ?? "HALTED",
      operationsWallet: walletState.address,
      balances,
      ...(walletState.targetUsdcBalance
        ? { targetUsdcBalance: walletState.targetUsdcBalance }
        : {}),
      ...(walletState.dailyUsageUsd !== undefined
        ? { dailyUsageUsd: walletState.dailyUsageUsd }
        : {}),
      ...(policy ? { dailyLimitUsd: policy.dailyLimitUsd } : {}),
      policyVersion: policy?.policyVersion ?? "unconfigured",
      allowedAssets: policy?.allowedAssets ?? [],
      ...(walletState.lastSyncedAt
        ? { lastSyncedAt: walletState.lastSyncedAt }
        : {}),
      meta,
    };

    return consoleSnapshotSchema.parse(snapshot);
  }
}
