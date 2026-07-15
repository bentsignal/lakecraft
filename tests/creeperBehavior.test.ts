import assert from "node:assert/strict";
import { createMobSpawns, createMobSimulation, stepMobSimulation, writeMobPoseSnapshots } from "../client/game/mobs.ts";
import { canonicalMobSpawnSnapshot, MOB_WORLD_SEED } from "../server/mobWorldAuthority.ts";
import {
  CREEPER_FUSE_TICKS,
  createMobMotionState,
  isCreeperFuseDue,
  restoreMobMotionCheckpoint,
  stepMobMotion,
  writeMobMotionCheckpoint,
  writeMobMotionPoses,
} from "../shared/mobMotionAuthority.ts";

const flatHeight = () => 6;
const clientSpawns = createMobSpawns({
  seed: MOB_WORLD_SEED,
  radius: 16,
  terrainHeight: flatHeight,
  isSpawnable: () => true,
  maxPopulation: 16,
  passivePopulation: 12,
  hostilePopulation: 4,
  spawnClearRadius: 6,
});
const serverSpawns = canonicalMobSpawnSnapshot(flatHeight, () => true);
assert.deepEqual(
  clientSpawns.map(({ id: mobId, kind, x, y, z, yaw }) => ({ mobId, kind, x, y, z, yaw })),
  serverSpawns,
  "client and Lakebed must derive the exact same hostile slots and spawn poses",
);
assert.deepEqual(
  serverSpawns.slice(12).map(({ kind }) => kind).sort(),
  ["creeper", "skeleton", "spider", "zombie"],
  "the bounded canonical hostile population includes one of each implemented hostile",
);

const shared = createMobMotionState({
  seed: MOB_WORLD_SEED,
  epoch: 12_345,
  snapshot: [{ mobId: "creeper-5nb-0", kind: "creeper", x: 0, y: 7, z: 0 }],
});
assert.ok(shared);
const nearby = { isNight: true, targets: [{ userId: "player", x: 2, y: 7, z: 0 }] } as const;
stepMobMotion(shared, nearby);
let sharedMob = shared.mobs[0];
assert.equal(sharedMob.behavior, "fuse");
assert.equal(sharedMob.fuseStartedTick, 1);
assert.equal(sharedMob.fuseUntilTick, 1 + CREEPER_FUSE_TICKS);
const primedX = sharedMob.x;
for (let tick = 0; tick < 5; tick += 1) stepMobMotion(shared, nearby);
assert.equal(sharedMob.x, primedX, "a primed creeper stops moving");
assert.ok(writeMobMotionPoses(shared)[0].fuseProgress > 0);

stepMobMotion(shared, { isNight: true, targets: [{ userId: "player", x: 10, y: 7, z: 0 }] });
assert.equal(sharedMob.fuseStartedTick, 0, "escaping before completion cancels the deterministic fuse");
assert.equal(sharedMob.behavior, "chase");

const currentPose = writeMobMotionPoses(shared)[0];
stepMobMotion(shared, {
  isNight: true,
  targets: [{ userId: "player", x: currentPose.x, y: currentPose.y, z: currentPose.z }],
});
sharedMob = shared.mobs[0];
const restartedAt = sharedMob.fuseStartedTick;
for (let tick = 0; tick < CREEPER_FUSE_TICKS; tick += 1) stepMobMotion(shared, {
  isNight: true,
  targets: [{ userId: "player", x: currentPose.x, y: currentPose.y, z: currentPose.z }],
});
assert.equal(sharedMob.fuseStartedTick, restartedAt, "a fuse has one stable logical start tick");
assert.equal(isCreeperFuseDue(sharedMob, shared.tick), true);
assert.equal(writeMobMotionPoses(shared)[0].fuseProgress, 1);
stepMobMotion(shared, { isNight: true, targets: [] });
assert.equal(isCreeperFuseDue(sharedMob, shared.tick), true, "a completed fuse remains latched for exact-once explosion authority");
assert.ok(restoreMobMotionCheckpoint(writeMobMotionCheckpoint(shared)), "latched fuse state survives a checkpoint round trip");

const local = createMobSimulation([{
  id: "creeper-test",
  kind: "creeper",
  x: 0,
  y: 1,
  z: 0,
  yaw: 0,
  homeX: 0,
  homeZ: 0,
  behaviorSeed: 99,
}]);
const localStep = (player: { x: number; y: number; z: number }) => stepMobSimulation(local, {
  dtSeconds: 0.1,
  isNight: true,
  terrainHeight: () => 0,
  player,
});
localStep({ x: 2, y: 1, z: 0 });
const localMob = local.mobs[0];
assert.equal(localMob.behavior, "fuse");
for (let tick = 0; tick < 5; tick += 1) localStep({ x: 2, y: 1, z: 0 });
assert.ok(writeMobPoseSnapshots(local)[0].fuseProgress > 0);
localStep({ x: 10, y: 1, z: 0 });
assert.equal(localMob.fuseStartedAtSeconds, 0, "single-player prediction also cancels an escaped fuse");
localStep({ x: localMob.x, y: localMob.y, z: localMob.z });
for (let tick = 0; tick < CREEPER_FUSE_TICKS; tick += 1) {
  localStep({ x: localMob.x, y: localMob.y, z: localMob.z });
}
assert.equal(writeMobPoseSnapshots(local)[0].fuseProgress, 1);
const dueX = localMob.x;
localStep({ x: 20, y: 1, z: 0 });
assert.equal(localMob.x, dueX, "completed local fuse stays put for the future explosion hook");

console.log("lakecraft deterministic creeper behavior tests: ok");
