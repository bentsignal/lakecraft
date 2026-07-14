import assert from "node:assert/strict";
import {
  MAX_CONTACT_DAMAGE_PER_TICK,
  MOB_COMBAT_AUTHORITY,
  consumeMobContactDamage,
  createMobSimulation,
  damageMob,
  mobTargetHasClickPriority,
  raycastMobs,
  type MobKind,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";

assert.equal(MOB_COMBAT_AUTHORITY, "client-only");
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

console.log("lakecraft combat model tests: ok");
