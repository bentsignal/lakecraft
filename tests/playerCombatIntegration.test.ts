import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

for (const required of [
  "playerCombat: table({",
  'playerCombatReceipts: table({',
  '.index("by_user_operation", ["userId", "operationId"])',
  '.index("by_user_created", ["userId", "receiptCreatedAt"])',
  "playerCombatStates: query(async",
  "attackPlayer: mutation(async",
  "validatePlayerAttackRequestJson(requestJson)",
  "authoritativeCombatPose(attackerPresenceRow",
  "authoritativeCombatPose(targetPresenceRow",
  "validatePlayerStateJson(attackerInventoryRow.inventoryJson)",
  "validatePlayerStateJson(targetInventoryRow.inventoryJson",
  "resolution.armorDamaged.length > 0",
  "const weaponUse = applyConfirmedToolUse(",
  "inventory: weaponUse.inventory",
  "attackerInventory: persistedAttackerInventory",
  "attackerInventoryRevision: persistedAttackerInventory.revision",
  "weaponDamaged: weaponUse.used",
  "weaponBroken: weaponUse.broke",
  "equipment: resolution.targetEquipment",
  "targetInventoryRevision",
  "resolvePlayerAttack({",
  "maintainPlayerCombatReceipts(",
]) assert.ok(server.includes(required), `missing player-combat server integration: ${required}`);

const mutation = server.slice(
  server.indexOf("attackPlayer: mutation(async"),
  server.indexOf("claimUsername: mutation(async"),
);
assert.ok(mutation.length > 0);
assert.equal(mutation.includes("rawDamage"), false, "the client must never submit authoritative PvP damage");
assert.equal(mutation.includes("request.x"), false, "the client must never submit authoritative attacker coordinates");
assert.equal(mutation.includes("request.y"), false, "the client must never submit authoritative attacker coordinates");
assert.equal(mutation.includes("request.z"), false, "the client must never submit authoritative attacker coordinates");
assert.ok(
  mutation.indexOf("decidePlayerCombatReplay") < mutation.indexOf("resolvePlayerAttack"),
  "successful retry receipts must be checked before any damage resolution",
);
assert.ok(
  mutation.indexOf("validatePlayerStateJson(attackerInventoryRow.inventoryJson)") < mutation.indexOf("resolvePlayerAttack"),
  "weapon authority must come from validated persisted inventory",
);
assert.ok(
  mutation.indexOf("validatePlayerStateJson(targetInventoryRow.inventoryJson") < mutation.indexOf("resolvePlayerAttack"),
  "armor authority must come from validated persisted equipment",
);
assert.equal(
  (mutation.match(/ctx\.db\.playerCombat\.(?:update|insert)/g) ?? []).length,
  4,
  "both attacker cooldown and target health are transactionally upserted",
);
assert.ok(
  mutation.indexOf("ctx.db.inventories.update(attackerInventoryRow.id") < mutation.indexOf("ctx.db.playerCombatReceipts.insert"),
  "attacker weapon wear and breakage must persist before the exact-once receipt",
);
assert.ok(
  mutation.indexOf("ctx.db.inventories.update(targetInventoryRow.id") < mutation.indexOf("ctx.db.playerCombatReceipts.insert"),
  "target armor wear and breakage must persist before the exact-once receipt",
);
assert.ok(
  mutation.indexOf("ctx.db.playerCombat.update") < mutation.indexOf("ctx.db.playerCombatReceipts.insert"),
  "the receipt records the result after both combat state transitions in the same transaction",
);

const query = server.slice(
  server.indexOf("playerCombatStates: query(async"),
  server.indexOf("mutations: {"),
);
assert.ok(query.includes("validatePlayerCombatUserIds(rawUserIds)"), "combat state fanout must remain bounded");
assert.ok(query.includes("materializePlayerCombatState"), "combat queries read canonical state without background writes");
assert.ok(!query.includes("health: deadUntil"), "queries never synthesize an unrevisioned respawn");

console.log("lakecraft player combat Lakebed integration tests: ok");
