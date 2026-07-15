import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const inventoryDrawer = readFileSync(new URL("../client/components/InventoryDrawer.tsx", import.meta.url), "utf8");

const updateEquipment = client.slice(
  client.indexOf("function updateEquipment("),
  client.indexOf("function recordConfirmedToolUse", client.indexOf("function updateEquipment(")),
);
assert.ok(updateEquipment.includes("equipmentRef.current = next"));
assert.ok(updateEquipment.includes("setEquipment(next)"));

const canonicalLoad = client.slice(
  client.indexOf("function loadCanonicalPlayer("),
  client.indexOf("function requestInventorySave", client.indexOf("function loadCanonicalPlayer(")),
);
assert.ok(canonicalLoad.includes("validatePlayerStateJson(row.inventoryJson)"), "canonical loads fail closed instead of clamping corrupt armor");
assert.equal(canonicalLoad.includes("parseSerializablePlayerStateJson"), false);
assert.ok(canonicalLoad.includes("previous && !saved.equipment[slot]"));
assert.ok(canonicalLoad.includes("armor pieces broke"));
assert.ok(canonicalLoad.includes('"warning"'));

const mobDamage = client.slice(
  client.indexOf("void claimMobPlayerDamage("),
  client.indexOf("}, [mobWorldAuthority", client.indexOf("void claimMobPlayerDamage(")),
);
assert.ok(mobDamage.includes("loadCanonicalPlayer(result.inventory, true)"), "mob damage reconciles armor from the same Lakebed transaction");

const savedInventoryReconciliation = client.slice(
  client.indexOf("latestSavedInventoryRef.current = savedInventory"),
  client.indexOf("}, [savedInventory, auth.userId]"),
);
assert.ok(
  savedInventoryReconciliation.includes("loadCanonicalPlayer(savedInventory, true)"),
  "authoritative PvP wear arriving through the existing inventory query can report armor breakage",
);

const saveConflictReconciliation = client.slice(
  client.indexOf('result.reason === "conflict"'),
  client.indexOf('result.reason === "authentication_required"'),
);
assert.ok(
  saveConflictReconciliation.includes("loadCanonicalPlayer(result.inventory, true)"),
  "a concurrent PvP break is still announced when it races a local inventory save",
);

const equipHandler = client.slice(
  client.indexOf("function handleEquipArmor"),
  client.indexOf("function loadCanonicalChest"),
);
assert.ok(equipHandler.includes("equipmentRef.current"));
assert.ok(equipHandler.includes("updateEquipment(result.equipment)"));
assert.equal(equipHandler.includes("setInterval"), false, "armor durability adds no client mutation loop");

const equipmentSlots = inventoryDrawer.slice(
  inventoryDrawer.indexOf('(Object.keys(equipment) as ArmorSlot[])'),
  inventoryDrawer.indexOf('<div className="lc-player-preview"'),
);
assert.ok(equipmentSlots.includes("const stack = equipment[slot]"));
assert.ok(equipmentSlots.includes("stack.durability"));
assert.ok(equipmentSlots.includes("maxItemDurability(itemId)"));
assert.ok(equipmentSlots.includes("<ItemGlyph stack={stack ? { ...stack, count: 1 } : null} compact />"));
assert.ok(equipmentSlots.includes("aria-label="));

console.log("armor durability client reconciliation and HUD tests passed");
