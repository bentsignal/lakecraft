import assert from "node:assert/strict";
import {
  PLAYER_ATTACK_COOLDOWN_MS,
  PLAYER_COMBAT_PRESENCE_FRESH_MS,
  PLAYER_MELEE_REACH,
  PLAYER_RESPAWN_DELAY_MS,
  authoritativeCombatPose,
  authoritativeWeapon,
  decidePlayerCombatReplay,
  defaultPlayerCombatState,
  materializePlayerCombatState,
  mitigatedPlayerDamage,
  resolvePlayerAttack,
  selectPlayerCombatReceiptOverflow,
  storedPlayerCombatRow,
  validatePlayerAttackRequestJson,
  validatePlayerCombatUserIds,
  validatePlayerMeleeSpatialAuthority,
  type CombatPose,
  type StoredPlayerCombatState,
} from "../shared/playerCombat.ts";
import { PLAYER_STATE_VERSION, validatePlayerStateJson } from "../shared/chestTransfers.ts";
import { ITEMS, createEmptyEquipment, createEmptyInventory } from "../shared/game.ts";

const operationId = "attack_1234567890";
const requestJson = JSON.stringify({
  operationId,
  targetUserId: "bob",
  selectedHotbar: 0,
  weaponItemId: "diamond_sword",
});
const validated = validatePlayerAttackRequestJson(requestJson);
assert.ok(validated.ok);
if (!validated.ok) throw new Error("expected valid attack request");
assert.equal(validated.request.fingerprint, JSON.stringify([operationId, "bob", 0, "diamond_sword"]));

for (const [value, reason] of [
  ["{", "invalid_json"],
  [JSON.stringify({ operationId, targetUserId: "bob", selectedHotbar: 0 }), "invalid_shape"],
  [JSON.stringify({ operationId: "short", targetUserId: "bob", selectedHotbar: 0, weaponItemId: "" }), "invalid_operation_id"],
  [JSON.stringify({ operationId, targetUserId: "", selectedHotbar: 0, weaponItemId: "" }), "invalid_target"],
  [JSON.stringify({ operationId, targetUserId: "bob", selectedHotbar: 9, weaponItemId: "" }), "invalid_selected_hotbar"],
  [JSON.stringify({ operationId, targetUserId: "bob", selectedHotbar: 0, weaponItemId: "admin_sword" }), "invalid_weapon"],
] as const) {
  const result = validatePlayerAttackRequestJson(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, reason);
}
assert.equal(validatePlayerAttackRequestJson("x".repeat(513)).ok, false);

const now = 10_000;
function pose(userId: string, x: number, y: number, z: number, yaw = 0, pitch = 0): CombatPose {
  return { userId, x, y, z, yaw, pitch, heartbeatAt: now, online: true };
}
const attackerPose = pose("alice", 0, 0, 0);
const targetPose = pose("bob", 0, 0, -3);
assert.deepEqual(validatePlayerMeleeSpatialAuthority(attackerPose, targetPose), { ok: true });
assert.equal(validatePlayerMeleeSpatialAuthority(attackerPose, pose("bob", 3, 0, 0)).reason, "not_aimed");
assert.equal(validatePlayerMeleeSpatialAuthority(attackerPose, pose("bob", 0, 0, PLAYER_MELEE_REACH + 1)).reason, "out_of_reach");
assert.equal(validatePlayerMeleeSpatialAuthority(attackerPose, pose("bob", 0, 4, -2)).reason, "out_of_reach");
assert.deepEqual(
  validatePlayerMeleeSpatialAuthority(pose("alice", 0, 0, 0, 0, -0.44), pose("bob", 0, -2, -4.1)),
  { ok: true },
  "Lakebed validates a legitimate crouched-eye melee ray without trusting a new client posture field",
);

const storedPresence = {
  userId: "alice",
  x: "0",
  y: "2",
  z: "-1",
  yaw: "0",
  pitch: "0",
  heartbeatAt: String(now - PLAYER_COMBAT_PRESENCE_FRESH_MS),
  online: true,
};
assert.ok(authoritativeCombatPose(storedPresence, "alice", now));
assert.equal(authoritativeCombatPose({ ...storedPresence, heartbeatAt: String(now - PLAYER_COMBAT_PRESENCE_FRESH_MS - 1) }, "alice", now), null);
assert.equal(authoritativeCombatPose({ ...storedPresence, online: false }, "alice", now), null);
assert.equal(authoritativeCombatPose({ ...storedPresence, x: "NaN" }, "alice", now), null);
assert.equal(authoritativeCombatPose(storedPresence, "mallory", now), null, "a presence row cannot be relabeled as another user");

