import assert from "node:assert/strict";
import {
  BLOCKS,
  ITEMS,
  RECIPES,
  SMELTING_RECIPES,
  addItem,
  armorProtection,
  attackDamage,
  canHarvestBlock,
  countItem,
  craftRecipe,
  createEmptyInventory,
  getMiningDrop,
  miningSeconds,
  smeltRecipe,
  type Inventory,
  type ItemId,
  type SmeltingRecipe,
} from "../shared/game.ts";

function inventoryWith(...entries: Array<[ItemId, number]>): Inventory {
  let inventory = createEmptyInventory();
  for (const [itemId, count] of entries) inventory = addItem(inventory, itemId, count).inventory;
  return inventory;
}

function recipe(id: string) {
  const found = RECIPES.find((candidate) => candidate.id === id);
  assert.ok(found, `crafting recipe ${id} should exist`);
  return found;
}

assert.equal(BLOCKS.coal_ore.drop, "coal");
assert.equal(BLOCKS.iron_ore.drop, "raw_iron");
assert.equal(ITEMS.furnace.placesBlock, "furnace");
assert.equal(BLOCKS.furnace.drop, "furnace");

for (const inadequate of [null, "wooden_axe", "wooden_shovel", "wooden_sword"] as const) {
  assert.equal(canHarvestBlock("coal_ore", inadequate), false, `${inadequate ?? "hand"} must not harvest coal`);
}
assert.equal(canHarvestBlock("coal_ore", "wooden_pickaxe"), true);
assert.equal(canHarvestBlock("coal_ore", "stone_pickaxe"), true);
assert.equal(canHarvestBlock("coal_ore", "iron_pickaxe"), true);
assert.equal(getMiningDrop("coal_ore", "wooden_pickaxe")?.itemId, "coal");

assert.equal(canHarvestBlock("iron_ore"), false);
assert.equal(canHarvestBlock("iron_ore", "wooden_pickaxe"), false);
assert.equal(canHarvestBlock("iron_ore", "wooden_axe"), false);
assert.equal(canHarvestBlock("iron_ore", "stone_pickaxe"), true);
assert.equal(canHarvestBlock("iron_ore", "iron_pickaxe"), true);
assert.equal(getMiningDrop("iron_ore", "wooden_pickaxe"), null);
assert.deepEqual(getMiningDrop("iron_ore", "stone_pickaxe"), { itemId: "raw_iron", count: 1 });
assert.ok(miningSeconds("iron_ore", "iron_pickaxe") < miningSeconds("iron_ore", "stone_pickaxe"));
assert.ok(miningSeconds("iron_ore", "stone_pickaxe") < miningSeconds("iron_ore", "wooden_pickaxe"));

const furnaceIngredients = inventoryWith(["cobblestone", 8]);
assert.equal(craftRecipe(furnaceIngredients, "furnace", "field").ok, false);
const craftedFurnace = craftRecipe(furnaceIngredients, "furnace", "crafting_table");
assert.equal(craftedFurnace.ok, true);
assert.equal(countItem(craftedFurnace.inventory, "cobblestone"), 0);
assert.equal(countItem(craftedFurnace.inventory, "furnace"), 1);

const ironEquipment = [
  ["iron_pickaxe", 3, 2],
  ["iron_axe", 3, 2],
  ["iron_shovel", 1, 2],
  ["iron_sword", 2, 1],
  ["iron_helmet", 5, 0],
  ["iron_chestplate", 8, 0],
  ["iron_leggings", 7, 0],
  ["iron_boots", 4, 0],
] as const;
for (const [id, ingots, sticks] of ironEquipment) {
  const equipmentRecipe = recipe(id);
  assert.deepEqual(equipmentRecipe.ingredients, [
    { itemId: "iron_ingot", count: ingots },
    ...(sticks ? [{ itemId: "stick" as const, count: sticks }] : []),
  ]);
  const crafted = craftRecipe(inventoryWith(["iron_ingot", ingots], ["stick", sticks]), id);
  assert.equal(crafted.ok, true, `${id} should be craftable with its exact ingredients`);
  assert.equal(countItem(crafted.inventory, id), 1);
}

assert.equal(ITEMS.iron_pickaxe.tool?.tier, "iron");
assert.equal(ITEMS.iron_axe.tool?.tier, "iron");
assert.equal(ITEMS.iron_shovel.tool?.tier, "iron");
assert.equal(ITEMS.iron_sword.tool?.tier, "iron");
assert.equal(attackDamage("iron_sword"), 6);
assert.ok(attackDamage("iron_sword") > attackDamage("stone_sword"));
assert.deepEqual(
  ["iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"].map((id) => armorProtection(id as ItemId)),
  [2, 6, 5, 2],
);

assert.equal(ITEMS.cooked_pork.food?.hunger, 8);
assert.equal(ITEMS.cooked_beef.food?.hunger, 8);
assert.equal(ITEMS.cooked_mutton.food?.hunger, 6);
assert.equal(ITEMS.raw_chicken.food?.hunger, 2);
assert.equal(ITEMS.cooked_chicken.food?.hunger, 6);
assert.ok((ITEMS.cooked_pork.food?.hunger ?? 0) > (ITEMS.pork.food?.hunger ?? 0));
assert.ok((ITEMS.cooked_beef.food?.hunger ?? 0) > (ITEMS.beef.food?.hunger ?? 0));
assert.ok((ITEMS.cooked_mutton.food?.hunger ?? 0) > (ITEMS.mutton.food?.hunger ?? 0));
assert.ok((ITEMS.cooked_chicken.food?.hunger ?? 0) > (ITEMS.raw_chicken.food?.hunger ?? 0));

