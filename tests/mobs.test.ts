import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  HARD_MAX_MOB_POPULATION,
  MOB_DEFINITIONS,
  PASSIVE_MOB_HERD_SIZE,
  createMobSimulation,
  createMobSpawns,
  damageMob,
  listMobIds,
  raycastMobs,
  stepMobSimulation,
  writeMobPoseSnapshots,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";
import { terrainHeight } from "../client/game/terrain.ts";

const SEED = 7319;
const heightAt = (x: number, z: number) => terrainHeight(x, z, SEED);
const spawnOptions = {
  seed: SEED,
  radius: 30,
  terrainHeight: heightAt,
  passivePopulation: 15,
  hostilePopulation: 6,
  maxPopulation: 21,
  spawnClearRadius: 7,
} as const;

assert.deepEqual(Object.keys(MOB_DEFINITIONS).sort(), ["chicken", "cow", "creeper", "pig", "sheep", "skeleton", "spider", "zombie"]);
assert.equal(MOB_DEFINITIONS.zombie.contactDamage, 3);
assert.equal(MOB_DEFINITIONS.cow.drops.some((drop) => drop.itemId === "leather"), true);
assert.equal(MOB_DEFINITIONS.sheep.drops.some((drop) => drop.itemId === "wool"), true);
assert.deepEqual(MOB_DEFINITIONS.skeleton.drops.map(({ itemId }) => itemId), ["arrow", "bone"]);
assert.deepEqual(MOB_DEFINITIONS.spider.drops.map(({ itemId }) => itemId), ["string"]);
assert.deepEqual(MOB_DEFINITIONS.chicken.drops.map(({ itemId }) => itemId), ["raw_chicken", "feather"]);
assert.equal(MOB_DEFINITIONS.creeper.contactDamage, 0, "creeper damage must remain a future one-shot explosion claim");

const spawns = createMobSpawns(spawnOptions);
assert.deepEqual(createMobSpawns(spawnOptions), spawns, "seeded mob population must be exactly repeatable");
assert.notDeepEqual(createMobSpawns({ ...spawnOptions, seed: SEED + 1 }), spawns);
assert.equal(spawns.length, 21);
assert.ok(spawns.length <= spawnOptions.maxPopulation);
assert.deepEqual(new Set(spawns.map((spawn) => spawn.kind)), new Set(["pig", "cow", "sheep", "chicken", "zombie", "skeleton", "creeper", "spider"]));
assert.equal(new Set(spawns.map((spawn) => `${spawn.x},${spawn.z}`)).size, spawns.length);
for (const spawn of spawns) {
  assert.ok(Math.abs(spawn.x) <= spawnOptions.radius && Math.abs(spawn.z) <= spawnOptions.radius);
  assert.ok(Math.max(Math.abs(spawn.x), Math.abs(spawn.z)) > spawnOptions.spawnClearRadius);
  assert.equal(spawn.y, heightAt(spawn.x, spawn.z) + 1);
}
const passiveSpawns = spawns.filter((spawn) => MOB_DEFINITIONS[spawn.kind].passive);
for (let index = 0; index < passiveSpawns.length; index += PASSIVE_MOB_HERD_SIZE) {
  const herd = passiveSpawns.slice(index, index + PASSIVE_MOB_HERD_SIZE);
  assert.equal(new Set(herd.map(({ kind }) => kind)).size, 1, "a passive family shares one species");
  const anchor = herd[0]!;
  assert.ok(herd.every(({ x, z }) => Math.hypot(x - anchor.x, z - anchor.z) <= 4),
    "a passive family spawns as a visible herd rather than scattered singles");
}
assert.equal(createMobSpawns({ ...spawnOptions, maxPopulation: 0 }).length, 0);

const boundedIdsSimulation = createMobSimulation(spawns);
const boundedIds = listMobIds(boundedIdsSimulation);
assert.deepEqual(boundedIds, boundedIdsSimulation.mobs.map((mob) => mob.id));
boundedIds[0] = "mutated-copy";
assert.notEqual(listMobIds(boundedIdsSimulation)[0], "mutated-copy", "mob authority IDs must be returned as a copy");
assert.equal(
  createMobSpawns({ ...spawnOptions, maxPopulation: 1_000, passivePopulation: 1_000, hostilePopulation: 1_000 }).length,
  HARD_MAX_MOB_POPULATION,
);

