import assert from "node:assert/strict";
import {
  consumeDueLocalCreeperExplosions,
  createMobSimulation,
  localMobHostileActive,
  stepMobSimulation,
  type MobKind,
  type MobSimulation,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";
import { CREEPER_FUSE_TICKS, MOB_MOTION_TICKS_PER_SECOND } from "../shared/mobMotionAuthority.ts";

function spawn(kind: MobKind, id = `${kind}-daytime`): MobSpawnDescriptor {
  return { id, kind, x: 0, y: 1, z: 0, yaw: 0, homeX: 0, homeZ: 0, behaviorSeed: 91 };
}

function step(
  simulation: MobSimulation,
  isNight: boolean,
  player = { x: 2, y: 1, z: 0 },
): void {
  stepMobSimulation(simulation, {
    dtSeconds: 1 / MOB_MOTION_TICKS_PER_SECOND,
    isNight,
    terrainHeight: () => 0,
    player,
  });
}

assert.equal(localMobHostileActive("creeper", false), true, "creepers remain dangerous during daylight");
for (const kind of ["zombie", "skeleton", "spider"] as const) {
  assert.equal(localMobHostileActive(kind, false), false, `${kind} retains its current daytime dormancy`);
  assert.equal(localMobHostileActive(kind, true), true, `${kind} remains hostile at night`);
}
for (const kind of ["pig", "cow", "sheep", "chicken"] as const) {
  assert.equal(localMobHostileActive(kind, false), false);
  assert.equal(localMobHostileActive(kind, true), false, `${kind} remains passive regardless of time`);
}

const daytime = createMobSimulation([spawn("creeper")]);
step(daytime, false);
const daytimeCreeper = daytime.mobs[0]!;
assert.equal(daytimeCreeper.hostileActive, true);
assert.equal(daytimeCreeper.behavior, "fuse", "a nearby daytime player starts the creeper fuse");
assert.ok(daytimeCreeper.fuseStartedAtSeconds > 0);

step(daytime, false, { x: 10, y: 1, z: 0 });
assert.equal(daytimeCreeper.fuseStartedAtSeconds, 0, "escaping during daylight still cancels the fuse");
assert.equal(daytimeCreeper.fuseUntilSeconds, 0);
assert.equal(daytimeCreeper.behavior, "chase");

const dawnCrossing = createMobSimulation([spawn("creeper", "creeper-dawn-crossing")]);
step(dawnCrossing, true);
const dawnCreeper = dawnCrossing.mobs[0]!;
const originalStart = dawnCreeper.fuseStartedAtSeconds;
const originalDeadline = dawnCreeper.fuseUntilSeconds;
assert.ok(originalStart > 0 && originalDeadline > originalStart);

for (let tick = 0; tick < CREEPER_FUSE_TICKS; tick += 1) {
  step(dawnCrossing, false);
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

const daytimeKinds = ["zombie", "skeleton", "spider", "pig", "cow", "sheep", "chicken"] as const;
const daytimeControl = createMobSimulation(daytimeKinds.map((kind) => spawn(kind)));
step(daytimeControl, false);
for (const mob of daytimeControl.mobs) {
  assert.equal(mob.hostileActive, false);
  if (mob.kind === "zombie" || mob.kind === "skeleton" || mob.kind === "spider") {
    assert.equal(mob.behavior, "dormant", `${mob.kind} is unchanged by the creeper-only daylight exception`);
  } else {
    assert.notEqual(mob.behavior, "dormant", `${mob.kind} keeps its passive daytime simulation`);
  }
}
assert.equal(daytimeControl.projectiles.some((projectile) => projectile.active), false, "daytime skeletons still cannot fire");

console.log("lakecraft daytime local creeper behavior tests: ok");
