import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

assert.match(
  server,
  /mobAuthority: table\(\{[\s\S]*?sheared: string\(\)\.default\("false"\)[\s\S]*?\}\)\.index\("by_mob"/,
  "prelaunch mob authority schema defaults existing and new sheep to a full coat",
);

const shearStart = server.indexOf("shearMob: mutation(async");
const attackStart = server.indexOf("attackMob: mutation(async");
assert.ok(shearStart >= 0 && attackStart > shearStart, "Lakebed capsule exports the sheep shearing mutation");
const mutation = server.slice(shearStart, attackStart);

for (const marker of [
  "ctx.auth.isAuthenticated",
  "ctx.auth.isGuest",
  "validateMobIdentity(rawMobId, rawKind, MOB_AUTHORITY_WORLD_SEED_TOKEN)",
  'JSON.stringify(["mob_shear", identity.mobId, identity.kind])',
  "decidePlayerCombatReplay",
  "authoritativeCombatPose",
  "materializePlayerCombatState",
  'reason: "attacker_dead"',
  "validatePlayerStateJson(inventoryRow.inventoryJson)",
  "writeMobMotionPoses",
  "validatePlayerMeleeSpatialAuthority",
  "resolveMobShear",
  "applyConfirmedDurableItemUse",
  '"shears"',
  "addItem(nextInventory, drop.itemId, drop.count)",
  'reason: "inventory_full"',
  "ctx.db.mobAuthority.update",
  "ctx.db.mobAuthority.insert",
  "ctx.db.inventories.update",
  "ctx.db.playerCombatReceipts.insert",
  "maintainPlayerCombatReceipts",
]) assert.ok(mutation.includes(marker), `missing authoritative shearing marker: ${marker}`);

assert.ok(
  mutation.indexOf("decidePlayerCombatReplay") < mutation.indexOf("ctx.db.playerPresence"),
  "an exact retry resolves before reading mutable player or mob authority",
);
assert.ok(
  mutation.includes("inventory: inventoryRows[0]"),
  "accepted retries return the current canonical inventory without repeating wool or durability writes",
);
assert.ok(
  mutation.indexOf("added.remainder !== 0") < mutation.indexOf("ctx.db.mobAuthority.update"),
  "insufficient inventory capacity rejects before wool, durability, or sheep state is persisted",
);
assert.ok(
  mutation.indexOf("ctx.db.mobAuthority.update") < mutation.indexOf("ctx.db.playerCombatReceipts.insert"),
  "the sheared coat transition commits before its exact-once receipt",
);
assert.ok(
  mutation.indexOf("ctx.db.inventories.update") < mutation.indexOf("ctx.db.playerCombatReceipts.insert"),
  "wool grant and the one durability use commit before the exact-once receipt",
);
assert.equal((mutation.match(/applyConfirmedDurableItemUse/g) ?? []).length, 1, "one accepted shear spends one tool use");
assert.doesNotMatch(mutation, /setInterval|setTimeout|fetch\(/, "shearing adds no polling, timer, or alternate backend");

console.log("Lakebed exact-once sheep-shearing server integration tests passed");
