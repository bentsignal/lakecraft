import assert from "node:assert/strict";
import {
  LOCAL_MOB_LINE_OF_SIGHT_MAX_SAMPLES,
  consumeDueLocalCreeperExplosions,
  createMobSimulation,
  localMobHasLineOfSight,
  stepMobSimulation,
  type MobKind,
  type MobSimulation,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";
import { CREEPER_FUSE_TICKS, MOB_MOTION_TICKS_PER_SECOND } from "../shared/mobMotionAuthority.ts";

function spawn(kind: MobKind, id = `${kind}-los`, x = 0): MobSpawnDescriptor {
  return { id, kind, x, y: 1, z: 0, yaw: 0, homeX: x, homeZ: 0, behaviorSeed: 47 };
}

const player = { x: 2, y: 1, z: 0 };
const wall = (x: number): boolean => x >= 0.75 && x <= 1.25;

let probes = 0;
assert.equal(localMobHasLineOfSight(spawn("creeper"), { x: 16, y: 1, z: 0 }, () => {
  probes += 1;
  return false;
}), true);
assert.ok(probes <= LOCAL_MOB_LINE_OF_SIGHT_MAX_SAMPLES, "one maximum-range LOS ray is strictly bounded");
assert.equal(localMobHasLineOfSight(spawn("creeper"), player, wall), false, "a solid cell occludes the eye ray");
assert.equal(localMobHasLineOfSight(spawn("creeper"), player), true, "the callback-free fallback preserves existing simulations");

function step(
  simulation: MobSimulation,
  kind: "clear" | "blocked",
  target = player,
): void {
  stepMobSimulation(simulation, {
    dtSeconds: 1 / MOB_MOTION_TICKS_PER_SECOND,
    isNight: true,
    terrainHeight: () => 0,
    player: target,
    isProjectileBlocked: kind === "blocked" ? wall : () => false,
  });
}

const hiddenCreeper = createMobSimulation([spawn("creeper", "creeper-hidden")]);
step(hiddenCreeper, "blocked");
assert.equal(hiddenCreeper.mobs[0]!.fuseStartedAtSeconds, 0, "a creeper cannot prime through a wall");
assert.notEqual(hiddenCreeper.mobs[0]!.behavior, "fuse");

const interrupted = createMobSimulation([spawn("creeper", "creeper-interrupted")]);
step(interrupted, "clear");
assert.ok(interrupted.mobs[0]!.fuseStartedAtSeconds > 0);
step(interrupted, "blocked");
assert.equal(interrupted.mobs[0]!.fuseStartedAtSeconds, 0, "losing LOS cancels an incomplete fuse");
assert.equal(interrupted.mobs[0]!.fuseUntilSeconds, 0);
assert.equal(consumeDueLocalCreeperExplosions(interrupted).length, 0);

const completed = createMobSimulation([spawn("creeper", "creeper-completed")]);
step(completed, "clear");
for (let tick = 0; tick < CREEPER_FUSE_TICKS; tick += 1) step(completed, "clear");
const dueStart = completed.mobs[0]!.fuseStartedAtSeconds;
step(completed, "blocked");
assert.equal(completed.mobs[0]!.fuseStartedAtSeconds, dueStart, "completed fuses stay latched even when cover appears");
assert.equal(consumeDueLocalCreeperExplosions(completed).length, 1);
assert.equal(consumeDueLocalCreeperExplosions(completed).length, 0, "the latched explosion remains exact-once");

const skeleton = createMobSimulation([spawn("skeleton", "skeleton-hidden")]);
const distantPlayer = { x: 8, y: 1, z: 0 };
for (let tick = 0; tick < 60; tick += 1) step(skeleton, "blocked", distantPlayer);
assert.equal(skeleton.projectiles.some((projectile) => projectile.active), false, "an occluded skeleton cannot fire into a wall");
let sawClearShot = false;
for (let tick = 0; tick < 40 && !sawClearShot; tick += 1) {
  step(skeleton, "clear", distantPlayer);
  sawClearShot = skeleton.projectiles.some((projectile) => projectile.active);
}
assert.equal(sawClearShot, true, "the same skeleton resumes ranged attacks after LOS clears");

for (const kind of ["zombie", "spider"] as const) {
  const simulation = createMobSimulation([spawn(kind)]);
  step(simulation, "blocked");
  assert.notEqual(simulation.mobs[0]!.behavior, "chase", `${kind} cannot aggro through the wall`);
}

let passiveProbes = 0;
const passive = createMobSimulation([spawn("pig")]);
stepMobSimulation(passive, {
  dtSeconds: 0.1,
  isNight: true,
  terrainHeight: () => 0,
  player,
  isProjectileBlocked: () => { passiveProbes += 1; return true; },
});
assert.equal(passiveProbes, 0, "passive simulation never pays the LOS probe cost");
assert.notEqual(passive.mobs[0]!.behavior, "dormant");

const fallback = createMobSimulation([spawn("creeper", "creeper-fallback")]);
stepMobSimulation(fallback, { dtSeconds: 0.1, isNight: false, terrainHeight: () => 0, player });
assert.equal(fallback.mobs[0]!.behavior, "fuse", "omitting the optional probe preserves clear-path behavior");

console.log("lakecraft bounded local hostile line-of-sight tests: ok");