// Identical fixed-step inputs must produce identical states and visible snapshots.
const simulationA = createMobSimulation(spawns);
const simulationB = createMobSimulation(spawns);
const player = { x: 4, y: 7, z: -3 };
for (let tick = 0; tick < 900; tick += 1) {
  const input = { dtSeconds: 1 / 60, isNight: tick >= 450, terrainHeight: heightAt, player, worldRadius: 31 };
  stepMobSimulation(simulationA, input);
  stepMobSimulation(simulationB, input);
}
assert.deepEqual(simulationB, simulationA);
assert.deepEqual(writeMobPoseSnapshots(simulationB), writeMobPoseSnapshots(simulationA));
assert.ok(
  simulationA.mobs.some((mob, index) => mob.x !== spawns[index].x || mob.z !== spawns[index].z),
  "at least one mob should leave its initial pose while wandering",
);

function descriptor(kind: MobSpawnDescriptor["kind"], x: number, z: number, seed: number): MobSpawnDescriptor {
  return { id: `${kind}-test`, kind, x, y: 1, z, yaw: 0, homeX: x, homeZ: z, behaviorSeed: seed };
}

const sheepTarget = createMobSimulation([descriptor("sheep", 0, 0, 77)]);
assert.equal(
  raycastMobs([3, 1.8, 1.05], [-1, 0, 0], sheepTarget.mobs, 6)?.id,
  "sheep-test",
  "the visible forward sheep head remains hittable from the side",
);
const chickenTarget = createMobSimulation([descriptor("chicken", 0, 0, 78)]);
assert.equal(
  raycastMobs([0, 2.05, 3], [0, 0, -1], chickenTarget.mobs, 6)?.id,
  "chicken-test",
  "the visible chicken head is included in its attack bounds",
);

// Spawn gating handles daylight ecology; an existing zombie remains dangerous.
const zombieSimulation = createMobSimulation([descriptor("zombie", 0, 0, 101)]);
const zombie = zombieSimulation.mobs[0];
for (let tick = 0; tick < 60; tick += 1) {
  stepMobSimulation(zombieSimulation, { dtSeconds: 1 / 60, isNight: false, terrainHeight: () => 0, player: { x: 8, y: 1, z: 0 } });
}
assert.equal(zombie.behavior, "chase");
assert.ok(zombie.x > 1.3, "an existing daylight zombie remains dangerous while shade controls burning");
for (let tick = 0; tick < 120; tick += 1) {
  stepMobSimulation(zombieSimulation, { dtSeconds: 1 / 60, isNight: true, terrainHeight: () => 0, player: { x: 8, y: 1, z: 0 } });
}
assert.equal(zombie.behavior, "chase");
assert.equal(zombie.hostileActive, true);
assert.ok(zombie.x > 4.2 && zombie.x < 4.5, `zombie should chase at its configured speed, reached ${zombie.x}`);
assert.ok(Math.abs(zombie.yaw + Math.PI / 2) < 1e-9,
  "an eastbound zombie's local +Z face points east instead of moonwalking west");

// Blocked diagonal motion should slide along its unblocked axis and never enter solids.
const collisionSimulation = createMobSimulation([descriptor("pig", 0, 0, 202)]);
const pig = collisionSimulation.mobs[0];
pig.behavior = "wander";
pig.behaviorUntilSeconds = 10;
pig.directionX = Math.SQRT1_2;
pig.directionZ = Math.SQRT1_2;
for (let tick = 0; tick < 60; tick += 1) {
  stepMobSimulation(collisionSimulation, {
    dtSeconds: 1 / 60,
    isNight: false,
    terrainHeight: () => 0,
    canOccupy: (_kind, x) => x <= 0.2,
  });
}
assert.ok(pig.x <= 0.2, "collision callback must prevent entry into a blocked space");
assert.ok(pig.z > 0.5, "collision resolution should preserve safe axis sliding");
assert.ok(Math.abs(pig.yaw) < 1e-9, "a diagonal request that slides south faces its actual +Z travel");

