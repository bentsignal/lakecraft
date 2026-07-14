import assert from "node:assert/strict";
import {
  MAX_MOB_ATTACK_DAMAGE,
  MAX_MOB_AUTHORITY_QUERY_IDS,
  MOB_AUTHORITY_WORLD_SEED_TOKEN,
  MOB_ATTACK_COOLDOWN_MS,
  MOB_AUTHORITY_DEFINITIONS,
  MOB_RESPAWN_MS,
  defaultMobAuthorityState,
  deterministicMobDrops,
  materializeMobAuthorityState,
  resolveMobAttack,
  validateMobDamage,
  validateMobIdList,
  validateMobIdentity,
  type StoredMobAuthorityState,
} from "../shared/mobCombat.ts";

assert.deepEqual(validateMobIdentity("pig-5nf-0"), { ok: true, mobId: "pig-5nf-0", kind: "pig" });
assert.deepEqual(validateMobIdentity("skeleton-5nf-4"), { ok: true, mobId: "skeleton-5nf-4", kind: "skeleton" });
assert.equal(validateMobIdentity("pig-5nf-0", "pig").ok, true);
assert.equal(validateMobIdentity("pig-5nf-0", "cow").ok, false);
assert.equal(validateMobIdentity("pig-5nb-0", "pig", MOB_AUTHORITY_WORLD_SEED_TOKEN).ok, true);
assert.equal(validateMobIdentity("pig-5nf-0", "pig", MOB_AUTHORITY_WORLD_SEED_TOKEN).ok, false);
assert.equal(validateMobIdentity("pig-5nb-1s").ok, false, "slot 64 exceeds the bounded deterministic population");
for (const malformed of ["pig", "Pig-5nf-0", "dragon-5nf-0", "pig-*-0", "pig-5nf-0000", ""]) {
  assert.equal(validateMobIdentity(malformed).ok, false, `${malformed} should be rejected`);
}

assert.deepEqual(validateMobIdList(["zombie-5nf-3", "pig-5nf-0", "pig-5nf-0"]), {
  ok: true,
  mobIds: ["pig-5nf-0", "zombie-5nf-3"],
});
assert.equal(validateMobIdList("pig-5nf-0").ok, false);
assert.equal(validateMobIdList(["invalid"]).ok, false);
assert.equal(
  validateMobIdList(Array.from({ length: MAX_MOB_AUTHORITY_QUERY_IDS + 1 }, (_, index) => `pig-5nf-${index.toString(36)}`)).ok,
  false,
);

assert.equal(validateMobDamage("1"), 1);
assert.equal(validateMobDamage(MAX_MOB_ATTACK_DAMAGE), MAX_MOB_ATTACK_DAMAGE);
for (const damage of ["0", "1.5", "NaN", "Infinity", String(MAX_MOB_ATTACK_DAMAGE + 1), -1]) {
  assert.equal(validateMobDamage(damage), null);
}
assert.equal(defaultMobAuthorityState("sheep-5nf-1", "sheep").health, MOB_AUTHORITY_DEFINITIONS.sheep.maxHealth);
assert.equal(defaultMobAuthorityState("zombie-5nf-2", "zombie").health, 20);
assert.equal(defaultMobAuthorityState("skeleton-5nf-3", "skeleton").health, 20);

const first = resolveMobAttack({
  rawMobId: "pig-5nf-0",
  rawKind: "pig",
  rawDamage: "5",
  attackerId: "alice",
  serverNow: 1_000,
});
assert.equal(first.ok, true);
assert.ok(first.ok);
assert.equal(first.killed, false);
assert.equal(first.state.health, 5);
assert.equal(first.state.revision, 1);
assert.equal(first.state.lastAttackerId, "alice");
assert.deepEqual(first.drops, []);

const rapidRetry = resolveMobAttack({
  stored: first.nextRow,
  rawMobId: "pig-5nf-0",
  rawKind: "pig",
  rawDamage: 5,
  attackerId: "alice",
  serverNow: 1_000 + MOB_ATTACK_COOLDOWN_MS - 1,
});
assert.deepEqual(rapidRetry.ok && rapidRetry, false);
assert.equal(rapidRetry.ok, false);
assert.ok(!rapidRetry.ok);
assert.equal(rapidRetry.reason, "cooldown");
assert.equal(rapidRetry.retryAfterMs, 1);

