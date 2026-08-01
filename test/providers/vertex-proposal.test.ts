import assert from "node:assert/strict";
import test from "node:test";
import { VertexProposalProvider } from "../../src/providers/vertex-proposal.js";

const input = {
  proposalId: "proposal_01",
  policyVersion: "policy-2026.08.1",
  dataAsOf: "2026-08-01T06:00:00.000Z",
  expiresAt: "2026-08-01T06:05:00.000Z",
  solBalance: "1.25",
  usdcBalance: "10.00",
  targetUsdcBalance: "15.00",
  solPriceUsd: 200,
  assetMints: { SOL: "trusted-sol-mint", USDC: "trusted-usdc-mint" },
  evidenceRefs: [
    {
      id: "balance_01",
      label: "Operations balance",
      sourceType: "ONCHAIN_BALANCE" as const,
      observedAt: "2026-08-01T06:00:00.000Z",
    },
  ],
};

function createProvider(text: string | undefined, capture?: (request: unknown) => void) {
  return new VertexProposalProvider({
    projectId: "project",
    location: "us-central1",
    model: "gemini-2.5-flash",
    client: {
      models: {
        async generateContent(request) {
          capture?.(request);
          return { text };
        },
      },
    },
  });
}

test("Vertex provider builds reviewed swap with trusted metadata", async () => {
  let captured: unknown;
  const provider = createProvider(
    JSON.stringify({
      action: "SWAP",
      inputSymbol: "SOL",
      outputSymbol: "USDC",
      amountUsd: 4.83,
      rationale: "Restore the USDC balance.",
      confidence: 0.91,
      proposalId: "untrusted-id",
      inputMint: "untrusted-mint",
    }),
    (request) => {
      captured = request;
    },
  );

  const proposal = await provider.generate(input);

  assert.equal(proposal.proposalId, input.proposalId);
  assert.equal(proposal.policyVersion, input.policyVersion);
  assert.equal(proposal.inputMint, "trusted-sol-mint");
  assert.equal(proposal.outputMint, "trusted-usdc-mint");
  assert.equal(proposal.status, "AI_REVIEWED");
  assert.equal(proposal.decision, undefined);
  assert.deepEqual(proposal.ruleChecks, []);
  const request = captured as { config: { responseMimeType: string; responseJsonSchema: unknown } };
  assert.equal(request.config.responseMimeType, "application/json");
  assert.ok(request.config.responseJsonSchema);
});

test("Vertex provider creates NO_ACTION without swap fields", async () => {
  const proposal = await createProvider(
    JSON.stringify({
      action: "NO_ACTION",
      rationale: "Balance is already sufficient.",
      confidence: 0.95,
    }),
  ).generate(input);

  assert.equal(proposal.action, "NO_ACTION");
  assert.equal(proposal.inputMint, undefined);
  assert.equal(proposal.amountUsd, undefined);
});

test("Vertex provider rejects incomplete, malformed, and empty output", async () => {
  await assert.rejects(() =>
    createProvider(
      JSON.stringify({ action: "SWAP", rationale: "trade", confidence: 0.9 }),
    ).generate(input),
  );
  await assert.rejects(() => createProvider("not-json").generate(input));
  await assert.rejects(
    () => createProvider(undefined).generate(input),
    /no proposal content/,
  );
});

test("Vertex provider rejects untrusted generation input", async () => {
  await assert.rejects(() =>
    createProvider(
      JSON.stringify({
        action: "NO_ACTION",
        rationale: "No action.",
        confidence: 1,
      }),
    ).generate({ ...input, solBalance: "not-a-balance" }),
  );
});
