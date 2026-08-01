import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MOB_WORLD_CHECKPOINT_MS,
  MOB_WORLD_LEASE_MS,
  MOB_WORLD_SEED,
  advanceMobWorldState,
  canonicalMobSpawnSnapshot,
  creeperExplosionClaims,
  dueMobDamageClaim,
  encodeMobWorldCheckpoint,
  encodeMobWorldReplayInput,
  parseMobWorldReplayInputJson,
  resolveMobDamage,
  validateMobDamageRequestJson,
  validateMobWorldCheckpointRequestJson,
} from "../server/mobWorldAuthority.ts";
import { createMobMotionState, replayMobMotion, writeMobMotionPoses } from "../shared/mobMotionAuthority.ts";

assert.equal(MOB_WORLD_CHECKPOINT_MS, 30_000);
assert.equal(MOB_WORLD_LEASE_MS, 60_000);
assert.deepEqual(
  validateMobWorldCheckpointRequestJson(JSON.stringify({
    leaseId: "lease_0123456789abcdef",
    expectedRevision: 4,
  })),
  { leaseId: "lease_0123456789abcdef", expectedRevision: 4 },
);
assert.equal(validateMobWorldCheckpointRequestJson(JSON.stringify({
  leaseId: "lease_0123456789abcdef",
  expectedRevision: 4,
  checkpointJson: "untrusted",
})), null);

const spawns = canonicalMobSpawnSnapshot(() => 6, () => true);
assert.equal(spawns.length, 16);
assert.ok(spawns.every((spawn, index) => spawn.mobId.endsWith(`-${index.toString(36)}`)));
const state = createMobMotionState({ seed: MOB_WORLD_SEED, epoch: 1_000, snapshot: spawns });
assert.ok(state);
const stored = {
  authorityKey: "main",
  ownerUserId: "owner",
  leaseId: "lease_0123456789abcdef",
  leaseExpiresAt: "31000",
  checkpointJson: encodeMobWorldCheckpoint(state!),
  inputJson: encodeMobWorldReplayInput({ isNight: true, targets: [] })!,
  checkpointRevision: "7",
  checkpointAt: "1000",
};
const advanced = advanceMobWorldState(stored, 11_000, { isNight: true, targets: [] });
assert.ok(advanced);
assert.equal(advanced!.ticks, 100);
assert.equal(advanced!.state.tick, 100);

const inputA = encodeMobWorldReplayInput({
  isNight: true,
  targets: [
    { userId: "z-user", x: 1.0001, y: 2, z: 3, active: true },
    { userId: "a-user", x: 4, y: 5, z: 6, active: true },
  ],
});
const inputB = encodeMobWorldReplayInput({
  isNight: true,
  targets: [
    { userId: "a-user", x: 4, y: 5, z: 6, active: true },
    { userId: "z-user", x: 1.0001, y: 2, z: 3, active: true },
  ],
});
assert.equal(inputA, inputB, "persisted replay inputs must be canonical and order independent");
assert.deepEqual(parseMobWorldReplayInputJson(inputA!), JSON.parse(inputA!));
assert.equal(
  encodeMobWorldReplayInput({
    isNight: true,
    targets: [
      { userId: "same-user", x: 9, y: 5, z: 6, active: true },
      { userId: "same-user", x: 1, y: 5, z: 6, active: true },
    ],
  }),
  encodeMobWorldReplayInput({
    isNight: true,
    targets: [
      { userId: "same-user", x: 1, y: 5, z: 6, active: true },
      { userId: "same-user", x: 9, y: 5, z: 6, active: true },
    ],
  }),
  "duplicate-user replay input is independent of database arrival order",
);
const hostile = spawns.find((spawn) => spawn.kind === "zombie" || spawn.kind === "skeleton")!;
const combatState = createMobMotionState({ seed: MOB_WORLD_SEED, epoch: 2_000, snapshot: [hostile] })!;
const target = { userId: "target", x: hostile.x, y: hostile.y, z: hostile.z, active: true };
let claim = null;
for (let tick = 0; tick < 64 && !claim; tick += 1) {
  replayMobMotion(combatState, { isNight: true, targets: [target] }, 1);
  claim = dueMobDamageClaim(writeMobMotionPoses(combatState)[0], target, combatState.epoch, 3, combatState.tick);
}
assert.ok(claim, "a nearby hostile should produce one deterministic cadence claim");
const sameLogicalClaim = dueMobDamageClaim(
  writeMobMotionPoses(combatState)[0],
  target,
  combatState.epoch,
  4,
  combatState.tick,
);
assert.equal(
  sameLogicalClaim?.operationId,
  claim!.operationId,
  "a cadence hit keeps one receipt identity across a checkpoint revision boundary",
);
const request = {
  operationId: claim!.operationId,
  mobId: claim!.mobId,
  checkpointRevision: claim!.checkpointRevision,
  tick: claim!.tick,
};
assert.deepEqual(validateMobDamageRequestJson(JSON.stringify(request)), request);
assert.deepEqual(resolveMobDamage(combatState, request, target, 3, 20), {
  ok: true,
  damage: claim!.damage,
  health: 20 - claim!.damage,
  killed: false,
});
assert.deepEqual(resolveMobDamage(combatState, request, target, 3, 20, 20), {
  ok: true,
  damage: 1,
  health: 19,
  killed: false,
}, "mob damage mitigation is derived from authoritative armor protection");
assert.equal(resolveMobDamage(combatState, { ...request, operationId: `${request.operationId}x` }, target, 3, 20).ok, false);

