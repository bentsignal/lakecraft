import assert from "node:assert/strict";

export function timingBudget(referenceMs, profile = process.env.LAKECRAFT_TEST_TIMING_PROFILE ?? "reference") {
  assert.ok(Number.isFinite(referenceMs) && referenceMs > 0, "Timing budgets must be finite and positive.");
  assert.ok(["reference", "shared-runner"].includes(profile), "Unknown test timing profile.");
  return referenceMs * (profile === "shared-runner" ? 2 : 1);
}

export function assertTimingBudget(elapsedMs, referenceMs, label, profile = process.env.LAKECRAFT_TEST_TIMING_PROFILE ?? "reference") {
  const maximumMs = timingBudget(referenceMs, profile);
  assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0, "Timing samples must be finite and nonnegative.");
  console.log(JSON.stringify({ benchmark: label, elapsedMs, referenceMs, maximumMs, profile }));
  assert.ok(elapsedMs < maximumMs, `${label} took ${elapsedMs.toFixed(1)}ms (${profile} budget: ${maximumMs}ms)`);
}
