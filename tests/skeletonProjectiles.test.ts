import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  MAX_MOB_PROJECTILES,
  MOB_DEFINITIONS,
  consumeMobProjectileDamage,
  createMobSimulation,
  stepMobSimulation,
  writeMobProjectileSnapshots,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";

function skeleton(index: number, x = 0, z = 0): MobSpawnDescriptor {
  return {
    id: `skeleton-5nb-${index.toString(36)}`,
    kind: "skeleton",
    x,
    y: 1,
    z,
    yaw: 0,
    homeX: x,
    homeZ: z,
    behaviorSeed: 1001 + index * 97,
  };
}

const input = {
  dtSeconds: 1 / 60,
  isNight: true,
  terrainHeight: () => 0,
  player: { x: 0, y: 1, z: 8 },
  worldRadius: 40,
};

assert.equal(MOB_DEFINITIONS.skeleton.passive, false);
assert.equal(MOB_DEFINITIONS.skeleton.contactDamage, 0, "skeletons should use arrows instead of zombie contact damage");
assert.ok(MOB_DEFINITIONS.skeleton.rangedCooldownSeconds >= 1.5);

const daytime = createMobSimulation([skeleton(0)]);
for (let tick = 0; tick < 180; tick += 1) stepMobSimulation(daytime, { ...input, isNight: false });
assert.equal(daytime.mobs[0].behavior, "dormant");
assert.equal(writeMobProjectileSnapshots(daytime).length, 0, "daytime skeletons must not fire");

// Fixed seed and fixed steps produce identical attacks and projectile paths.
const deterministicA = createMobSimulation([skeleton(0)]);
const deterministicB = createMobSimulation([skeleton(0)]);
for (let tick = 0; tick < 50; tick += 1) {
  stepMobSimulation(deterministicA, input);
  stepMobSimulation(deterministicB, input);
}
assert.deepEqual(deterministicB, deterministicA);
assert.ok(writeMobProjectileSnapshots(deterministicA).length > 0, "a night skeleton should fire within its deterministic opening delay");

let damage = 0;
for (let tick = 0; tick < 240 && damage === 0; tick += 1) {
  stepMobSimulation(deterministicA, input);
  damage += consumeMobProjectileDamage(deterministicA);
}
assert.equal(damage, MOB_DEFINITIONS.skeleton.rangedDamage, "a swept arrow hit should apply one bounded ranged attack");
assert.equal(consumeMobProjectileDamage(deterministicA), 0, "consuming an impact twice must not duplicate damage");

// Solid-block collision removes an arrow before it can reach the player.
const blocked = createMobSimulation([skeleton(1)]);
for (let tick = 0; tick < 240; tick += 1) {
  stepMobSimulation(blocked, { ...input, isProjectileBlocked: (_x, _y, z) => z >= 2 });
}
assert.equal(consumeMobProjectileDamage(blocked), 0);
assert.ok(writeMobProjectileSnapshots(blocked).every((projectile) => projectile.z < 2));

// The retained output array and objects are reusable by the renderer.
const retained = createMobSimulation([skeleton(2)]);
for (let tick = 0; tick < 80; tick += 1) stepMobSimulation(retained, input);
const snapshots = writeMobProjectileSnapshots(retained);
const firstSnapshot = snapshots[0];
assert.equal(writeMobProjectileSnapshots(retained, snapshots), snapshots);
assert.equal(snapshots[0], firstSnapshot);

// A crowd can never exceed the fixed arrow pool, and remains cheap enough for a frame loop.
const crowd = createMobSimulation(Array.from({ length: 64 }, (_, index) => skeleton(index, (index % 8) - 4, Math.floor(index / 8) - 4)));
const benchmarkStart = performance.now();
for (let tick = 0; tick < 3_000; tick += 1) stepMobSimulation(crowd, input);
const benchmarkMs = performance.now() - benchmarkStart;
assert.equal(crowd.projectiles.length, MAX_MOB_PROJECTILES);
assert.ok(writeMobProjectileSnapshots(crowd).length <= MAX_MOB_PROJECTILES);
assert.ok(benchmarkMs < 350, `192,000 skeleton-ticks plus arrows took ${benchmarkMs.toFixed(1)}ms (budget: 350ms)`);

console.log(JSON.stringify({
  benchmark: "bounded skeleton arrows",
  skeletonTicks: 64 * 3_000,
  projectilePool: MAX_MOB_PROJECTILES,
  elapsedMs: Number(benchmarkMs.toFixed(2)),
}));
console.log("lakecraft skeleton projectile tests: ok");
