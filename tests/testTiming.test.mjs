import assert from "node:assert/strict";
import test from "node:test";
import { assertTimingBudget, timingBudget } from "../scripts/test-timing.mjs";

test("timing profiles preserve reference limits and bound the shared-runner allowance", () => {
  assert.equal(timingBudget(100, "reference"), 100);
  assert.equal(timingBudget(100, "shared-runner"), 200);
  assert.throws(() => timingBudget(100, "unlimited"), /Unknown/);
  assert.throws(() => timingBudget(Infinity, "reference"), /finite/);
  assert.throws(() => assertTimingBudget(101, 100, "fixture", "reference"), /budget: 100ms/);
  assertTimingBudget(101, 100, "fixture", "shared-runner");
  assert.throws(() => assertTimingBudget(200, 100, "fixture", "shared-runner"), /budget: 200ms/);
  assert.throws(() => assertTimingBudget(NaN, 100, "fixture", "shared-runner"), /finite/);
});
