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
  createEmptyInventory,
  miningSeconds,
  normalizeInventory,
  toolEffectiveness,
  type Inventory,
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
assert.equal(new Set(RECIPES.map(({ id }) => id)).size, RECIPES.length, "recipe ids stay unique");

let woodInventory = addItem(createEmptyInventory(), "log", 3).inventory;
woodInventory = craft(woodInventory, "planks_from_log");
woodInventory = craft(woodInventory, "planks_from_log");
woodInventory = craft(woodInventory, "planks_from_log");
woodInventory = craft(woodInventory, "sticks_from_planks");
woodInventory = craft(woodInventory, "crafting_table");
woodInventory = craft(woodInventory, "wooden_shovel");
woodInventory = craft(woodInventory, "wooden_sword");
assert.equal(countItem(woodInventory, "crafting_table"), 1);
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

console.log("lakecraft progression tests: ok");