const attackerInventory = createEmptyInventory();
attackerInventory[0] = { itemId: "diamond_sword", count: 1 };
const attackerStateValidation = validatePlayerStateJson(JSON.stringify({
  version: 2,
  inventory: attackerInventory,
  selectedHotbar: 0,
  equipment: createEmptyEquipment(),
  respawnPoint: null,
  hunger: 20,
}));
assert.ok(attackerStateValidation.ok);
if (!attackerStateValidation.ok) throw new Error("expected valid attacker state");

const diamondEquipment = {
  head: { itemId: "diamond_helmet", durability: 1 },
  chest: { itemId: "diamond_chestplate", durability: ITEMS.diamond_chestplate.armor!.maxDurability },
  legs: { itemId: "diamond_leggings", durability: 17 },
  feet: { itemId: "diamond_boots", durability: 9 },
};
const targetStateValidation = validatePlayerStateJson(JSON.stringify({
  version: PLAYER_STATE_VERSION,
  inventory: createEmptyInventory(),
  selectedHotbar: 0,
  equipment: diamondEquipment,
  respawnPoint: null,
  hunger: 20,
}));
assert.ok(targetStateValidation.ok);
if (!targetStateValidation.ok) throw new Error("expected valid target state");

assert.deepEqual(authoritativeWeapon(attackerStateValidation.state, 0, "diamond_sword"), {
  ok: true,
  itemId: "diamond_sword",
  damage: 7,
});
assert.equal(authoritativeWeapon(attackerStateValidation.state, 1, "diamond_sword").ok, false);
assert.equal(authoritativeWeapon(attackerStateValidation.state, 0, "wooden_sword").ok, false);
assert.equal(mitigatedPlayerDamage(7, 0), 7);
assert.equal(mitigatedPlayerDamage(7, 20), 2, "twenty armor points mitigate eighty percent, rounded up");
assert.equal(mitigatedPlayerDamage(1, 20), 1, "a landed melee hit always deals at least half a heart");

const first = resolvePlayerAttack({
  request: validated.request,
  attackerId: "alice",
  attackerPresence: attackerPose,
  targetPresence: targetPose,
  attackerPlayerState: attackerStateValidation.state,
  targetPlayerState: targetStateValidation.state,
  serverNow: now,
});
assert.ok(first.ok);
if (!first.ok) throw new Error("expected successful attack");
assert.equal(first.baseDamage, 7);
assert.equal(first.armorProtection, 20);
assert.equal(first.damage, 2);
assert.equal(first.targetState.health, 18);
assert.equal(first.targetState.revision, 1);
assert.equal(first.targetState.lastAttackerId, "alice");
assert.equal(first.attackerState.lastAttackAt, now);
assert.deepEqual(first.armorDamaged, ["head", "chest", "legs", "feet"]);
assert.deepEqual(first.brokenArmor, [{ slot: "head", itemId: "diamond_helmet" }]);
assert.equal(first.targetEquipment.head, null);
assert.equal(first.targetEquipment.chest?.durability, ITEMS.diamond_chestplate.armor!.maxDurability - 1);
assert.equal(first.targetEquipment.legs?.durability, 16);
assert.equal(first.targetEquipment.feet?.durability, 8);

const cooldown = resolvePlayerAttack({
  request: validated.request,
  attackerId: "alice",
  attackerStored: first.attackerRow,
  targetStored: first.targetRow,
  attackerPresence: attackerPose,
  targetPresence: targetPose,
  attackerPlayerState: attackerStateValidation.state,
  targetPlayerState: targetStateValidation.state,
  serverNow: now + PLAYER_ATTACK_COOLDOWN_MS - 1,
});
assert.equal(cooldown.ok, false);
if (!cooldown.ok) {
  assert.equal(cooldown.reason, "cooldown");
  assert.equal(cooldown.retryAfterMs, 1);
}

const spoofedSlot = resolvePlayerAttack({
  request: { ...validated.request, selectedHotbar: 1 },
  attackerId: "alice",
  attackerPresence: attackerPose,
  targetPresence: targetPose,
  attackerPlayerState: attackerStateValidation.state,
  targetPlayerState: targetStateValidation.state,
  serverNow: now,
});
assert.equal(spoofedSlot.ok, false);
if (!spoofedSlot.ok) assert.equal(spoofedSlot.reason, "weapon_mismatch");

const spoofedWeapon = resolvePlayerAttack({
  request: { ...validated.request, weaponItemId: "wooden_sword" },
  attackerId: "alice",
  attackerPresence: attackerPose,
  targetPresence: targetPose,
  attackerPlayerState: attackerStateValidation.state,
  targetPlayerState: targetStateValidation.state,
  serverNow: now,
});
assert.equal(spoofedWeapon.ok, false);
if (!spoofedWeapon.ok) assert.equal(spoofedWeapon.reason, "weapon_mismatch");

