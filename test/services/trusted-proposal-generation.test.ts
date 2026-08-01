import assert from "node:assert/strict";
import test from "node:test";
import { TrustedProposalGenerationService } from "../../src/services/trusted-proposal-generation.js";

test("trusted generation forwards only server-built context", async () => {
  const input = { proposalId: "proposal_01" } as never;
  let received: unknown;
  const service = new TrustedProposalGenerationService(
    { async build() { return { status: "READY", input }; } },
    { async generateAndEvaluate(value) {
      received = value;
      return { status: "ID_CONFLICT" };
    } },
  );

  assert.deepEqual(await service.generate("proposal_01"), {
    status: "ID_CONFLICT",
  });
  assert.equal(received, input);
});

test("trusted generation stops when policy is unconfigured", async () => {
  let generationCalls = 0;
  const service = new TrustedProposalGenerationService(
    { async build() { return { status: "POLICY_NOT_CONFIGURED" }; } },
    { async generateAndEvaluate() {
      generationCalls += 1;
      return { status: "ID_CONFLICT" };
    } },
  );

  assert.deepEqual(await service.generate("proposal_01"), {
    status: "POLICY_NOT_CONFIGURED",
  });
  assert.equal(generationCalls, 0);
});
