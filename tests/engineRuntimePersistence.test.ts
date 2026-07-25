import assert from "node:assert/strict";
import {
  HARD_MAX_MOB_POPULATION,
  createMobSimulation,
  damageMob,
  exportMobSimulationSnapshot,
  restoreMobSimulationSnapshot,
  shearLocalMob,
  stepMobSimulation,
  validateMobSimulationSnapshot,
  type MobKind,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";
import {
  VOXEL_RUNTIME_SNAPSHOT_VERSION,
  advanceVoxelWorldTimeMs,
  validateVoxelRuntimeSnapshot,
} from "../client/game/types.ts";

function spawn(kind: MobKind, id: string, x: number): MobSpawnDescriptor {
  return {
    id,
    kind,
    x,
    y: 1,
    z: 0,
    yaw: 0,
    homeX: x,
    homeZ: 0,
    behaviorSeed: 101 + x,
  };
}

const original = createMobSimulation([
  spawn("sheep", "save-sheep", -4),
  spawn("skeleton", "save-skeleton", 7),
  spawn("creeper", "save-creeper", 2),
]);
for (let tick = 0; tick < 30; tick += 1) {
  stepMobSimulation(original, {
    dtSeconds: 0.1,
    isNight: true,
    terrainHeight: () => 0,
    player: { x: 0, y: 1, z: 0 },
  });
}
assert.equal(shearLocalMob(original, "save-sheep", () => true).ok, true);
assert.equal(damageMob(original, "save-skeleton", 5).remainingHealth, 15);

const encoded = exportMobSimulationSnapshot(original);
const decoded = JSON.parse(JSON.stringify(encoded));
const validated = validateMobSimulationSnapshot(decoded);
assert.ok(validated, "JSON-roundtripped complete mob state must validate");
const restored = createMobSimulation([]);
assert.equal(restoreMobSimulationSnapshot(restored, decoded), true);
assert.deepEqual(restored, original, "restore must preserve position, health, behavior, cooldowns, fuses, shearing, RNG, projectiles, and time");

for (let tick = 0; tick < 20; tick += 1) {
  const input = {
    dtSeconds: 0.1,
    isNight: true,
    terrainHeight: (_x: number, _z: number) => 0,
    player: { x: 0, y: 1, z: 0 },
  };
  stepMobSimulation(original, input);
  stepMobSimulation(restored, input);
}
assert.deepEqual(restored, original, "restored simulation must continue deterministically");

const withUnknownField = structuredClone(decoded);
withUnknownField.extra = true;
assert.equal(validateMobSimulationSnapshot(withUnknownField), null, "unknown snapshot fields are rejected");
const withNaN = structuredClone(decoded);
withNaN.mobs[0].x = Number.NaN;
assert.equal(validateMobSimulationSnapshot(withNaN), null, "non-finite runtime values are rejected");
const withDuplicateId = structuredClone(decoded);
withDuplicateId.mobs[1].id = withDuplicateId.mobs[0].id;
assert.equal(validateMobSimulationSnapshot(withDuplicateId), null, "duplicate mob IDs are rejected");
const withTooManyMobs = structuredClone(decoded);
while (withTooManyMobs.mobs.length <= HARD_MAX_MOB_POPULATION) {
  const next = structuredClone(withTooManyMobs.mobs[0]);
  next.id = `overflow-${withTooManyMobs.mobs.length}`;
  withTooManyMobs.mobs.push(next);
}
assert.equal(validateMobSimulationSnapshot(withTooManyMobs), null, "population cannot exceed the hard 64-mob bound");
const withBadProjectilePool = structuredClone(decoded);
withBadProjectilePool.projectiles.pop();
assert.equal(validateMobSimulationSnapshot(withBadProjectilePool), null, "the deterministic fixed projectile pool is required");
const withUnknownProjectileOwner = structuredClone(decoded);
withUnknownProjectileOwner.projectiles[0].active = true;
withUnknownProjectileOwner.projectiles[0].ownerId = "missing-mob";
assert.equal(validateMobSimulationSnapshot(withUnknownProjectileOwner), null, "active projectiles must belong to a saved mob");

const runtime = {
  version: VOXEL_RUNTIME_SNAPSHOT_VERSION,
  pose: { x: 1.5, y: 8.02, z: -2.5, yaw: 0.4, pitch: -0.2 },
  respawnPoint: { x: 0.5, y: 7.02, z: 0.5, yaw: 0, pitch: -0.08 },
  playerHealth: 13,
  worldTimeMs: 1_750_000_123_456,
  dayNight: { cycleLengthMs: 480_000, epochMs: 0, epochPhase: 0 },
  mobAccumulatorSeconds: 0.04,
  mobSimulation: decoded,
};
const validRuntime = validateVoxelRuntimeSnapshot(runtime);
assert.ok(validRuntime);
assert.deepEqual(validRuntime, runtime);
assert.notEqual(validRuntime.mobSimulation, runtime.mobSimulation, "validation returns a detached engine state");

for (const corrupt of [
  { ...runtime, version: 99 },
  { ...runtime, playerHealth: 21 },
  { ...runtime, worldTimeMs: Infinity },
  { ...runtime, mobAccumulatorSeconds: 0.31 },
  { ...runtime, pose: { ...runtime.pose, x: 1_000_001 } },
  { ...runtime, dayNight: { ...runtime.dayNight, cycleLengthMs: 0 } },
]) {
  assert.equal(validateVoxelRuntimeSnapshot(corrupt), null);
}

assert.equal(advanceVoxelWorldTimeMs(10_000, 0.016, true), 10_000, "pause freezes the day/world clock");
assert.equal(advanceVoxelWorldTimeMs(10_000, 0.016, false), 10_016);
assert.equal(advanceVoxelWorldTimeMs(10_000, 30, false), 10_050, "foreground clock steps are frame bounded after stalls");
assert.equal(advanceVoxelWorldTimeMs(10_000, Number.NaN, false), 10_000);

console.log("lakecraft engine runtime persistence tests: ok");
