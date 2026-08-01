import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryDailyUsageRepository } from "../../src/repositories/daily-usage-repository.js";

test("in-memory daily usage returns configured usage or zero", async () => {
  const repository = new InMemoryDailyUsageRepository(
    new Map([["2026-08-01", 12.5]]),
  );

  assert.equal(await repository.getUsageUsd("2026-08-01"), 12.5);
  assert.equal(await repository.getUsageUsd("2026-08-02"), 0);
});

test("in-memory daily usage rejects negative values", async () => {
  const repository = new InMemoryDailyUsageRepository(
    new Map([["2026-08-01", -1]]),
  );

  await assert.rejects(() => repository.getUsageUsd("2026-08-01"));
});

test("in-memory daily usage records each execution once", async () => {
  const repository = new InMemoryDailyUsageRepository();
  const entry = {
    executionId: "execution_01",
    date: "2026-08-01",
    amountUsd: 4.83,
    recordedAt: "2026-08-01T06:00:00.000Z",
  };

  assert.equal(await repository.recordConfirmedExecution(entry), "RECORDED");
  assert.equal(
    await repository.recordConfirmedExecution({
      ...entry,
      recordedAt: "2026-08-01T06:01:00.000Z",
    }),
    "ALREADY_RECORDED",
  );
  assert.equal(await repository.getUsageUsd(entry.date), entry.amountUsd);
});

test("in-memory daily usage rejects idempotency conflicts", async () => {
  const repository = new InMemoryDailyUsageRepository();
  const entry = {
    executionId: "execution_01",
    date: "2026-08-01",
    amountUsd: 4.83,
    recordedAt: "2026-08-01T06:00:00.000Z",
  };
  await repository.recordConfirmedExecution(entry);

  assert.equal(
    await repository.recordConfirmedExecution({ ...entry, amountUsd: 5 }),
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(await repository.getUsageUsd(entry.date), entry.amountUsd);
});

test("in-memory daily usage handles concurrent duplicate requests", async () => {
  const repository = new InMemoryDailyUsageRepository();
  const entry = {
    executionId: "execution_01",
    date: "2026-08-01",
    amountUsd: 4.83,
    recordedAt: "2026-08-01T06:00:00.000Z",
  };

  assert.deepEqual(
    await Promise.all([
      repository.recordConfirmedExecution(entry),
      repository.recordConfirmedExecution(entry),
    ]),
    ["RECORDED", "ALREADY_RECORDED"],
  );
  assert.equal(await repository.getUsageUsd(entry.date), entry.amountUsd);
});
