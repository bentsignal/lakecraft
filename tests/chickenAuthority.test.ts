import assert from "node:assert/strict";
import {
  MOB_AUTHORITY_DEFINITIONS,
  deterministicMobDrops,
  resolveMobAttack,
  validateMobIdentity,
} from "../shared/mobCombat.ts";
import {
  MOB_MOTION_MAX_REPLAY_TICKS,
  createMobMotionState,
  hashMobMotionCheckpoint,
  replayMobMotion,
  writeMobMotionCheckpoint,
} from "../shared/mobMotionAuthority.ts";
import { canonicalMobSpawnSnapshot } from "../server/mobWorldAuthority.ts";
import {
  MOB_DEFINITIONS,
  createMobSimulation,
  createMobSpawns,
  damageMob,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";

const chickenId = "chicken-5nb-3";
assert.deepEqual(validateMobIdentity(chickenId, "chicken", "5nb"), {
  ok: true,
  mobId: chickenId,
  kind: "chicken",
});
for (const forged of ["Chicken-5nb-3", "chicken-5nb-1s", "chicken-wrong-3", "cow-5nb-3"]) {
  assert.equal(validateMobIdentity(forged, "chicken", "5nb").ok, false, `${forged} must not alias a chicken`);
}
assert.equal(MOB_AUTHORITY_DEFINITIONS.chicken.maxHealth, 4);
assert.equal(MOB_DEFINITIONS.chicken.maxHealth, 4);
assert.equal(MOB_DEFINITIONS.chicken.height, 0.8);
assert.equal(MOB_DEFINITIONS.chicken.targetRadius, 0.38);
assert.equal(MOB_DEFINITIONS.chicken.passive, true);
assert.deepEqual(MOB_DEFINITIONS.chicken.drops, MOB_AUTHORITY_DEFINITIONS.chicken.drops);

const localSpawns = createMobSpawns({
  seed: 7319,
  radius: 16,
  terrainHeight: () => 6,
  passivePopulation: 12,
  hostilePopulation: 4,
  maxPopulation: 16,
  isSpawnable: () => true,
});
const serverSpawns = canonicalMobSpawnSnapshot(() => 6, () => true);
assert.deepEqual(
  localSpawns.map(({ id, kind, x, y, z, yaw }) => ({ mobId: id, kind, x, y, z, yaw })),
  serverSpawns,
  "offline and Lakebed canonical populations must remain bit-for-bit identical",
);
assert.equal(localSpawns.length, 16);
assert.deepEqual(
  new Set(localSpawns.slice(0, 12).map(({ kind }) => kind)),
  new Set(["pig", "cow", "sheep", "chicken"]),
);
assert.deepEqual(
  new Set(localSpawns.slice(12).map(({ kind }) => kind)),
  new Set(["zombie", "skeleton", "creeper", "spider"]),
);

const canonicalChicken = serverSpawns.find(({ kind }) => kind === "chicken")!;
const motionA = createMobMotionState({ seed: 7319, epoch: 1_000, snapshot: [canonicalChicken] });
const motionB = createMobMotionState({ seed: 7319, epoch: 1_000, snapshot: [canonicalChicken] });
assert.ok(motionA && motionB);
assert.ok(replayMobMotion(motionA, { isNight: false, targets: [{ userId: "alex", x: 0, y: 7, z: 0 }] }, MOB_MOTION_MAX_REPLAY_TICKS));
assert.ok(replayMobMotion(motionB, { isNight: true, targets: [{ userId: "alex", x: 0, y: 7, z: 0 }] }, MOB_MOTION_MAX_REPLAY_TICKS));
assert.equal(motionA.mobs[0].targetUserId, "", "chickens never acquire player targets");
assert.equal(motionB.mobs[0].targetUserId, "", "night does not turn a passive chicken hostile");
assert.equal(hashMobMotionCheckpoint(writeMobMotionCheckpoint(motionA)), hashMobMotionCheckpoint(writeMobMotionCheckpoint(motionB)));

const localChicken: MobSpawnDescriptor = {
  id: chickenId,
  kind: "chicken",
  x: 0,
  y: 7,
  z: 0,
  yaw: 0,
  homeX: 0,
  homeZ: 0,
  behaviorSeed: 97,
};
const local = createMobSimulation([localChicken]);
const localKill = damageMob(local, chickenId, 4);
assert.equal(localKill.killed, true);
assert.ok(localKill.drops.every(({ itemId, count }) => itemId === "feather" && count >= 1 && count <= 2));
assert.deepEqual(damageMob(local, chickenId, 4).drops, [], "a local chicken death cannot mint feathers twice");

const authorityKill = resolveMobAttack({
  rawMobId: chickenId,
  rawKind: "chicken",
  rawDamage: 4,
  attackerId: "alex",
  serverNow: 1_000,
});
assert.ok(authorityKill.ok && authorityKill.killed);
assert.deepEqual(authorityKill.ok ? authorityKill.drops : [], deterministicMobDrops(chickenId, "chicken", 1));
const duplicateKill = resolveMobAttack({
  stored: authorityKill.ok ? authorityKill.nextRow : null,
  rawMobId: chickenId,
  rawKind: "chicken",
  rawDamage: 4,
  attackerId: "alex",
  serverNow: 1_300,
});
assert.equal(duplicateKill.ok, false);
assert.equal("drops" in duplicateKill, false, "a dead authority row cannot mint feathers twice");

console.log(JSON.stringify({
  benchmark: "deterministic chicken authority replay",
  ticks: MOB_MOTION_MAX_REPLAY_TICKS,
  population: serverSpawns.length,
  replayHash: hashMobMotionCheckpoint(writeMobMotionCheckpoint(motionA)),
}));
console.log("lakecraft chicken authority/offline parity tests: ok");
