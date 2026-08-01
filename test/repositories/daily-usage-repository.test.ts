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
