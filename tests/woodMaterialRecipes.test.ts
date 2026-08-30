import assert from "node:assert/strict";
import { matchCraftingGrid, previewCraftingResult, type CraftingGrid } from "../shared/craftingGrid.ts";
import {
  RECIPE_ITEM_TAGS,
  RECIPES,
  SMELTING_RECIPES,
  addItem,
  countItem,
  craftRecipe,
  createEmptyInventory,
  smeltRecipe,
  type ItemId,
} from "../shared/game.ts";
import {
  WOOD_FAMILY_DEFINITIONS,
  WOOD_PLANK_ITEM_IDS,
  WOOL_ITEM_IDS,
} from "../shared/expandedBuildingCatalog.ts";

function grid(itemId: ItemId, slots: readonly number[]): CraftingGrid {
  const result: CraftingGrid = Array.from({ length: 9 }, () => null);
  for (const slot of slots) (result as Array<{ itemId: ItemId; count: number } | null>)[slot] = { itemId, count: 1 };
  return result;
}

function craftFrom(itemId: ItemId, count: number, recipeId: string, outputId: ItemId): void {
  const inventory = addItem(createEmptyInventory(), itemId, count).inventory;
  const result = craftRecipe(inventory, recipeId, "crafting_table");
  assert.equal(result.ok, true, `${itemId} should craft ${outputId} through ${recipeId}`);
  if (!result.ok) return;
  assert.equal(countItem(result.inventory, itemId), 0);
  assert.equal(countItem(result.inventory, outputId), RECIPES.find(({ id }) => id === recipeId)?.output.count);
}

const stickSlots = [0, 3] as const;
const tableSlots = [0, 1, 3, 4] as const;
const chestSlots = [0, 1, 2, 3, 5, 6, 7, 8] as const;
const stairSlots = [0, 3, 4, 6, 7, 8] as const;
const doorSlots = [0, 1, 3, 4, 6, 7] as const;

for (const planks of WOOD_PLANK_ITEM_IDS) {
  assert.equal(matchCraftingGrid(grid(planks, stickSlots), 3)?.recipe.id, "sticks_from_planks");
  assert.equal(matchCraftingGrid(grid(planks, tableSlots), 3)?.recipe.id, "crafting_table");
  assert.equal(matchCraftingGrid(grid(planks, chestSlots), 3)?.recipe.id, "chest");
  craftFrom(planks, 2, "sticks_from_planks", "stick");
  craftFrom(planks, 4, "crafting_table", "crafting_table");
  craftFrom(planks, 8, "chest", "chest");

  const woodenPickaxe: CraftingGrid = [
    { itemId: planks, count: 1 }, { itemId: planks, count: 1 }, { itemId: planks, count: 1 },
    null, { itemId: "stick", count: 1 }, null,
    null, { itemId: "stick", count: 1 }, null,
  ];
  assert.equal(matchCraftingGrid(woodenPickaxe, 3)?.recipe.id, "wooden_pickaxe");
}

let mixedPlanks = addItem(createEmptyInventory(), "birch_planks", 2).inventory;
mixedPlanks = addItem(mixedPlanks, "dark_oak_planks", 2).inventory;
const mixedTable = craftRecipe(mixedPlanks, "crafting_table", "field");
assert.equal(mixedTable.ok, true, "generic plank recipes may combine wood families");
if (mixedTable.ok) {
  assert.equal(countItem(mixedTable.inventory, "birch_planks"), 0);
  assert.equal(countItem(mixedTable.inventory, "dark_oak_planks"), 0);
}

assert.deepEqual(RECIPE_ITEM_TAGS.wooden_planks, WOOD_FAMILY_DEFINITIONS.map(({ planks }) => planks),
  "the shared plank tag comes directly from the wood-family registry");

for (const family of WOOD_FAMILY_DEFINITIONS) {
  const planks = family.planks as ItemId;
  const slab = family.slab as ItemId;
  const stairs = family.stairs as ItemId;
  assert.deepEqual(previewCraftingResult(grid(planks, [0, 1, 2]), 3)?.output, { itemId: slab, count: 6 });
  assert.deepEqual(previewCraftingResult(grid(planks, stairSlots), 3)?.output, { itemId: stairs, count: 4 });
  craftFrom(planks, 3, slab, slab);
  craftFrom(planks, 6, stairs, stairs);

  if (family.door) {
    const door = family.door as ItemId;
    assert.deepEqual(previewCraftingResult(grid(planks, doorSlots), 3)?.output, { itemId: door, count: 1 });
    craftFrom(planks, 6, door, door);
  }

  if (family.log && family.plankRecipeId && family.charcoalRecipeId) {
    const log = family.log as ItemId;
    const plankRecipe = RECIPES.find(({ id }) => id === family.plankRecipeId);
    assert.deepEqual(plankRecipe?.ingredients, [{ itemId: log, count: 1 }]);
    assert.deepEqual(plankRecipe?.output, { itemId: planks, count: 4 });
    assert.equal(matchCraftingGrid(grid(log, [8]), 3)?.recipe.id, family.plankRecipeId);
    craftFrom(log, 1, family.plankRecipeId, planks);

    assert.ok(SMELTING_RECIPES.some(({ id, input, output }) =>
      id === family.charcoalRecipeId && input === log && output === "charcoal"));
    let inventory = addItem(createEmptyInventory(), log, 1).inventory;
    inventory = addItem(inventory, "coal", 1).inventory;
    const result = smeltRecipe(inventory, family.charcoalRecipeId);
    assert.equal(result.ok, true, `${log} should smelt into charcoal`);
  } else {
    assert.equal(family.id, "bamboo", "only an explicitly capability-free family may omit log recipes");
  }
}

assert.equal(matchCraftingGrid(grid("spruce_planks", stairSlots), 3)?.recipe.id, "spruce_stairs");
assert.equal(matchCraftingGrid(grid("birch_planks", doorSlots), 3)?.recipe.id, "birch_door");
assert.equal(matchCraftingGrid(grid("dark_oak_planks", [0, 1, 2]), 3)?.recipe.id, "dark_oak_slab");
assert.equal(matchCraftingGrid(grid("spruce_planks", [0, 1, 2, 3, 5, 6]), 3)?.recipe.id, undefined,
  "spruce planks cannot silently turn into oak fence sections");

for (const wool of WOOL_ITEM_IDS) {
  const bedGrid: CraftingGrid = [
    { itemId: wool, count: 1 }, { itemId: wool, count: 1 }, { itemId: wool, count: 1 },
    { itemId: "dark_oak_planks", count: 1 }, { itemId: "dark_oak_planks", count: 1 }, { itemId: "dark_oak_planks", count: 1 },
    null, null, null,
  ];
  assert.equal(matchCraftingGrid(bedGrid, 3)?.recipe.id, "bed", `${wool} should make the shared bed`);
}

assert.deepEqual(
  WOOD_FAMILY_DEFINITIONS.flatMap(({ door }) => door ? [door] : [])
    .filter((id) => !(id in Object.fromEntries(RECIPES.map((recipe) => [recipe.id, true])))),
  [],
  "every registered wood door has a matching recipe",
);

console.log("wood material tags, generic outputs, family shapes, wool beds, and charcoal recipes passed");
