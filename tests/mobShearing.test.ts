import assert from "node:assert/strict";
import {
  MOB_RESPAWN_MS,
  defaultMobAuthorityState,
  deterministicSheepShearDrops,
  materializeMobAuthorityState,
  resolveMobAttack,
  resolveMobShear,
} from "../shared/mobCombat.ts";

const mobId = "sheep-5nf-1";
const initial = defaultMobAuthorityState(mobId, "sheep");
assert.equal(initial.sheared, false);

const first = resolveMobShear({
  rawMobId: mobId,
  rawKind: "sheep",
  rawHeldItem: "shears",
  serverNow: 1_000,
});
assert.ok(first.ok);
assert.equal(first.state.health, initial.health, "shearing deals no damage");
assert.equal(first.state.revision, 1);
assert.equal(first.state.sheared, true);
assert.deepEqual(first.drops, deterministicSheepShearDrops(mobId, 1));
assert.equal(first.drops[0].itemId, "wool");
assert.ok(first.drops[0].count >= 1 && first.drops[0].count <= 3);

const deterministicRetry = resolveMobShear({
  rawMobId: mobId,
  rawKind: "sheep",
  rawHeldItem: "shears",
  serverNow: 1_000,
});
assert.deepEqual(deterministicRetry, first, "an unapplied authority retry resolves identically for receipt replay");

const duplicateDistinctOperation = resolveMobShear({
  stored: first.nextRow,
  rawMobId: mobId,
  rawKind: "sheep",
  rawHeldItem: "shears",
  serverNow: 1_001,
});
assert.deepEqual(duplicateDistinctOperation.ok && duplicateDistinctOperation, false);
assert.ok(!duplicateDistinctOperation.ok);
assert.equal(duplicateDistinctOperation.reason, "already_sheared");
assert.equal("drops" in duplicateDistinctOperation, false, "a sheared sheep cannot mint duplicate wool");

assert.deepEqual(resolveMobShear({
  rawMobId: "cow-5nf-2",
  rawKind: "cow",
  rawHeldItem: "shears",
  serverNow: 1,
}), { ok: false, reason: "wrong_mob" });
assert.deepEqual(resolveMobShear({
  rawMobId: mobId,
  rawKind: "sheep",
  rawHeldItem: "iron_sword",
  serverNow: 1,
}), { ok: false, reason: "invalid_tool" });

const fatal = resolveMobAttack({
  stored: first.nextRow,
  rawMobId: mobId,
  rawKind: "sheep",
  rawDamage: initial.maxHealth,
  attackerId: "alice",
  serverNow: 2_000,
});
assert.ok(fatal.ok && fatal.killed);
assert.equal(fatal.state.sheared, false, "death clears the sheared coat state");
assert.equal(fatal.drops.some((drop) => drop.itemId === "wool"), false, "a sheared sheep cannot drop a second coat on death");
assert.equal(fatal.drops.some((drop) => drop.itemId === "mutton"), true, "shearing does not suppress normal meat drops");
const whileDead = resolveMobShear({
  stored: fatal.nextRow,
  rawMobId: mobId,
  rawKind: "sheep",
  rawHeldItem: "shears",
  serverNow: 2_000 + MOB_RESPAWN_MS - 1,
});
assert.ok(!whileDead.ok);
assert.equal(whileDead.reason, "dead");
assert.equal(whileDead.retryAfterMs, 1);

const respawned = materializeMobAuthorityState(
  fatal.nextRow,
  mobId,
  "sheep",
  2_000 + MOB_RESPAWN_MS,
);
assert.equal(respawned.health, initial.maxHealth);
assert.equal(respawned.sheared, false, "respawn restores a full wool coat");
const afterRespawn = resolveMobShear({
  stored: fatal.nextRow,
  rawMobId: mobId,
  rawKind: "sheep",
  rawHeldItem: "shears",
  serverNow: 2_000 + MOB_RESPAWN_MS,
});
assert.ok(afterRespawn.ok);
assert.equal(afterRespawn.state.revision, fatal.state.revision + 1);

const legacy = materializeMobAuthorityState({
  mobId,
  kind: "sheep",
  health: "8",
  revision: "4",
  deadUntil: "0",
  lastAttackAt: "0",
  lastAttackerId: "",
}, mobId, "sheep", 10_000);
assert.equal(legacy.sheared, false, "rows created before coat authority default safely to unsheared");

for (let revision = 1; revision <= 64; revision += 1) {
  const a = deterministicSheepShearDrops(mobId, revision);
  const b = deterministicSheepShearDrops(mobId, revision);
  assert.deepEqual(a, b);
  assert.ok(a[0].count >= 1 && a[0].count <= 3);
}

console.log("lakecraft deterministic sheep shearing tests: ok");
