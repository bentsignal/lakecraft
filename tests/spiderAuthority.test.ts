import assert from "node:assert/strict";
import {
  MOB_AUTHORITY_DEFINITIONS,
  deterministicMobDrops,
  resolveMobAttack,
  validateMobIdentity,
} from "../shared/mobCombat.ts";
import {
  MOB_MOTION_MAX_REPLAY_TICKS,
  MOB_MOTION_UNITS_PER_BLOCK,
  createMobMotionState,
  hashMobMotionCheckpoint,
  replayMobMotion,
  restoreMobMotionCheckpoint,
  serializeMobMotionCheckpoint,
  stepMobMotion,
  writeMobMotionCheckpoint,
} from "../shared/mobMotionAuthority.ts";
import {
  MOB_DEFINITIONS,
  consumeMobContactDamage,
  createMobSimulation,
  createMobSpawns,
  damageMob,
  stepMobSimulation,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";

const spiderId = "spider-5nb-6";
assert.deepEqual(validateMobIdentity(spiderId, "spider", "5nb"), {
  ok: true,
  mobId: spiderId,
  kind: "spider",
});
for (const forged of ["Spider-5nb-6", "spider-5nb-1s", "spider-wrong-6", "zombie-5nb-6"]) {
  assert.equal(validateMobIdentity(forged, "spider", "5nb").ok, false, `${forged} must not alias a spider`);
}
assert.equal(MOB_AUTHORITY_DEFINITIONS.spider.maxHealth, 16);
assert.equal(MOB_DEFINITIONS.spider.maxHealth, 16);
assert.equal(MOB_DEFINITIONS.spider.height, 0.8);
assert.equal(MOB_DEFINITIONS.spider.targetRadius, 0.72);
assert.deepEqual(MOB_DEFINITIONS.spider.drops, MOB_AUTHORITY_DEFINITIONS.spider.drops);

const spawn = { mobId: spiderId, kind: "spider" as const, x: 0, y: 8, z: 0, yaw: 0 };
const dayState = createMobMotionState({ seed: 7319, epoch: 1_000, snapshot: [spawn] });
assert.ok(dayState);
stepMobMotion(dayState, { isNight: false, targets: [{ userId: "alex", x: 3, y: 8, z: 0 }] });
assert.equal(dayState.mobs[0].behavior, "dormant", "spiders stay passive in daylight");
assert.equal(dayState.mobs[0].targetUserId, "");
assert.equal(dayState.mobs[0].x, 0);

const nightState = createMobMotionState({ seed: 7319, epoch: 1_000, snapshot: [spawn] });
assert.ok(nightState);
stepMobMotion(nightState, { isNight: true, targets: [{ userId: "alex", x: 3, y: 8, z: 0 }] });
assert.equal(nightState.mobs[0].behavior, "chase");
assert.equal(nightState.mobs[0].targetUserId, "alex");
assert.ok(nightState.mobs[0].x > 0);
assert.ok(nightState.mobs[0].x <= 124, "one fixed tick uses the bounded spider chase speed");

function tenMinuteReplay() {
  const state = createMobMotionState({ seed: 7319, epoch: 2_000, snapshot: [spawn] });
  assert.ok(state);
  assert.ok(replayMobMotion(state, {
    isNight: true,
    targets: [{ userId: "alex", x: 12, y: 8, z: -4 }],
  }, MOB_MOTION_MAX_REPLAY_TICKS));
  return state;
}
const replayA = tenMinuteReplay();
const replayB = tenMinuteReplay();
const checkpointA = writeMobMotionCheckpoint(replayA);
const bytesA = serializeMobMotionCheckpoint(checkpointA);
assert.equal(serializeMobMotionCheckpoint(writeMobMotionCheckpoint(replayB)), bytesA);
assert.equal(hashMobMotionCheckpoint(writeMobMotionCheckpoint(replayB)), hashMobMotionCheckpoint(checkpointA));
assert.ok(bytesA.length < 512, "one spider checkpoint stays compact");
assert.deepEqual(restoreMobMotionCheckpoint(JSON.parse(JSON.stringify(checkpointA))), replayA);
const forgedCheckpoint = JSON.parse(JSON.stringify(checkpointA));
forgedCheckpoint.mobs[0].kind = "zombie";
assert.equal(restoreMobMotionCheckpoint(forgedCheckpoint), null, "checkpoint identity kind cannot be forged");

const localSpawnsA = createMobSpawns({
  seed: 7319,
  radius: 16,
  terrainHeight: () => 6,
  passivePopulation: 0,
  hostilePopulation: 4,
  maxPopulation: 4,
  isSpawnable: () => true,
});
const localSpawnsB = createMobSpawns({
  seed: 7319,
  radius: 16,
  terrainHeight: () => 6,
  passivePopulation: 0,
  hostilePopulation: 4,
  maxPopulation: 4,
  isSpawnable: () => true,
});
assert.deepEqual(localSpawnsB, localSpawnsA, "offline hostile spawning is deterministic");
assert.deepEqual(new Set(localSpawnsA.map(({ kind }) => kind)), new Set(["zombie", "skeleton", "creeper", "spider"]));

const localSpider: MobSpawnDescriptor = {
  id: spiderId,
  kind: "spider",
  x: 0,
  y: 7,
  z: 0,
  yaw: 0,
  homeX: 0,
  homeZ: 0,
  behaviorSeed: 97,
};
const local = createMobSimulation([localSpider]);
const player = { x: 0.4, y: 7, z: 0 };
assert.equal(consumeMobContactDamage(local, player, 0, false), 0, "offline spider melee is dark-only");
assert.equal(consumeMobContactDamage(local, player, 0, true), 2);
assert.equal(consumeMobContactDamage(local, player, 0.9, true), 0, "offline melee has a deterministic cooldown");
assert.equal(consumeMobContactDamage(local, player, 1, true), 2);
stepMobSimulation(local, { dtSeconds: 0.1, isNight: false, terrainHeight: () => 6, player });
assert.equal(local.mobs[0].behavior, "dormant");
stepMobSimulation(local, { dtSeconds: 0.1, isNight: true, terrainHeight: () => 6, player });
assert.equal(local.mobs[0].behavior, "chase");

const killedLocally = damageMob(local, spiderId, 16);
assert.equal(killedLocally.killed, true);
assert.ok(killedLocally.drops.every(({ itemId, count }) => itemId === "string" && count >= 1 && count <= 2));
assert.deepEqual(damageMob(local, spiderId, 16).drops, [], "a local spider death cannot mint string twice");

const firstAuthorityHit = resolveMobAttack({
  rawMobId: spiderId,
  rawKind: "spider",
  rawDamage: 8,
  attackerId: "alex",
  serverNow: 1_000,
});
assert.ok(firstAuthorityHit.ok);
const authorityKill = resolveMobAttack({
  stored: firstAuthorityHit.ok ? firstAuthorityHit.nextRow : null,
  rawMobId: spiderId,
  rawKind: "spider",
  rawDamage: 8,
  attackerId: "alex",
  serverNow: 1_300,
});
assert.ok(authorityKill.ok && authorityKill.killed);
assert.deepEqual(authorityKill.ok ? authorityKill.drops : [], deterministicMobDrops(spiderId, "spider", 2));
const duplicateAuthorityKill = resolveMobAttack({
  stored: authorityKill.ok ? authorityKill.nextRow : null,
  rawMobId: spiderId,
  rawKind: "spider",
  rawDamage: 8,
  attackerId: "alex",
  serverNow: 1_600,
});
assert.equal(duplicateAuthorityKill.ok, false);
assert.equal("drops" in duplicateAuthorityKill, false, "a dead authority row cannot mint string twice");

console.log(JSON.stringify({
  benchmark: "deterministic spider authority replay",
  ticks: MOB_MOTION_MAX_REPLAY_TICKS,
  unitsPerBlock: MOB_MOTION_UNITS_PER_BLOCK,
  checkpointBytes: bytesA.length,
  replayHash: hashMobMotionCheckpoint(checkpointA),
}));
console.log("lakecraft spider authority/offline parity tests: ok");
