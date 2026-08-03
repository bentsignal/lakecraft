import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOCAL_MOB_DEATH_ANIMATION_SECONDS,
  LOCAL_MOB_HOSTILE_SPAWN_LIGHT_MAX,
  LOCAL_MOB_SPIDER_ENGAGEMENT_SECONDS,
  MOB_DEFINITIONS,
  createMobSimulation,
  createMobSpawns,
  damageMob,
  exportMobSimulationSnapshot,
  reconcileLocalMobStreaming,
  restoreMobSimulationSnapshot,
  stepMobSimulation,
  writeMobPoseSnapshots,
  type LocalMobDeathDropEvent,
  type MobKind,
  type MobSimulation,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";
import {
  MAX_ACTIVE_TORCH_LIGHTS,
  TORCH_LIGHT_RADIUS,
  sampleCachedMobLocalLight,
} from "../client/game/voxelEngine.ts";

function spawn(kind: MobKind, index = 0): MobSpawnDescriptor {
  return {
    id: `${kind}-ecology-${index}`,
    kind,
    x: index * 2,
    y: 1,
    z: 0,
    yaw: 0,
    homeX: index * 2,
    homeZ: 0,
    behaviorSeed: 701 + index,
  };
}

const noTorches = new Float32Array(MAX_ACTIVE_TORCH_LIGHTS * 4);
assert.equal(sampleCachedMobLocalLight(3, 1, noTorches, 0, 0, 1, 0), 1, "open noon is fully lit");
assert.equal(sampleCachedMobLocalLight(0, 1, noTorches, 0, 0, 1, 0), 0, "a cave or complete roof stays dark at noon");
assert.equal(sampleCachedMobLocalLight(3, 0, noTorches, 0, 0, 1, 0), 0, "open night is dark");
assert.equal(sampleCachedMobLocalLight(3, 0.35, noTorches, 0, 0, 1, 0), 0.35, "dawn follows cached sun intensity");
const caveTorch = new Float32Array(MAX_ACTIVE_TORCH_LIGHTS * 4);
caveTorch[0] = 0;
caveTorch[1] = 1;
caveTorch[2] = 0;
caveTorch[3] = TORCH_LIGHT_RADIUS;
assert.equal(sampleCachedMobLocalLight(0, 0, caveTorch, 1, 0, 1, 0), 1, "a cached torch lights a cave without a ray");

const spawnOptions = {
  seed: 7319,
  radius: 18,
  terrainHeight: () => 0,
  passivePopulation: 0,
  hostilePopulation: 4,
  maxPopulation: 4,
  spawnClearRadius: 2,
  isSpawnable: () => true,
};
const darkSpawns = createMobSpawns({ ...spawnOptions, localLight: () => LOCAL_MOB_HOSTILE_SPAWN_LIGHT_MAX - 0.01 });
assert.equal(darkSpawns.length, 4, "all four hostile slots can populate a valid dark area");
assert.equal(createMobSpawns({ ...spawnOptions, localLight: () => LOCAL_MOB_HOSTILE_SPAWN_LIGHT_MAX }).length, 0,
  "the exact bright threshold rejects new surface hostiles");
const streamed = createMobSimulation(darkSpawns);
assert.ok(reconcileLocalMobStreaming(streamed, createMobSpawns({ ...spawnOptions, localLight: () => 1 }), 0, 0, 20) > 0);
assert.equal(streamed.mobs.length, 0, "streaming cannot introduce a bright-surface hostile population");

function step(
  simulation: MobSimulation,
  count: number,
  options: { light?: number; sky?: boolean; sun?: number; player?: { x: number; y: number; z: number } | null;
    drops?: (event: Readonly<LocalMobDeathDropEvent>) => boolean } = {},
): void {
  for (let index = 0; index < count; index += 1) {
    stepMobSimulation(simulation, {
      dtSeconds: 0.1,
      isNight: (options.light ?? 0) < 0.5,
      terrainHeight: () => 0,
      player: options.player === undefined ? { x: 2, y: 1, z: 0 } : options.player,
      localLight: () => options.light ?? 0,
      directSky: () => options.sky ?? false,
      sunIntensity: options.sun ?? 0,
      onFatalDrops: options.drops,
    });
  }
}

for (const kind of ["zombie", "skeleton"] as const) {
  const open = createMobSimulation([spawn(kind)]);
  step(open, 12, { light: 1, sky: true, sun: 1, player: null });
  assert.equal(open.mobs[0]!.health, MOB_DEFINITIONS[kind].maxHealth - 2, `${kind} burns in direct noon sky`);
  assert.equal(writeMobPoseSnapshots(open)[0]!.sunBurning, true);

  for (const shelter of ["tree shade", "cave", "roof"] as const) {
    const protectedMob = createMobSimulation([spawn(kind)]);
    step(protectedMob, 20, { light: shelter === "tree shade" ? 2 / 3 : 0, sky: false, sun: 1, player: null });
    assert.equal(protectedMob.mobs[0]!.health, MOB_DEFINITIONS[kind].maxHealth, `${shelter} protects ${kind}`);
    assert.equal(writeMobPoseSnapshots(protectedMob)[0]!.sunBurning, false);
  }
  const dawn = createMobSimulation([spawn(kind)]);
  step(dawn, 20, { light: 0.35, sky: true, sun: 0.35, player: null });
  assert.equal(dawn.mobs[0]!.health, MOB_DEFINITIONS[kind].maxHealth, `weak dawn does not burn ${kind} early`);
}

