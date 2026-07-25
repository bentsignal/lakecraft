import assert from "node:assert/strict";
import { validateChestInventoryJson } from "../shared/chests.ts";
import {
  ITEMS,
  RECIPES,
  addItem,
  availableRecipes,
  countItem,
  craftRecipe,
  createEmptyInventory,
  createSerializablePlayerState,
  parseSerializablePlayerStateJson,
} from "../shared/game.ts";

const recipe = RECIPES.find(({ id }) => id === "ladder");
assert.ok(recipe, "ladder recipe is registered");
assert.equal(recipe.craftingContext, "crafting_table");
assert.equal(availableRecipes("field").some(({ id }) => id === "ladder"), false, "ladders require a crafting table");
assert.equal(availableRecipes("crafting_table").some(({ id }) => id === "ladder"), true);

let inventory = addItem(createEmptyInventory(), "stick", 7).inventory;
const crafted = craftRecipe(inventory, recipe, "crafting_table");
assert.equal(crafted.ok, true);
if (crafted.ok) {
  inventory = crafted.inventory;
  assert.deepEqual(crafted.crafted, { itemId: "ladder", count: 3 });
  assert.equal(countItem(inventory, "stick"), 0, "all seven sticks are conserved and consumed");
  assert.equal(countItem(inventory, "ladder"), 3);
}

assert.equal(ITEMS.ladder.maxStack, 64);
assert.equal(ITEMS.ladder.placesBlock, "ladder");

const serialized = JSON.stringify(createSerializablePlayerState(inventory, 0));
const restored = parseSerializablePlayerStateJson(serialized);
assert.ok(restored);
assert.equal(restored && countItem(restored.inventory, "ladder"), 3, "player autosave serialization preserves ladders");

const chest = validateChestInventoryJson(JSON.stringify([{ itemId: "ladder", count: 3 }]));
assert.equal(chest.ok, true, "strict shared chest validation accepts the ladder item");
if (chest.ok) assert.deepEqual(chest.inventory[0], { itemId: "ladder", count: 3 });

console.log("lakecraft ladder client progression tests: ok");
