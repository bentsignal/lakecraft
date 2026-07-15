import assert from "node:assert/strict";
import {
  activityHalfUnitsForDisplacement,
  advanceAuthoritativeSurvival,
  type StoredSurvivalProgress,
} from "../shared/survivalAuthority.ts";

const progress = (overrides: Partial<StoredSurvivalProgress> = {}): StoredSurvivalProgress => ({
  survivalAt: "1000",
  hungerProgressHalfMs: "0",
  recoveryProgressMs: "0",
  starvationProgressMs: "0",
  ...overrides,
});

assert.equal(activityHalfUnitsForDisplacement({ x: 0, y: 8, z: 0 }, { x: 0, y: 8, z: 0 }, 200), 1);
assert.equal(activityHalfUnitsForDisplacement({ x: 0, y: 8, z: 0 }, { x: 1.3, y: 8, z: 0 }, 1_000), 2);
assert.equal(activityHalfUnitsForDisplacement({ x: 0, y: 8, z: 0 }, { x: 4.35, y: 8, z: 0 }, 1_000), 4);
assert.equal(activityHalfUnitsForDisplacement({ x: 0, y: 8, z: 0 }, { x: 5.6, y: 8, z: 0 }, 1_000), 6);
assert.equal(activityHalfUnitsForDisplacement({ x: 0, y: 8, z: 0 }, { x: 0, y: 1, z: 0 }, 1_000), 4, "falling is never charged as sprinting");

const passive = advanceAuthoritativeSurvival({
  hunger: 20,
  health: 20,
  revision: 5,
  progress: progress({ hungerProgressHalfMs: "89999" }),
  serverNow: 1001,
  activityHalfUnits: 1,
});
assert.equal(passive.hunger, 19);
assert.equal(passive.health, 20);
assert.equal(passive.revision, 5);
assert.equal(passive.progress.hungerProgressHalfMs, "0");

const recovered = advanceAuthoritativeSurvival({
  hunger: 20,
  health: 18,
  revision: 5,
  progress: progress({ recoveryProgressMs: "3000" }),
  serverNow: 2000,
  activityHalfUnits: 1,
});
assert.deepEqual([recovered.hunger, recovered.health, recovered.revision], [19, 19, 6]);

const hungerBoundary = advanceAuthoritativeSurvival({
  hunger: 18,
  health: 18,
  revision: 2,
  progress: progress({ hungerProgressHalfMs: "89999", recoveryProgressMs: "3999" }),
  serverNow: 1001,
  activityHalfUnits: 1,
});
assert.deepEqual([hungerBoundary.hunger, hungerBoundary.health, hungerBoundary.progress.recoveryProgressMs], [17, 18, "0"]);

const starved = advanceAuthoritativeSurvival({
  hunger: 0,
  health: 3,
  revision: 8,
  progress: progress({ starvationProgressMs: "3000" }),
  serverNow: 2000,
  activityHalfUnits: 1,
});
assert.deepEqual([starved.health, starved.revision, starved.starvationDamage], [2, 9, 1]);
const floor = advanceAuthoritativeSurvival({ ...starved, progress: starved.progress, serverNow: 6000, activityHalfUnits: 1 });
assert.equal(floor.health, 1);
assert.equal(advanceAuthoritativeSurvival({ ...floor, progress: floor.progress, serverNow: 10_000, activityHalfUnits: 1 }).revision, floor.revision);

const dead = advanceAuthoritativeSurvival({
  hunger: 0,
  health: 0,
  revision: 12,
  progress: progress({ starvationProgressMs: "3999" }),
  serverNow: 5000,
  activityHalfUnits: 6,
});
assert.deepEqual([dead.health, dead.revision, dead.progress.starvationProgressMs], [0, 12, "0"]);

const capped = advanceAuthoritativeSurvival({
  hunger: 20,
  health: 20,
  revision: 0,
  progress: progress(),
  serverNow: 1_000_000,
  activityHalfUnits: 6,
});
assert.deepEqual([capped.hunger, capped.progress.hungerProgressHalfMs], [14, "0"], "a sparse 90-second active lease advances fully");

const exhausted = advanceAuthoritativeSurvival({
  hunger: 20,
  health: 18,
  revision: Number.MAX_SAFE_INTEGER,
  progress: progress({ recoveryProgressMs: "3999" }),
  serverNow: 1001,
  activityHalfUnits: 1,
});
assert.equal(exhausted.revisionExhausted, true);
assert.deepEqual([exhausted.hunger, exhausted.health, exhausted.revision], [20, 18, Number.MAX_SAFE_INTEGER]);

const reachesEmptyAtLeaseEnd = advanceAuthoritativeSurvival({
  hunger: 1,
  health: 3,
  revision: 4,
  progress: progress(),
  serverNow: 91_000,
  activityHalfUnits: 1,
});
assert.deepEqual(
  [reachesEmptyAtLeaseEnd.hunger, reachesEmptyAtLeaseEnd.health, reachesEmptyAtLeaseEnd.starvationDamage],
  [0, 3, 0],
  "time before hunger reaches zero is not double-counted as starvation time",
);

// A combat mutation snapshots survival at the hit timestamp. A hit one second
// before the next sparse heartbeat therefore receives only one second of
// recovery time, never the preceding 89 seconds during which health was full.
const beforeLateHit = advanceAuthoritativeSurvival({
  hunger: 20,
  health: 20,
  revision: 0,
  progress: progress(),
  serverNow: 90_000,
  activityHalfUnits: 1,
});
const afterLateHit = advanceAuthoritativeSurvival({
  hunger: beforeLateHit.hunger,
  health: 18,
  revision: beforeLateHit.revision + 1,
  progress: beforeLateHit.progress,
  serverNow: 91_000,
  activityHalfUnits: 1,
});
assert.equal(afterLateHit.health, 18, "late combat damage is not retroactively regenerated");
assert.equal(afterLateHit.progress.recoveryProgressMs, "1000");

console.log("authoritative survival reducer tests passed");