for (const [partial, reason] of [
  [{ attackerId: "bob" }, "self_target"],
  [{ attackerPresence: null }, "active_attacker_presence_required"],
  [{ targetPresence: null }, "active_target_presence_required"],
  [{ targetPresence: pose("bob", 3, 0, 0) }, "not_aimed"],
  [{ targetPresence: pose("bob", 0, 0, -6) }, "out_of_reach"],
] as const) {
  const result = resolvePlayerAttack({
    request: validated.request,
    attackerId: "alice",
    attackerPresence: attackerPose,
    targetPresence: targetPose,
    attackerPlayerState: attackerStateValidation.state,
    targetPlayerState: targetStateValidation.state,
    serverNow: now,
    ...partial,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, reason);
}

const unarmoredState = validatePlayerStateJson("[]");
assert.ok(unarmoredState.ok);
if (!unarmoredState.ok) throw new Error("expected legacy empty state to validate");
const nearlyDead: StoredPlayerCombatState = {
  userId: "bob",
  health: "5",
  revision: "8",
  deadUntil: "0",
  lastAttackAt: "0",
  lastAttackerId: "mallory",
};
const fatal = resolvePlayerAttack({
  request: validated.request,
  attackerId: "alice",
  targetStored: nearlyDead,
  attackerPresence: attackerPose,
  targetPresence: targetPose,
  attackerPlayerState: attackerStateValidation.state,
  targetPlayerState: unarmoredState.state,
  serverNow: now,
});
assert.ok(fatal.ok && fatal.killed);
if (!fatal.ok) throw new Error("expected fatal attack");
assert.equal(fatal.targetState.health, 0);
assert.equal(fatal.targetState.revision, 9);
assert.equal(fatal.targetState.deadUntil, now + PLAYER_RESPAWN_DELAY_MS);

const duplicateDeath = resolvePlayerAttack({
  request: validated.request,
  attackerId: "alice",
  targetStored: fatal.targetRow,
  attackerPresence: attackerPose,
  targetPresence: targetPose,
  attackerPlayerState: attackerStateValidation.state,
  targetPlayerState: unarmoredState.state,
  serverNow: now + 1,
});
assert.equal(duplicateDeath.ok, false);
if (!duplicateDeath.ok) assert.equal(duplicateDeath.reason, "target_dead");
assert.equal(materializePlayerCombatState(fatal.targetRow, "bob", fatal.targetState.deadUntil - 1).health, 0);
const respawned = materializePlayerCombatState(fatal.targetRow, "bob", fatal.targetState.deadUntil);
assert.equal(respawned.health, 0, "timer expiry alone never revives a player without a revisioned mutation");
assert.equal(respawned.deadUntil, fatal.targetState.deadUntil);
assert.equal(respawned.revision, 9);

const deadAttacker = storedPlayerCombatRow({
  ...defaultPlayerCombatState("alice"),
  health: 0,
  deadUntil: now + 1_000,
});
const deadAttack = resolvePlayerAttack({
  request: validated.request,
  attackerId: "alice",
  attackerStored: deadAttacker,
  attackerPresence: attackerPose,
  targetPresence: targetPose,
  attackerPlayerState: attackerStateValidation.state,
  targetPlayerState: unarmoredState.state,
  serverNow: now,
});
assert.equal(deadAttack.ok, false);
if (!deadAttack.ok) assert.equal(deadAttack.reason, "attacker_dead");

assert.equal(decidePlayerCombatReplay(null, "a"), "new");
assert.equal(decidePlayerCombatReplay("a", "a"), "replay");
assert.equal(decidePlayerCombatReplay("a", "b"), "operation_id_reused");
const receipts = Array.from({ length: 70 }, (_, index) => ({
  id: `receipt-${index}`,
  operationId: `operation-${index}`,
  fingerprint: `fingerprint-${index}`,
  receiptCreatedAt: String(70 - index),
}));
const overflow = selectPlayerCombatReceiptOverflow(receipts, "receipt-new");
assert.equal(overflow.length, 7, "64 retained rows include the just-committed receipt");
assert.ok(!overflow.includes("receipt-new"));

assert.deepEqual(validatePlayerCombatUserIds(["bob", "alice", "bob"]), { ok: true, userIds: ["alice", "bob"] });
assert.equal(validatePlayerCombatUserIds("alice").ok, false);
assert.equal(validatePlayerCombatUserIds(Array.from({ length: 129 }, (_, index) => `user-${index}`)).ok, false);

const corrupted = materializePlayerCombatState({
  userId: "bob",
  health: "999",
  revision: "bad",
  deadUntil: "-1",
  lastAttackAt: "NaN",
  lastAttackerId: "x".repeat(300),
}, "bob", now);
assert.equal(corrupted.health, 20);
assert.equal(corrupted.revision, 0);
assert.equal(corrupted.deadUntil, 0);
assert.equal(corrupted.lastAttackerId.length, 128);

console.log("lakecraft authoritative player combat tests: ok");
