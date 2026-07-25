import assert from "node:assert/strict";
import { validateChestInventoryJson } from "../shared/chests.ts";
import {
  BLOCKS,
  RECIPES,
  SMELTING_RECIPES,
  addItem,
  countItem,
  craftRecipe,
  createEmptyInventory,
  createSerializablePlayerState,
  getMiningDrop,
  parseSerializablePlayerStateJson,
  smeltRecipe,
} from "../shared/game.ts";

assert.deepEqual(getMiningDrop("stone", "wooden_pickaxe"), { itemId: "cobblestone", count: 1 });
assert.equal(getMiningDrop("stone", null), null, "natural stone still requires a wooden pickaxe or better");
assert.deepEqual(getMiningDrop("cobblestone", "wooden_pickaxe"), { itemId: "cobblestone", count: 1 });
assert.equal(getMiningDrop("cobblestone", "wooden_shovel"), null);
assert.deepEqual(getMiningDrop("sand", null), { itemId: "sand", count: 1 });
assert.deepEqual(getMiningDrop("glass", null), { itemId: "glass", count: 1 });
assert.equal(BLOCKS.stone.drop, "cobblestone");

const furnaceRecipe = RECIPES.find(({ id }) => id === "furnace");
assert.ok(furnaceRecipe);
assert.deepEqual(furnaceRecipe.ingredients, [{ itemId: "cobblestone", count: 8 }]);
let furnaceInventory = addItem(createEmptyInventory(), "cobblestone", 8).inventory;
const furnace = craftRecipe(furnaceInventory, furnaceRecipe, "crafting_table");
assert.equal(furnace.ok, true);
if (furnace.ok) {
  furnaceInventory = furnace.inventory;
  assert.equal(countItem(furnaceInventory, "cobblestone"), 0);
  assert.equal(countItem(furnaceInventory, "furnace"), 1);
}

const glassRecipe = SMELTING_RECIPES.find(({ id }) => id === "glass");
assert.deepEqual(glassRecipe, { id: "glass", label: "Smelt glass", input: "sand", output: "glass" });
const fuelOnly = addItem(createEmptyInventory(), "coal", 1).inventory;
const missingSand = smeltRecipe(fuelOnly, "glass");
assert.equal(missingSand.ok, false);
if (!missingSand.ok) {
  assert.equal(missingSand.reason, "missing_input");
  assert.equal(countItem(missingSand.inventory, "coal"), 1, "an empty sand input never burns fuel");
}
let sandInventory = addItem(createEmptyInventory(), "sand", 12).inventory;
sandInventory = addItem(sandInventory, "coal", 1).inventory;
const glass = smeltRecipe(sandInventory, "glass");
assert.equal(glass.ok, true);
if (glass.ok) {
  assert.equal(glass.smelted.count, 8, "one coal keeps the existing bounded eight-item batch");
  assert.equal(countItem(glass.inventory, "sand"), 4);
  assert.equal(countItem(glass.inventory, "glass"), 8);
  assert.equal(countItem(glass.inventory, "coal"), 0);
}

const mixedInventory = addItem(addItem(createEmptyInventory(), "stone", 2).inventory, "glass", 3).inventory;
const restored = parseSerializablePlayerStateJson(JSON.stringify(createSerializablePlayerState(mixedInventory, 0)));
assert.ok(restored);
assert.equal(restored && countItem(restored.inventory, "stone"), 2, "legacy natural-stone stacks remain valid");
assert.equal(restored && countItem(restored.inventory, "glass"), 3);

const chest = validateChestInventoryJson(JSON.stringify([
  { itemId: "cobblestone", count: 8 },
  { itemId: "sand", count: 4 },
  { itemId: "glass", count: 8 },
]));
assert.equal(chest.ok, true, "all new materials remain compatible with strict shared chests");

console.log("lakecraft material progression client tests: ok");