for (const kind of ["spider", "creeper"] as const) {
  const immune = createMobSimulation([spawn(kind)]);
  step(immune, 30, { light: 1, sky: true, sun: 1, player: null });
  assert.equal(immune.mobs[0]!.health, MOB_DEFINITIONS[kind].maxHealth, `${kind} never burns`);
  assert.equal(writeMobPoseSnapshots(immune)[0]!.sunBurning, false);
}

const spider = createMobSimulation([spawn("spider")]);
step(spider, 1, { light: 0, player: { x: 2, y: 1, z: 0 } });
assert.equal(spider.mobs[0]!.behavior, "chase", "a dark spider acquires a visible target");
step(spider, 1, { light: 1, player: { x: 2, y: 1, z: 0 } });
assert.equal(spider.mobs[0]!.hostileActive, true, "brightening cannot flicker an active engagement off");
step(spider, Math.ceil(LOCAL_MOB_SPIDER_ENGAGEMENT_SECONDS / 0.1) + 1, { light: 1, player: null });
assert.equal(spider.mobs[0]!.behavior, "dormant", "a bright spider releases after the stable retention window");
step(spider, 1, { light: 1, player: { x: 2, y: 1, z: 0 } });
assert.equal(spider.mobs[0]!.hostileActive, false, "a neutral bright spider cannot reacquire");

const creeper = createMobSimulation([spawn("creeper")]);
step(creeper, 1, { light: 1, sky: true, sun: 1, player: { x: 2, y: 1, z: 0 } });
assert.equal(creeper.mobs[0]!.behavior, "fuse", "bright daylight never suppresses a creeper fuse");

const allKinds = ["pig", "cow", "sheep", "chicken", "zombie", "skeleton", "creeper", "spider"] as const;
const deaths = createMobSimulation(allKinds.map((kind, index) => spawn(kind, index)));
step(deaths, 1, { player: null });
const deathEvents: LocalMobDeathDropEvent[] = [];
for (const mob of deaths.mobs) {
  assert.equal(damageMob(deaths, mob.id, 100, (event) => {
    deathEvents.push({ ...event, drops: event.drops.map((drop) => ({ ...drop })) });
    return true;
  }).killed, true);
}
assert.equal(deathEvents.length, allKinds.length, "each accepted fatal hit settles drops exactly once at death start");
assert.equal(writeMobPoseSnapshots(deaths).length, allKinds.length, "every mob kind begins a visible death pose");
step(deaths, 3, { player: null });
const midpoint = writeMobPoseSnapshots(deaths);
assert.equal(midpoint.length, allKinds.length);
assert.ok(midpoint.every((pose) => pose.deathFall > 0 && pose.deathFall < 1));
const restored = createMobSimulation(allKinds.map((kind, index) => spawn(kind, index)));
assert.equal(restoreMobSimulationSnapshot(restored, exportMobSimulationSnapshot(deaths)), true);
assert.deepEqual(restored, deaths, "save/reload preserves exact burn, engagement, death, and respawn clocks");
step(deaths, Math.ceil(LOCAL_MOB_DEATH_ANIMATION_SECONDS / 0.1), { player: null });
step(restored, Math.ceil(LOCAL_MOB_DEATH_ANIMATION_SECONDS / 0.1), { player: null });
assert.deepEqual(restored, deaths, "restored death animation expires on the same deterministic tick");
assert.equal(writeMobPoseSnapshots(deaths).length, 0, "corpses leave the retained pose list after the short fall-over");
for (const mob of deaths.mobs) damageMob(deaths, mob.id, 100, () => { throw new Error("dead mobs cannot replay loot"); });
assert.equal(deathEvents.length, allKinds.length);

const solarLoot = createMobSimulation([spawn("zombie", 99)]);
let solarDeathEvents = 0;
step(solarLoot, 120, {
  light: 1,
  sky: true,
  sun: 1,
  player: null,
  drops: () => { solarDeathEvents += 1; return true; },
});
assert.equal(solarLoot.mobs[0]!.alive, false, "sustained direct daylight eventually kills a zombie");
assert.equal(solarDeathEvents, 1, "sunlight death uses the exact-once world-drop path");

const bounded = createMobSimulation(allKinds.map((kind, index) => spawn(kind, index)));
let lightSamples = 0;
let skySamples = 0;
for (let tick = 0; tick < 5_000; tick += 1) {
  stepMobSimulation(bounded, {
    dtSeconds: 0.1,
    isNight: true,
    terrainHeight: () => 0,
    player: null,
    localLight: () => { lightSamples += 1; return 0; },
    directSky: () => { skySamples += 1; return false; },
    sunIntensity: 1,
  });
}
assert.equal(lightSamples, bounded.mobs.length * 5_000, "cached light is sampled once per mob per fixed simulation step");
assert.equal(skySamples, 2 * 5_000, "only the two sunlight-sensitive kinds sample direct sky");
const mobSource = readFileSync(new URL("../client/game/mobs.ts", import.meta.url), "utf8");
const ecologyLoop = mobSource.slice(mobSource.indexOf("export function stepMobSimulation"), mobSource.indexOf("export function consumeDueLocalCreeperExplosions"));
assert.equal(/setTimeout|setInterval|requestAnimationFrame|fetch\(/.test(ecologyLoop), false,
  "local ecology adds no timers, polling, network calls, or render-loop ownership");

console.log("local hostile light ecology, death, persistence, streaming, and bounded-cadence tests passed");
