import assert from "node:assert/strict";
import {
  CREEPER_FUSE_TICKS,
  MOB_MOTION_TICKS_PER_SECOND,
} from "../shared/mobMotionAuthority.ts";
import {
  LOCAL_MOB_SPIDER_NEUTRAL_LIGHT_MIN,
  consumeDueLocalCreeperExplosions,
  createMobSimulation,
  localMobHostileActive,
  stepMobSimulation,
  type MobKind,
  type MobSimulation,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";

function spawn(kind: MobKind, id = `${kind}-daytime`): MobSpawnDescriptor {
  return { id, kind, x: 0, y: 1, z: 0, yaw: 0, homeX: 0, homeZ: 0, behaviorSeed: 91 };
}

function step(
  simulation: MobSimulation,
  light: number,
  player: { x: number; y: number; z: number } | null = { x: 2, y: 1, z: 0 },
): void {
  stepMobSimulation(simulation, {
    dtSeconds: 1 / MOB_MOTION_TICKS_PER_SECOND,
    isNight: light < LOCAL_MOB_SPIDER_NEUTRAL_LIGHT_MIN,
    terrainHeight: () => 0,
    player,
    localLight: () => light,
    directSky: () => false,
    sunlightIntensity: 1,
  });
}

for (const kind of ["zombie", "skeleton", "creeper"] as const) {
  assert.equal(localMobHostileActive(kind, 1), true, `${kind} stays dangerous after spawning in daylight`);
}
assert.equal(localMobHostileActive("spider", 1), false, "an unengaged bright spider is neutral");
assert.equal(localMobHostileActive("spider", 1, true), true, "engagement remains stable across a light edge");
assert.equal(localMobHostileActive("spider", 0), true, "a dark spider can acquire a target");
for (const kind of ["pig", "cow", "sheep", "chicken"] as const) {
  assert.equal(localMobHostileActive(kind, 0), false);
  assert.equal(localMobHostileActive(kind, 1), false, `${kind} remains passive regardless of light`);
}

const daytime = createMobSimulation([spawn("creeper")]);
step(daytime, 1);
const daytimeCreeper = daytime.mobs[0]!;
assert.equal(daytimeCreeper.hostileActive, true);
assert.equal(daytimeCreeper.sunlightBurning, false, "creepers never burn");
assert.equal(daytimeCreeper.behavior, "fuse", "a nearby daytime player starts the creeper fuse");
assert.ok(daytimeCreeper.fuseStartedAtSeconds > 0);

step(daytime, 1, { x: 10, y: 1, z: 0 });
assert.equal(daytimeCreeper.fuseStartedAtSeconds, 0, "escaping during daylight still cancels the fuse");
assert.equal(daytimeCreeper.fuseUntilSeconds, 0);
assert.equal(daytimeCreeper.behavior, "chase");

const dawnCrossing = createMobSimulation([spawn("creeper", "creeper-dawn-crossing")]);
step(dawnCrossing, 0);
const dawnCreeper = dawnCrossing.mobs[0]!;
const originalStart = dawnCreeper.fuseStartedAtSeconds;
const originalDeadline = dawnCreeper.fuseUntilSeconds;
assert.ok(originalStart > 0 && originalDeadline > originalStart);

for (let tick = 0; tick < CREEPER_FUSE_TICKS; tick += 1) {
  step(dawnCrossing, 1);
  assert.equal(dawnCreeper.fuseStartedAtSeconds, originalStart, "dawn cannot restart or cancel an active fuse");
  assert.equal(dawnCreeper.fuseUntilSeconds, originalDeadline, "the original exact fuse deadline remains authoritative");
}
assert.ok(dawnCrossing.elapsedSeconds >= originalDeadline);
assert.deepEqual(
  consumeDueLocalCreeperExplosions(dawnCrossing),
  [{ mobId: dawnCreeper.id, x: dawnCreeper.x, y: dawnCreeper.y, z: dawnCreeper.z }],
  "a fuse crossing into daylight completes once at its original deadline",
);
assert.equal(dawnCreeper.alive, false);
assert.equal(consumeDueLocalCreeperExplosions(dawnCrossing).length, 0, "the completed daylight explosion cannot replay");

console.log("lakecraft local-light creeper and hostility behavior tests: ok");