assert.deepEqual(
  SMELTING_RECIPES.map(({ id, input, output }) => ({ id, input, output })),
  [
    { id: "charcoal", input: "log", output: "charcoal" },
    { id: "stone", input: "cobblestone", output: "stone" },
    { id: "iron_ingot", input: "raw_iron", output: "iron_ingot" },
    { id: "gold_ingot", input: "raw_gold", output: "gold_ingot" },
    { id: "glass", input: "sand", output: "glass" },
    { id: "brick", input: "clay_ball", output: "brick" },
    { id: "cooked_pork", input: "pork", output: "cooked_pork" },
    { id: "cooked_beef", input: "beef", output: "cooked_beef" },
    { id: "cooked_mutton", input: "mutton", output: "cooked_mutton" },
    { id: "cooked_chicken", input: "raw_chicken", output: "cooked_chicken" },
  ],
);
assert.equal(new Set(SMELTING_RECIPES.map(({ id }) => id)).size, SMELTING_RECIPES.length);

const unknownSource = inventoryWith(["raw_iron", 2], ["coal", 1]);
for (const unknown of [
  "not_a_smelting_recipe",
  { id: "made_up", label: "Transmute", input: "stone", output: "iron_ingot" } as SmeltingRecipe,
]) {
  const result = smeltRecipe(unknownSource, unknown);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.reason, "unknown_recipe");
  assert.deepEqual(result.inventory, unknownSource);
  assert.notEqual(result.inventory, unknownSource);
}

const missingInput = smeltRecipe(inventoryWith(["coal", 4]), "iron_ingot");
assert.equal(missingInput.ok, false);
assert.equal(missingInput.ok ? null : missingInput.reason, "missing_input");
const missingFuelSource = inventoryWith(["raw_iron", 4]);
const missingFuel = smeltRecipe(missingFuelSource, "iron_ingot");
assert.equal(missingFuel.ok, false);
assert.equal(missingFuel.ok ? null : missingFuel.reason, "missing_fuel");
assert.deepEqual(missingFuel.inventory, missingFuelSource);

for (const [inputCount, expectedBatch] of [[1, 1], [8, 8], [9, 8], [64, 8]] as const) {
  const source = inventoryWith(["raw_iron", inputCount], ["coal", 3], ["dirt", 5]);
  const result = smeltRecipe(source, "iron_ingot");
  assert.equal(result.ok, true);
  if (!result.ok) continue;
  assert.deepEqual(result.smelted, { itemId: "iron_ingot", count: expectedBatch });
  assert.equal(result.fuelConsumed, 1);
  assert.equal(countItem(result.inventory, "raw_iron"), inputCount - expectedBatch);
  assert.equal(countItem(result.inventory, "iron_ingot"), expectedBatch);
  assert.equal(countItem(result.inventory, "coal"), 2);
  assert.equal(countItem(result.inventory, "dirt"), 5, "unrelated inventory must be conserved");
  assert.deepEqual(countItem(source, "raw_iron"), inputCount, "smelting must not mutate its caller");
}

for (const smeltingRecipe of SMELTING_RECIPES) {
  const source = inventoryWith([smeltingRecipe.input, 6], ["coal", 2], [smeltingRecipe.output, 3], ["dirt", 7]);
  const result = smeltRecipe(source, smeltingRecipe);
  assert.equal(result.ok, true, `${smeltingRecipe.id} should smelt by recipe object`);
  if (!result.ok) continue;
  assert.equal(countItem(result.inventory, smeltingRecipe.input), 0);
  assert.equal(countItem(result.inventory, smeltingRecipe.output), 9);
  assert.equal(countItem(result.inventory, "coal"), 1);
  assert.equal(countItem(result.inventory, "dirt"), 7);
}

const capacityBlocked = createEmptyInventory(9);
capacityBlocked[0] = { itemId: "raw_iron", count: 9 };
capacityBlocked[1] = { itemId: "coal", count: 2 };
for (let index = 2; index < capacityBlocked.length; index += 1) capacityBlocked[index] = { itemId: "stone", count: 64 };
const blocked = smeltRecipe(capacityBlocked, "iron_ingot");
assert.equal(blocked.ok, false);
assert.equal(blocked.ok ? null : blocked.reason, "inventory_full");
assert.deepEqual(blocked.inventory, capacityBlocked, "capacity failure must consume neither input nor fuel");

const freedSlot = capacityBlocked.map((stack) => stack ? { ...stack } : null);
freedSlot[0] = { itemId: "raw_iron", count: 8 };
const fitsAfterConsumption = smeltRecipe(freedSlot, "iron_ingot");
assert.equal(fitsAfterConsumption.ok, true, "consuming the entire input stack may free the output slot");
assert.equal(countItem(fitsAfterConsumption.inventory, "iron_ingot"), 8);

console.log("lakecraft iron progression tests: ok");