// A turn updates facing from the displacement that actually survived collision,
// while a fully blocked step stops gait-worthy behavior without inventing travel.
pig.directionX = -1;
pig.directionZ = 0;
pig.behavior = "wander";
pig.behaviorUntilSeconds = collisionSimulation.elapsedSeconds + 1;
stepMobSimulation(collisionSimulation, {
  dtSeconds: 0.1,
  isNight: false,
  terrainHeight: () => 0,
  canOccupy: () => true,
});
assert.ok(Math.abs(pig.yaw - Math.PI / 2) < 1e-9, "a westbound turn rotates the model front toward -X");

const blockedSimulation = createMobSimulation([descriptor("cow", 0, 0, 204)]);
const blockedCow = blockedSimulation.mobs[0]!;
blockedCow.behavior = "wander";
blockedCow.behaviorUntilSeconds = 10;
blockedCow.directionX = 1;
stepMobSimulation(blockedSimulation, {
  dtSeconds: 0.1,
  isNight: false,
  terrainHeight: () => 0,
  canOccupy: () => false,
});
assert.deepEqual([blockedCow.x, blockedCow.z], [0, 0]);
assert.equal(blockedCow.behavior, "idle", "fully blocked translation cannot leave a walk-in-place behavior label");

// Snapshot arrays and objects can be retained by a renderer to avoid frame allocations.
const reusedSnapshots = writeMobPoseSnapshots(collisionSimulation);
const reusedFirstPose = reusedSnapshots[0];
assert.equal(writeMobPoseSnapshots(collisionSimulation, reusedSnapshots), reusedSnapshots);
assert.equal(reusedSnapshots[0], reusedFirstPose);

const cowSimulationA = createMobSimulation([descriptor("cow", 0, 0, 303)]);
const cowSimulationB = createMobSimulation([descriptor("cow", 0, 0, 303)]);
assert.equal(damageMob(cowSimulationA, "cow-test", 4).remainingHealth, 6);
const fatalA = damageMob(cowSimulationA, "cow-test", 10);
damageMob(cowSimulationB, "cow-test", 4);
const fatalB = damageMob(cowSimulationB, "cow-test", 10);
assert.equal(fatalA.killed, true);
assert.deepEqual(fatalB.drops, fatalA.drops, "drop rolls must be deterministic for the same mob and hit sequence");
assert.equal(writeMobPoseSnapshots(cowSimulationA).length, 1, "a dead mob remains visible for its short fall-over");
assert.equal(writeMobPoseSnapshots(cowSimulationA)[0]?.deathFall, 0);

const benchmarkSpawns = createMobSpawns({
  seed: 909,
  radius: 40,
  terrainHeight: () => 0,
  passivePopulation: 48,
  hostilePopulation: 16,
  maxPopulation: HARD_MAX_MOB_POPULATION,
});
const benchmarkSimulation = createMobSimulation(benchmarkSpawns);
const benchmarkInput = {
  dtSeconds: 1 / 60,
  isNight: false,
  terrainHeight: (_x: number, _z: number) => 0,
  player,
  worldRadius: 41,
};
const benchmarkStart = performance.now();
for (let tick = 0; tick < 6_000; tick += 1) {
  benchmarkInput.isNight = tick % 2 === 0;
  stepMobSimulation(benchmarkSimulation, benchmarkInput);
}
const benchmarkMs = performance.now() - benchmarkStart;
assert.equal(benchmarkSimulation.mobs.length, HARD_MAX_MOB_POPULATION);
assert.ok(benchmarkMs < 350, `384,000 mob-ticks took ${benchmarkMs.toFixed(1)}ms (budget: 350ms)`);

console.log(JSON.stringify({
  benchmark: "allocation-conscious pure mob simulation",
  mobCount: benchmarkSimulation.mobs.length,
  simulationTicks: 6_000,
  mobTicks: benchmarkSimulation.mobs.length * 6_000,
  elapsedMs: Number(benchmarkMs.toFixed(2)),
}));
console.log("lakecraft mob tests: ok");