const creeper = spawns.find((spawn) => spawn.kind === "creeper")!;
assert.ok(creeper, "the canonical four-hostile population includes a creeper");
const creeperState = createMobMotionState({ seed: MOB_WORLD_SEED, epoch: 3_000, snapshot: [creeper] })!;
replayMobMotion(creeperState, {
  isNight: true,
  targets: [{ userId: "target", x: creeper.x, y: creeper.y, z: creeper.z }],
}, 20);
assert.equal(
  dueMobDamageClaim(writeMobMotionPoses(creeperState)[0], target, creeperState.epoch, 3, creeperState.tick),
  null,
  "a completed creeper fuse must never degrade into repeating contact-damage cadence",
);
const explosionClaims = creeperExplosionClaims(creeperState, 3);
assert.equal(explosionClaims.length, 1, "a latched due fuse exposes one deterministic global claim");
assert.equal(explosionClaims[0].mobId, creeper.mobId);
assert.equal(explosionClaims[0].fuseStartedTick, creeperState.mobs[0].fuseStartedTick);

const spider = spawns.find((spawn) => spawn.kind === "spider")!;
assert.ok(spider, "the canonical four-hostile population includes a spider");
const spiderState = createMobMotionState({ seed: MOB_WORLD_SEED, epoch: 4_000, snapshot: [spider] })!;
const spiderTarget = { userId: "spider-target", x: spider.x, y: spider.y, z: spider.z, active: true };
let spiderClaim = null;
for (let tick = 0; tick < 32 && !spiderClaim; tick += 1) {
  replayMobMotion(spiderState, { isNight: true, targets: [spiderTarget] }, 1);
  spiderClaim = dueMobDamageClaim(writeMobMotionPoses(spiderState)[0], spiderTarget, spiderState.epoch, 5, spiderState.tick);
}
assert.ok(spiderClaim, "a nearby spider produces a bounded deterministic melee claim");
assert.equal(spiderClaim!.damage, 2);

