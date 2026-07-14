import assert from "node:assert/strict";
import {
  BLOCKS,
  ITEMS,
  RECIPES,
  addItem,
  armorProtection,
  attackDamage,
  countItem,
  craftRecipe,
  createEmptyEquipment,
  createEmptyInventory,
  createSerializablePlayerState,
  equipArmorFromInventory,
  equippedArmorProtection,
  miningSeconds,
  normalizeEquipment,
  normalizeInventory,
  normalizeRespawnPoint,
  normalizeSerializablePlayerState,
  parseSerializablePlayerStateJson,
  toolEffectiveness,
  unequipArmor,
  type Inventory,
  type PlayerRespawnPoint,
  type Recipe,
} from "../shared/game.ts";

function recipe(id: string): Recipe {
  const found = RECIPES.find((candidate) => candidate.id === id);
  assert.ok(found, `recipe ${id} should exist`);
  return found;
}

function craft(inventory: Inventory, id: string): Inventory {
  const result = craftRecipe(inventory, recipe(id));
  assert.equal(result.ok, true, `${id} should be craftable`);
  return result.inventory;
}

assert.equal(BLOCKS.crafting_table.drop, "crafting_table");
assert.equal(ITEMS.crafting_table.placesBlock, "crafting_table");
assert.equal(ITEMS.torch.placesBlock, "torch");
assert.equal(ITEMS.chest.placesBlock, "chest");
assert.equal(ITEMS.door.placesBlock, "door");
assert.equal(ITEMS.bed.placesBlock, "bed");
assert.equal(new Set(RECIPES.map(({ id }) => id)).size, RECIPES.length, "recipe ids stay unique");

let woodInventory = addItem(createEmptyInventory(), "log", 3).inventory;
woodInventory = craft(woodInventory, "planks_from_log");
woodInventory = craft(woodInventory, "planks_from_log");
woodInventory = craft(woodInventory, "planks_from_log");
woodInventory = craft(woodInventory, "sticks_from_planks");
woodInventory = craft(woodInventory, "crafting_table");
woodInventory = craft(woodInventory, "torch");
woodInventory = craft(woodInventory, "wooden_shovel");
woodInventory = craft(woodInventory, "wooden_sword");
assert.equal(countItem(woodInventory, "crafting_table"), 1);
assert.equal(countItem(woodInventory, "torch"), 4);
assert.equal(countItem(woodInventory, "wooden_shovel"), 1);
assert.equal(countItem(woodInventory, "wooden_sword"), 1);

let stoneInventory = addItem(createEmptyInventory(), "stone", 3).inventory;
stoneInventory = addItem(stoneInventory, "stick", 3).inventory;
stoneInventory = craft(stoneInventory, "stone_shovel");
stoneInventory = craft(stoneInventory, "stone_sword");
assert.equal(countItem(stoneInventory, "stone"), 0);
assert.equal(countItem(stoneInventory, "stick"), 0);

let armorInventory = addItem(createEmptyInventory(), "leather", 24).inventory;
for (const id of ["leather_helmet", "leather_chestplate", "leather_leggings", "leather_boots"]) {
  armorInventory = craft(armorInventory, id);
  assert.equal(countItem(armorInventory, recipe(id).output.itemId), 1);
}
assert.equal(countItem(armorInventory, "leather"), 0);
assert.equal(armorProtection("leather_chestplate"), 3);
assert.equal(armorProtection("stone_sword"), 0);

const stackedLeather = addItem(createEmptyInventory(), "leather", 65);
assert.equal(stackedLeather.remainder, 0);
assert.deepEqual(stackedLeather.inventory.slice(0, 2), [
  { itemId: "leather", count: 64 },
  { itemId: "leather", count: 1 },
]);
const unstackedTools = addItem(createEmptyInventory(), "stone_sword", 3);
assert.deepEqual(unstackedTools.inventory.slice(0, 3), [
  { itemId: "stone_sword", count: 1 },
  { itemId: "stone_sword", count: 1 },
  { itemId: "stone_sword", count: 1 },
]);

const normalized = normalizeInventory([
  { itemId: "crafting_table", count: 99 },
  { itemId: "wooden_shovel", count: 8 },
  { itemId: "leather", count: 4.9 },
  { itemId: "unknown", count: 2 },
  { itemId: "stone", count: Number.POSITIVE_INFINITY },
]);
assert.deepEqual(normalized.slice(0, 5), [
  { itemId: "crafting_table", count: 64 },
  { itemId: "wooden_shovel", count: 1 },
  { itemId: "leather", count: 4 },
  null,
  null,
]);

