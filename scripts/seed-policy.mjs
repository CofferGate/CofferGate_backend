import { Firestore } from "@google-cloud/firestore";

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error("GOOGLE_CLOUD_PROJECT is required.");
  process.exit(1);
}

const operationsWalletAddress = process.env.OPERATIONS_WALLET_ADDRESS;
if (!operationsWalletAddress) {
  console.error("OPERATIONS_WALLET_ADDRESS is required.");
  process.exit(1);
}

const solMint =
  process.env.SOL_MINT ?? "So11111111111111111111111111111111111111112";
const usdcMint = process.env.USDC_MINT;
if (!usdcMint) {
  console.error("USDC_MINT is required.");
  process.exit(1);
}

const collectionName = process.env.FIRESTORE_POLICIES_COLLECTION ?? "policies";
const documentId = process.env.FIRESTORE_CURRENT_POLICY_DOCUMENT ?? "current";
const databaseId = process.env.FIRESTORE_DATABASE_ID ?? "(default)";
const policyVersion =
  process.env.POLICY_VERSION ??
  `policy_${new Date().toISOString().slice(0, 10).replaceAll("-", "_")}_01`;

const policy = {
  policyVersion,
  effectiveFrom: new Date().toISOString(),
  allowedInputMints: [solMint, usdcMint],
  allowedOutputMints: [solMint, usdcMint],
  allowedAssets: ["SOL", "USDC"],
  maxTransactionUsd: 5,
  dailyLimitUsd: 20,
  minimumReserve: { amount: 0, asset: "SOL" },
  maxSlippageBps: 50,
  maxPriceImpactBps: 100,
  quoteMaxAgeSeconds: 15,
  allowedPrograms: [],
  allowedSigners: [operationsWalletAddress],
  simulationRequired: true,
  circuitBreakerParameters: null,
  circuitBreakerStatus: "ACTIVE",
};

const firestore = new Firestore({ projectId, databaseId });

await firestore.collection(collectionName).doc(documentId).set(policy);

console.log(
  `Seeded ${collectionName}/${documentId} in project ${projectId} (database ${databaseId}).`,
);
console.log(JSON.stringify(policy, null, 2));
