import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  HARD_MAX_MOB_POPULATION,
  MOB_DEFINITIONS,
  createMobSimulation,
  createMobSpawns,
  isLocalMobSpawnOutsideView,
  exportMobSimulationSnapshot,
  reconcileLocalMobStreaming,
  restoreMobSimulationSnapshot,
  stepMobSimulation,
  type MobSimulation,
} from "../client/game/mobs.ts";
import { terrainHeight } from "../client/game/terrain.ts";

const seed = 7319;
const spawnRadius = 22;
const clearRadius = 20;
const retainRadius = 28;
const population = 17;

function populationAt(centerX: number, centerZ: number) {
  return createMobSpawns({
    seed,
    radius: spawnRadius,
    centerX,
    centerZ,
    terrainHeight: () => 6,
    isSpawnable: () => true,
    maxPopulation: population,
    passivePopulation: 12,
    hostilePopulation: 5,
    spawnClearRadius: clearRadius,
  });
}

const origin = populationAt(4, 4);
assert.equal(origin.length, population);
assert.deepEqual(populationAt(4, 4), origin, "one streamed region is exactly repeatable");
assert.deepEqual(
  populationAt(804, -396).map(({ id, kind }) => ({ id, kind })),
  origin.map(({ id, kind }) => ({ id, kind })),
  "bounded slots retain stable IDs and species while their homes follow terrain",
);
for (const spawn of populationAt(804, -396)) {
  const distance = Math.max(Math.abs(spawn.x - 804), Math.abs(spawn.z + 396));
  assert.ok(distance > clearRadius && distance <= spawnRadius, "new homes stay in the off-camera spawn ring");
}
assert.equal(origin.filter(({ kind }) => MOB_DEFINITIONS[kind].passive).length, 12);
assert.equal(origin.filter(({ kind }) => !MOB_DEFINITIONS[kind].passive).length, 5);
assert.equal(isLocalMobSpawnOutsideView(4, 4, 0, 4, -20), false, "a spawn directly ahead is rejected");
assert.equal(isLocalMobSpawnOutsideView(4, 4, 0, 24, 4), true, "a spawn outside the camera cone is eligible");
assert.equal(isLocalMobSpawnOutsideView(4, 4, Math.PI / 2, 24, 4), false, "view rejection follows yaw");

const simulation = createMobSimulation(origin);
const retained = simulation.mobs[0]!;
retained.health -= 1;
retained.damageSequence = 7;
const retainedProjectile = simulation.projectiles[0]!;
retainedProjectile.active = true;
retainedProjectile.ownerId = retained.id;
assert.equal(reconcileLocalMobStreaming(simulation, populationAt(5, 5), 5, 5, retainRadius), 0);
assert.equal(simulation.mobs[0], retained, "nearby mobs preserve object, combat, and behavior state");
assert.equal(simulation.mobs[0]!.health, MOB_DEFINITIONS[retained.kind].maxHealth - 1);
assert.equal(simulation.projectiles[0], retainedProjectile, "a retained mob keeps its projectile identity");
assert.equal(retainedProjectile.active, true);

const retired = simulation.mobs[0]!;
simulation.projectiles[0]!.active = true;
simulation.projectiles[0]!.ownerId = retired.id;
const beforeRetirement = { ...retired };
assert.equal(
  reconcileLocalMobStreaming(simulation, populationAt(1_004, 4), 1_004, 4, retainRadius),
  population,
  "a far relocation recycles every bounded slot",
);
assert.equal(simulation.mobs.length, population);
assert.notEqual(simulation.mobs[0], retired);
assert.equal(simulation.mobs[0]!.damageSequence, 7, "recycled IDs never replay a prior death/drop sequence");
assert.equal(simulation.projectiles[0]!.active, false, "projectiles owned by an unloaded mob stop immediately");
for (let tick = 0; tick < 100; tick += 1) {
  stepMobSimulation(simulation, {
    dtSeconds: 0.1,
    isNight: true,
    terrainHeight: () => 6,
    player: { x: 1_004, y: 7, z: 4 },
    worldRadius: retainRadius,
    worldCenterX: 1_004,
    worldCenterZ: 4,
  });
}
assert.deepEqual(retired, beforeRetirement, "objects retired with unloaded terrain receive no later simulation work");

