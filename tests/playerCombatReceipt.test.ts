import assert from "node:assert/strict";
import { decodePlayerCombatReceipt, encodePlayerCombatReceipt, type PlayerCombatReceiptResult } from "../server/playerCombat.ts";
import { createEmptyEquipment } from "../shared/game.ts";
import { defaultPlayerCombatState, storedPlayerCombatRow } from "../shared/playerCombat.ts";

const attackerState = { ...defaultPlayerCombatState("alice"), lastAttackAt: 1_000 };
const targetState = { ...defaultPlayerCombatState("bob"), health: 18, revision: 1, lastAttackerId: "alice" };
const result: PlayerCombatReceiptResult = {
  ok: true,
  replayed: false,
  killed: false,
  weaponItemId: "diamond_sword",
  baseDamage: 7,
  damage: 2,
  armorProtection: 20,
  armorDamaged: ["head", "chest", "legs", "feet"],
  brokenArmor: [{ slot: "head", itemId: "diamond_helmet" }],
  targetEquipment: createEmptyEquipment(),
  attackerState,
  targetState,
  attackerRow: storedPlayerCombatRow(attackerState),
  targetRow: storedPlayerCombatRow(targetState),
  serverNow: 1_000,
  targetInventoryRevision: "8",
};

const replay = decodePlayerCombatReceipt(encodePlayerCombatReceipt(result));
assert.ok(replay);
assert.equal(replay.replayed, true);
assert.equal(replay.targetInventoryRevision, "8");
assert.deepEqual(replay.armorDamaged, ["head", "chest", "legs", "feet"]);
assert.deepEqual(replay.brokenArmor, [{ slot: "head", itemId: "diamond_helmet" }]);

for (const invalid of [
  { ...result, targetInventoryRevision: "bad" },
  { ...result, armorDamaged: null },
  { ...result, brokenArmor: null },
  { ...result, targetEquipment: null },
]) assert.equal(decodePlayerCombatReceipt(JSON.stringify(invalid)), null);

console.log("lakecraft player combat receipt replay tests: ok");
