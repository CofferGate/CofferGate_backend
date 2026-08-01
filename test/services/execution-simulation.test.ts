import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionSimulationService } from "../../src/services/execution-simulation.js";

function createService(result: unknown) {
  return new ExecutionSimulationService(
    { async simulateTransaction() { return result as never; } },
    { computeUnitMarginBps: 2_000, maxComputeUnits: 1_400_000 },
  );
}

test("execution simulation adds a bounded compute margin", async () => {
  assert.deepEqual(
    await createService({ ok: true, slot: 1, unitsConsumed: 200_000, logs: [] })
      .simulate(Buffer.from([1]), 1),
    {
      status: "PASSED",
      simulation: { ok: true, unitsConsumed: 200_000 },
      computeUnitLimit: 240_000,
    },
  );
});

test("execution simulation preserves program failures", async () => {
  const result = await createService({
    ok: false,
    slot: 1,
    error: { InstructionError: [2, { Custom: 6001 }] },
    unitsConsumed: 201_234,
    logs: [],
  }).simulate(Buffer.from([1]));
  assert.equal(result.status, "FAILED");
  assert.equal(result.simulation.ok, false);
  assert.match(result.simulation.error ?? "", /InstructionError/);
});

test("execution simulation blocks missing and excessive compute usage", async () => {
  assert.equal(
    (await createService({ ok: true, slot: 1, logs: [] }).simulate(Buffer.from([1]))).status,
    "INVALID_RESULT",
  );
  assert.equal(
    (await createService({ ok: true, slot: 1, unitsConsumed: 1_200_000, logs: [] })
      .simulate(Buffer.from([1]))).status,
    "COMPUTE_LIMIT_EXCEEDED",
  );
});