const saved = exportMobSimulationSnapshot(simulation);
const restored = createMobSimulation([]);
assert.equal(restoreMobSimulationSnapshot(restored, JSON.parse(JSON.stringify(saved))), true);
assert.deepEqual(exportMobSimulationSnapshot(restored), saved, "the active streamed population round-trips exactly");
assert.equal(
  reconcileLocalMobStreaming(restored, populationAt(1_004, 4), 1_004, 4, retainRadius),
  0,
  "loading at the saved chunk does not perturb restored simulation state",
);
assert.deepEqual(exportMobSimulationSnapshot(restored), saved);
for (let tick = 0; tick < 300; tick += 1) {
  const input = {
    dtSeconds: 0.1,
    isNight: tick % 3 !== 0,
    terrainHeight: () => 6,
    player: { x: 1_004, y: 7, z: 4 },
    worldRadius: retainRadius,
    worldCenterX: 1_004,
    worldCenterZ: 4,
  };
  stepMobSimulation(simulation, input);
  stepMobSimulation(restored, input);
}
assert.deepEqual(restored, simulation, "save/reload resumes the streamed population byte-equivalently");

const traversal: MobSimulation = createMobSimulation(populationAt(4, 4));
const startedAt = performance.now();
let recycled = 0;
for (let chunk = 1; chunk <= 2_000; chunk += 1) {
  const centerX = 4 + chunk * 8;
  const centerZ = 4 + (chunk % 5 - 2) * 8;
  recycled += reconcileLocalMobStreaming(
    traversal,
    populationAt(centerX, centerZ),
    centerX,
    centerZ,
    retainRadius,
  );
  stepMobSimulation(traversal, {
    dtSeconds: 0.1,
    isNight: chunk % 2 === 0,
    terrainHeight: () => 6,
    player: { x: centerX, y: 7, z: centerZ },
    worldRadius: retainRadius,
    worldCenterX: centerX,
    worldCenterZ: centerZ,
  });
  assert.equal(traversal.mobs.length, population);
  assert.ok(traversal.mobs.length <= HARD_MAX_MOB_POPULATION);
  assert.equal(new Set(traversal.mobs.map(({ id }) => id)).size, population);
  assert.ok(traversal.mobs.every(({ x, z }) =>
    Math.max(Math.abs(x - centerX), Math.abs(z - centerZ)) <= retainRadius));
}
const elapsedMs = performance.now() - startedAt;
assert.ok(recycled > population * 100, "long traversal continually replenishes newly active terrain");
assert.equal(traversal.projectiles.length, 24, "the projectile pool remains fixed across arbitrarily long travel");
assert.ok(elapsedMs < 1_500, `2,000 streamed chunk transitions took ${elapsedMs.toFixed(1)}ms`);

let minimumTerrainPopulation = population;
for (let chunk = 0; chunk < 2_000; chunk += 1) {
  const centerX = 4 + chunk * 8;
  const centerZ = 4 + (chunk % 11 - 5) * 8;
  const spawns = createMobSpawns({
    seed,
    radius: spawnRadius,
    centerX,
    centerZ,
    terrainHeight: (x, z) => terrainHeight(x, z, seed),
    isSpawnable: () => true,
    maxPopulation: population,
    passivePopulation: 12,
    hostilePopulation: 5,
    spawnClearRadius: clearRadius,
  });
  minimumTerrainPopulation = Math.min(minimumTerrainPopulation, spawns.length);
}
assert.equal(minimumTerrainPopulation, population, "real generated terrain sustains the bounded population over long travel");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const streamingWindow = engine.slice(engine.indexOf("function updateStreamingWindow"), engine.indexOf("const getBlock"));
assert.match(streamingWindow, /reconcileLocalMobStreaming\(mobSimulation/);
assert.match(streamingWindow, /localMobStreaming && !sharedMobMotionActive/,
  "multiplayer/shared-authority populations remain outside this local-only recycler");
assert.match(engine, /worldCenterX: localMobStreaming \? mobStreamingCenterX : 0/);
assert.match(engine, /isLocalMobSpawnOutsideView\(pose\.x, pose\.z, pose\.yaw, x, z\)/,
  "streamed replacements cannot appear directly in the current camera cone");

console.log(JSON.stringify({
  benchmark: "bounded local mob terrain streaming",
  chunkTransitions: 2_000,
  activeMobs: traversal.mobs.length,
  recycled,
  elapsedMs: Number(elapsedMs.toFixed(2)),
}));
console.log("lakecraft local mob streaming tests: ok");