const fatal = resolveMobAttack({
  stored: first.nextRow,
  rawMobId: "pig-5nf-0",
  rawKind: "pig",
  rawDamage: 5,
  attackerId: "bob",
  serverNow: 1_000 + MOB_ATTACK_COOLDOWN_MS,
});
assert.equal(fatal.ok, true);
assert.ok(fatal.ok);
assert.equal(fatal.killed, true);
assert.equal(fatal.state.health, 0);
assert.equal(fatal.state.revision, 2);
assert.equal(fatal.state.lastAttackerId, "bob");
assert.equal(fatal.state.deadUntil, 1_000 + MOB_ATTACK_COOLDOWN_MS + MOB_RESPAWN_MS);
assert.deepEqual(fatal.drops, deterministicMobDrops("pig-5nf-0", "pig", 2));
assert.ok(fatal.drops.length > 0);

const duplicateKill = resolveMobAttack({
  stored: fatal.nextRow,
  rawMobId: "pig-5nf-0",
  rawKind: "pig",
  rawDamage: 5,
  attackerId: "bob",
  serverNow: 2_000,
});
assert.equal(duplicateKill.ok, false);
assert.ok(!duplicateKill.ok);
assert.equal(duplicateKill.reason, "dead");
assert.equal("drops" in duplicateKill, false, "a retry against a dead mob must never duplicate drops");

const beforeRespawn = materializeMobAuthorityState(fatal.nextRow, "pig-5nf-0", "pig", fatal.state.deadUntil - 1);
assert.equal(beforeRespawn.health, 0);
const respawned = materializeMobAuthorityState(fatal.nextRow, "pig-5nf-0", "pig", fatal.state.deadUntil);
assert.equal(respawned.health, 10);
assert.equal(respawned.deadUntil, 0);
assert.equal(respawned.revision, 2);

const afterRespawnAttack = resolveMobAttack({
  stored: fatal.nextRow,
  rawMobId: "pig-5nf-0",
  rawKind: "pig",
  rawDamage: 3,
  attackerId: "alice",
  serverNow: fatal.state.deadUntil,
});
assert.equal(afterRespawnAttack.ok, true);
assert.ok(afterRespawnAttack.ok);
assert.equal(afterRespawnAttack.state.health, 7);
assert.equal(afterRespawnAttack.state.revision, 3);

const skeletonHit = resolveMobAttack({
  rawMobId: "skeleton-5nf-4",
  rawKind: "skeleton",
  rawDamage: 12,
  attackerId: "alice",
  serverNow: 10_000,
});
assert.ok(skeletonHit.ok);
const skeletonFatal = resolveMobAttack({
  stored: skeletonHit.ok ? skeletonHit.nextRow : undefined,
  rawMobId: "skeleton-5nf-4",
  rawKind: "skeleton",
  rawDamage: 8,
  attackerId: "alice",
  serverNow: 10_000 + MOB_ATTACK_COOLDOWN_MS,
});
assert.ok(skeletonFatal.ok && skeletonFatal.killed);
assert.deepEqual(
  skeletonFatal.ok ? skeletonFatal.drops : [],
  deterministicMobDrops("skeleton-5nf-4", "skeleton", 2),
);
if (skeletonFatal.ok) {
  assert.ok(skeletonFatal.drops.every((drop) => drop.itemId === "stick" && drop.count <= 2));
}

const corrupted: StoredMobAuthorityState = {
  mobId: "cow-5nf-2",
  kind: "cow",
  health: "999999",
  revision: "broken",
  deadUntil: "-1",
  lastAttackAt: "NaN",
  lastAttackerId: "x".repeat(300),
};
const recovered = materializeMobAuthorityState(corrupted, "cow-5nf-2", "cow", 5_000);
assert.equal(recovered.health, 10);
assert.equal(recovered.revision, 0);
assert.equal(recovered.deadUntil, 0);
assert.equal(recovered.lastAttackAt, 0);
assert.equal(recovered.lastAttackerId.length, 128);

assert.equal(resolveMobAttack({
  rawMobId: "cow-5nf-2",
  rawKind: "pig",
  rawDamage: 2,
  attackerId: "alice",
  serverNow: 1,
}).ok, false);
assert.equal(resolveMobAttack({
  rawMobId: "cow-5nf-2",
  rawKind: "cow",
  rawDamage: 0,
  attackerId: "alice",
  serverNow: 1,
}).ok, false);

for (const kind of ["pig", "cow", "sheep", "zombie", "skeleton"] as const) {
  const a = deterministicMobDrops(`${kind}-5nf-0`, kind, 9);
  const b = deterministicMobDrops(`${kind}-5nf-0`, kind, 9);
  assert.deepEqual(b, a);
  for (const drop of a) assert.ok(drop.count > 0 && drop.count <= 3);
}

console.log("lakecraft sparse mob authority tests: ok");