const chicken = spawns.find((spawn) => spawn.kind === "chicken")!;
assert.ok(chicken, "the canonical twelve-passive population includes a chicken");

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.ok(server.includes("spider: [0.8, 0.72]"), "ranged authority uses the spider's low, wide hit bounds");
for (const marker of [
  "mobWorldAuthority: table({",
  "mobWorldAuthority: query(async",
  "checkpointMobWorld: mutation(async",
  "claimMobPlayerDamage: mutation(async",
  "claimCreeperExplosion: mutation(async",
  "creeperExplosionReceipts: table({",
  'reason: "authoritative_death_required"',
  "storedPlayerCombatRow({",
  ".filter((claim) => aliveMobIds.has(claim.mobId))",
  "reason: BS.mobDead",
  "parseMobWorldReplayInputJson(stored.inputJson)",
  'mob.kind === "spider"',
  'mob.kind === "chicken"',
  "needsCurrentMobTopology || serverNow - advanced.checkpointAt >= MOB_WORLD_CHECKPOINT_MS",
]) assert.ok(server.includes(marker), `missing server integration marker: ${marker}`);
assert.equal((server.match(/mobWorldAuthority: table\(\{/g) ?? []).length, 1, "authority checkpoint must remain singleton-shaped");
const checkpointMutation = server.slice(server.indexOf("checkpointMobWorld: mutation(async"), server.indexOf("claimMobPlayerDamage: mutation(async"));
assert.ok(checkpointMutation.includes("const needsCurrentMobTopology"));
assert.ok(checkpointMutation.includes("? createCanonicalMobWorldState("), "a spiderless retained alpha checkpoint is reseeded once through the existing lease mutation");
assert.ok(checkpointMutation.includes("checkpointJson: encodeMobWorldCheckpoint(nextState)"));

const mobDamageMutation = server.slice(server.indexOf("claimMobPlayerDamage: mutation(async"), server.indexOf("attackMob: mutation(async"));
for (const marker of [
  "validatePlayerStateJson(inventoryRow.inventoryJson)",
  "equippedArmorProtection(playerStateAtEvent.equipment)",
  "applyConfirmedArmorDamage(playerStateAtEvent.equipment)",
  "ctx.db.inventories.update(inventoryRow.id",
  "brokenArmor: armorDamage.broken",
  "inventory: persistedInventory",
  "inventoryRevision",
]) assert.ok(mobDamageMutation.includes(marker), `missing authoritative mob armor marker: ${marker}`);
assert.ok(
  mobDamageMutation.indexOf("decidePlayerCombatReplay") < mobDamageMutation.indexOf("applyConfirmedArmorDamage"),
  "receipt replay must return before armor can wear again",
);

const creeperMutation = server.slice(
  server.indexOf("claimCreeperExplosion: mutation(async"),
  server.indexOf("rangedCombat: mutation(async"),
);
for (const marker of [
  "validateCreeperExplosionRequestJson(requestJson)",
  'newestByIndex(ctx.db.creeperExplosionReceipts, "by_event", (q) => q.eq("eventId", request.operationId))',
  "authorizeCreeperExplosionRequest(request, authority)",
  "applyAuthoritativeWorldExplosion(ctx.db",
  "checkpointRevision: String(advanced.revision + 1)",
  "motionMob.fuseStartedTick = 0",
]) assert.ok(creeperMutation.includes(marker), `missing authoritative creeper explosion marker: ${marker}`);
assert.ok(
  creeperMutation.indexOf("creeperExplosionReceipts") < creeperMutation.indexOf("ctx.db.mobWorldAuthority"),
  "global exact replay must return before mutable authority reads",
);
assert.ok(
  creeperMutation.indexOf("applyAuthoritativeWorldExplosion(ctx.db") < creeperMutation.indexOf("ctx.db.mobWorldAuthority.update"),
  "the shared bounded blast transaction settles before the creeper checkpoint",
);
const explosionHelper = server.slice(server.indexOf("async function applyAuthoritativeWorldExplosion"), server.indexOf("function databaseRowToStoredMobAuthority"));
for (const marker of ["planCreeperTerrainDestruction", "maintainWorldChunkSnapshots(db, written)", 'blockType: "air"', "mitigatedPlayerDamage"]) {
  assert.ok(explosionHelper.includes(marker), `missing shared explosion executor marker: ${marker}`);
}
assert.ok(mobDamageMutation.includes("inventory: replayInventoryRows[0]"), "receipt replay returns the latest canonical inventory row without reapplying wear");
assert.ok(
  mobDamageMutation.indexOf("ctx.db.inventories.update(inventoryRow.id") < mobDamageMutation.indexOf("ctx.db.playerCombatReceipts.insert"),
  "mob armor wear and breakage must persist before the exact-once receipt",
);

const attackMobMutation = server.slice(server.indexOf("attackMob: mutation(async"), server.indexOf("attackPlayer: mutation(async"));
assert.ok(attackMobMutation.includes("operationId: string"));
assert.ok(attackMobMutation.includes("playerCombatReceipts"));
assert.ok(attackMobMutation.includes("replayed: true"));
assert.ok(attackMobMutation.includes("replayed: false"));
assert.ok(attackMobMutation.includes("authoritativeCombatPose"));
assert.ok(attackMobMutation.includes("reason: BS.attackerDead"));
assert.ok(attackMobMutation.includes("validatePlayerMeleeSpatialAuthority"));
assert.ok(attackMobMutation.includes("attackDamage(selectedItemId)"));
assert.ok(attackMobMutation.includes("applyConfirmedToolUse"));
assert.ok(attackMobMutation.includes("ctx.db.inventories.update"));
assert.ok(attackMobMutation.includes("inventory: inventoryRows[0]"));
assert.ok(attackMobMutation.indexOf("existingReceipt") < attackMobMutation.indexOf("ctx.db.mobAuthority"));

console.log("mob world server authority tests passed");