assert.ok(toolEffectiveness("dirt", "stone_shovel") > toolEffectiveness("dirt", "wooden_shovel"));
assert.ok(toolEffectiveness("dirt", "wooden_shovel") > toolEffectiveness("dirt", "wooden_sword"));
assert.ok(miningSeconds("dirt", "stone_shovel") < miningSeconds("dirt", "wooden_shovel"));
assert.ok(miningSeconds("stone", "stone_pickaxe") < miningSeconds("stone", "stone_shovel"));
assert.equal(attackDamage("wooden_sword"), 4);
assert.equal(attackDamage("stone_sword"), 5);
assert.ok(attackDamage("stone_sword") > attackDamage("stone_axe"));

const equipmentInventory = createEmptyInventory();
equipmentInventory[4] = { itemId: "leather_chestplate", count: 1 };
const equipped = equipArmorFromInventory(equipmentInventory, createEmptyEquipment(), 4);
assert.equal(equipped.ok, true);
assert.equal(equipped.equipment.chest, "leather_chestplate");
assert.equal(equipped.inventory[4], null);
assert.equal(equippedArmorProtection(equipped.equipment), 3);
const unequipped = unequipArmor(equipped.inventory, equipped.equipment, "chest");
assert.equal(unequipped.ok, true);
assert.equal(unequipped.equipment.chest, null);
assert.equal(countItem(unequipped.inventory, "leather_chestplate"), 1);

const corruptEquipment = normalizeEquipment({ head: "stone_sword", chest: "leather_helmet", feet: "leather_boots" });
assert.deepEqual(corruptEquipment, { head: null, chest: null, legs: null, feet: "leather_boots" });
const legacyState = createSerializablePlayerState([], 99, normalizeEquipment(undefined));
assert.deepEqual(legacyState.equipment, createEmptyEquipment());
assert.equal(legacyState.selectedHotbar, 8);
assert.equal(legacyState.respawnPoint, null);

const bedSpawn: PlayerRespawnPoint = { x: 12.5, y: 8.02, z: -4.5, yaw: Math.PI, pitch: -0.08 };
assert.deepEqual(normalizeRespawnPoint(bedSpawn), bedSpawn);
const stateWithSpawn = createSerializablePlayerState([], 2, createEmptyEquipment(), bedSpawn);
assert.deepEqual(stateWithSpawn.respawnPoint, bedSpawn);
assert.notEqual(stateWithSpawn.respawnPoint, bedSpawn, "serialized spawn state should not retain a mutable caller object");
assert.deepEqual(parseSerializablePlayerStateJson(JSON.stringify(stateWithSpawn)), stateWithSpawn);

for (const invalidSpawn of [
  null,
  { x: 65, y: 8, z: 0, yaw: 0, pitch: 0 },
  { x: 0, y: 97, z: 0, yaw: 0, pitch: 0 },
  { x: 0, y: 8, z: -65, yaw: 0, pitch: 0 },
  { x: 0, y: 8, z: 0, yaw: Number.POSITIVE_INFINITY, pitch: 0 },
  { x: 0, y: 8, z: 0, yaw: 0, pitch: 2 },
  { x: "0", y: 8, z: 0, yaw: 0, pitch: 0 },
]) {
  assert.equal(normalizeRespawnPoint(invalidSpawn), null);
}

const parsedLegacyObject = parseSerializablePlayerStateJson(JSON.stringify({
  inventory: [{ itemId: "stone", count: 3 }],
  selectedHotbar: 99,
  equipment: { feet: "leather_boots" },
}));
assert.ok(parsedLegacyObject);
assert.equal(parsedLegacyObject.respawnPoint, null);
assert.equal(parsedLegacyObject.selectedHotbar, 8);
assert.equal(parsedLegacyObject.inventory[0]?.itemId, "stone");
assert.equal(parsedLegacyObject.equipment.feet, "leather_boots");

const parsedLegacyInventory = parseSerializablePlayerStateJson(JSON.stringify([{ itemId: "dirt", count: 5 }]));
assert.equal(parsedLegacyInventory?.inventory[0]?.itemId, "dirt");
assert.equal(parsedLegacyInventory?.respawnPoint, null);
assert.equal(parseSerializablePlayerStateJson("not json"), null);
assert.equal(parseSerializablePlayerStateJson("42"), null);
assert.equal(normalizeSerializablePlayerState({ respawnPoint: { ...bedSpawn, x: 1_000 } }).respawnPoint, null);

const fullInventory = Array.from({ length: 27 }, () => ({ itemId: "stone_sword" as const, count: 1 }));
const fullEquipment = { ...createEmptyEquipment(), head: "leather_helmet" as const };
const failedUnequip = unequipArmor(fullInventory, fullEquipment, "head");
assert.equal(failedUnequip.ok, false);
assert.equal(failedUnequip.equipment.head, "leather_helmet");
assert.equal(countItem(failedUnequip.inventory, "leather_helmet"), 0);

console.log("lakecraft progression tests: ok");
