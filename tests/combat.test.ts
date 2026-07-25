import assert from "node:assert/strict";
import {
  MAX_CONTACT_DAMAGE_PER_TICK,
  MOB_COMBAT_AUTHORITY,
  applyAuthoritativeMobCombatStates,
  consumeMobContactDamage,
  createMobSimulation,
  damageMob,
  mobTargetHasClickPriority,
  raycastMobs,
  respawnExpiredAuthoritativeMobs,
  shearLocalMob,
  writeMobPoseSnapshots,
  type MobKind,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";

assert.equal(MOB_COMBAT_AUTHORITY, "lakebed-optional");
assert.equal(mobTargetHasClickPriority(2.9, 3), true, "a mob in front of a block gets click priority");
assert.equal(mobTargetHasClickPriority(3.1, 3), false, "a closer block occludes the mob");
assert.equal(mobTargetHasClickPriority(3, null), true);

function spawn(kind: MobKind, id: string, x: number, y: number, z: number): MobSpawnDescriptor {
  return { id, kind, x, y, z, yaw: 0, homeX: x, homeZ: z, behaviorSeed: id.length * 101 + x * 17 + z * 31 };
}

const targeting = createMobSimulation([
  spawn("pig", "far-pig", 0, 0, 5),
  spawn("zombie", "near-zombie", 0, 0, 3),
  spawn("cow", "off-axis-cow", 2, 0, 2),
]);
const forwardHit = raycastMobs([0, 0.7, 0], [0, 0, 4], targeting.mobs, 6);
assert.equal(forwardHit?.id, "near-zombie", "a non-normalized ray should select the nearest crosshair mob");
assert.ok(forwardHit && forwardHit.distance > 2.5 && forwardHit.distance < 3);
assert.equal(raycastMobs([0, 0.7, 0], [0, 0, 1], targeting.mobs, 2), null, "reach must be enforced");
assert.equal(raycastMobs([0, 0.7, 0], [0, 0, 0], targeting.mobs, 6), null, "zero-length rays cannot hit");

damageMob(targeting, "near-zombie", 100);
assert.equal(raycastMobs([0, 0.7, 0], [0, 0, 1], targeting.mobs, 6)?.id, "far-pig", "dead mobs are not targetable");
assert.equal(raycastMobs([0, 0.7, 0], [1, 0, 0], targeting.mobs, 6), null, "off-axis mobs should not be selected");
assert.equal(raycastMobs([0, 0.5, 5], [0, 1, 0], targeting.mobs, 2)?.distance, 0, "a ray starting in a hitbox should hit immediately");

const deterministicDeathA = createMobSimulation([spawn("cow", "drop-cow", 0, 0, 0)]);
const deterministicDeathB = createMobSimulation([spawn("cow", "drop-cow", 0, 0, 0)]);
const deathA = damageMob(deterministicDeathA, "drop-cow", 20);
const deathB = damageMob(deterministicDeathB, "drop-cow", 20);
assert.equal(deathA.killed, true);
assert.deepEqual(deathB.drops, deathA.drops, "death drops must remain deterministic");
assert.equal(damageMob(deterministicDeathA, "drop-cow", 20).killed, false, "a dead mob cannot drop twice");

const clipping = createMobSimulation([spawn("sheep", "clip-sheep", 0, 0, 0)]);
let acceptedWool = 0;
const clipped = shearLocalMob(clipping, "clip-sheep", (count) => {
  acceptedWool = count;
  return true;
});
assert.deepEqual(clipped, { ok: true, woolCount: acceptedWool });
assert.ok(acceptedWool >= 1 && acceptedWool <= 3);
assert.equal(clipping.mobs[0].sheared, true);
assert.deepEqual(shearLocalMob(clipping, "clip-sheep", () => true), { ok: false, reason: "already_sheared" }, "one sheep cannot pay wool twice");
const clippedDeath = damageMob(clipping, "clip-sheep", 100);
assert.equal(clippedDeath.drops.some((drop) => drop.itemId === "wool"), false, "a clipped sheep does not duplicate wool on death");
assert.equal(clipping.mobs[0].sheared, false, "death clears local sheared state for a future respawn");
const rejectedClip = createMobSimulation([spawn("sheep", "full-pack-sheep", 0, 0, 0)]);
assert.deepEqual(shearLocalMob(rejectedClip, "full-pack-sheep", () => false), { ok: false, reason: "rejected" });
assert.equal(rejectedClip.mobs[0].sheared, false, "inventory rejection preserves the woolly state");

const contact = createMobSimulation([
  spawn("zombie", "zombie-a", 0, 0, 0),
  spawn("zombie", "zombie-b", 0.1, 0, 0.1),
  spawn("zombie", "zombie-c", 0.2, 0, 0.2),
  spawn("pig", "nearby-pig", 0, 0, 0),
]);
const player = { x: 0, y: 0, z: 0 };
assert.equal(consumeMobContactDamage(contact, player, 0, false), 0, "zombies cannot contact-damage by day");
assert.equal(
  consumeMobContactDamage(contact, player, 0, true),
  MAX_CONTACT_DAMAGE_PER_TICK,
  "aggregate contact damage must be bounded even when surrounded",
);
assert.equal(consumeMobContactDamage(contact, player, 0.5, true), 0, "per-zombie cooldown prevents rapid repeated damage");
assert.equal(consumeMobContactDamage(contact, player, 1, true), MAX_CONTACT_DAMAGE_PER_TICK);
assert.equal(consumeMobContactDamage(contact, { x: 3, y: 0, z: 3 }, 2, true), 0, "contact damage requires overlap");
assert.equal(consumeMobContactDamage(contact, player, 2, true, 3), 3, "callers may lower the aggregate damage cap");

const authority = createMobSimulation([spawn("cow", "cow-authority", 4, 1, -3)]);
const authoritativeCow = authority.mobs[0];
const partial = applyAuthoritativeMobCombatStates(authority, [{
  mobId: authoritativeCow.id,
  kind: "cow",
  health: 6,
  maxHealth: 10,
  revision: 1,
  deadUntil: 0,
  sheared: false,
}], 10_000);
assert.deepEqual(partial, { applied: 1, stale: 0, invalid: 0, unknown: 0 });
assert.equal(authoritativeCow.health, 6);
assert.equal(authoritativeCow.alive, true);

const stale = applyAuthoritativeMobCombatStates(authority, [{
  mobId: authoritativeCow.id,
  kind: "cow",
  health: 1,
  maxHealth: 10,
  revision: 1,
  deadUntil: 0,
  sheared: true,
}], 10_000);
assert.equal(stale.stale, 1);
assert.equal(authoritativeCow.health, 6, "equal or older revisions cannot roll health backward");

const killed = applyAuthoritativeMobCombatStates(authority, [{
  mobId: authoritativeCow.id,
  kind: "cow",
  health: 0,
  maxHealth: 10,
  revision: 2,
  deadUntil: 12_000,
  sheared: false,
}], 10_000);
assert.equal(killed.applied, 1);
assert.equal(authoritativeCow.alive, false);
assert.equal(writeMobPoseSnapshots(authority).length, 0);
assert.equal(respawnExpiredAuthoritativeMobs(authority, 11_999), 0);
assert.equal(respawnExpiredAuthoritativeMobs(authority, 12_000), 1);
assert.equal(authoritativeCow.alive, true);
assert.equal(authoritativeCow.health, 10);
assert.deepEqual(
  { x: authoritativeCow.x, y: authoritativeCow.y, z: authoritativeCow.z },
  { x: 4, y: 1, z: -3 },
  "expired deaths respawn at the deterministic home pose",
);
assert.equal(applyAuthoritativeMobCombatStates(authority, [{
  mobId: authoritativeCow.id,
  kind: "cow",
  health: 0,
  maxHealth: 10,
  revision: 2,
  deadUntil: 12_000,
  sheared: false,
}], 12_001).stale, 1, "an old death snapshot cannot kill a locally expired respawn again");
assert.equal(authoritativeCow.alive, true);

const rejected = applyAuthoritativeMobCombatStates(authority, [
  { mobId: authoritativeCow.id, kind: "pig", health: 10, maxHealth: 10, revision: 3, deadUntil: 0, sheared: false },
  { mobId: "unknown", kind: "cow", health: 10, maxHealth: 10, revision: 1, deadUntil: 0, sheared: false },
], 12_001);
assert.deepEqual(rejected, { applied: 0, stale: 0, invalid: 1, unknown: 1 });

const authoritySheep = createMobSimulation([spawn("sheep", "sheep-authority", 0, 0, 2)]);
assert.equal(applyAuthoritativeMobCombatStates(authoritySheep, [{
  mobId: "sheep-authority",
  kind: "sheep",
  health: 8,
  maxHealth: 8,
  revision: 1,
  deadUntil: 0,
  sheared: true,
}], 20_000).applied, 1);
assert.equal(writeMobPoseSnapshots(authoritySheep)[0].sheared, true, "Lakebed sheared state reaches the retained pose snapshot");
assert.equal(applyAuthoritativeMobCombatStates(authoritySheep, [{
  mobId: "sheep-authority",
  kind: "sheep",
  health: 0,
  maxHealth: 8,
  revision: 2,
  deadUntil: 21_000,
  sheared: false,
}], 20_000).applied, 1);
assert.equal(respawnExpiredAuthoritativeMobs(authoritySheep, 21_000), 1);
assert.equal(authoritySheep.mobs[0].sheared, false, "authority death/respawn restores a woolly sheep");

console.log("lakecraft combat model tests: ok");
