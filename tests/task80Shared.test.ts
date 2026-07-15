import assert from "node:assert/strict";
import {
  BLOCKS,
  ITEMS,
  RECIPES,
  addItem,
  countItem,
  craftRecipe,
  createEmptyInventory,
  getMiningDrop,
} from "../shared/game.ts";
import {
  CRAFTING_GRID_RECIPES,
  INITIAL_RECIPE_PATTERNS,
  createCraftingGrid,
  matchCraftingGrid,
  takeCraftingResult,
} from "../shared/craftingGrid.ts";
import { BLOCK_TYPES, isBlockType } from "../shared/protocol.ts";
import {
  WORLD_CHUNK_BLOCK_TYPES,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
} from "../shared/worldChunks.ts";

assert.deepEqual(BLOCKS.oak_fence, {
  id: "oak_fence",
  label: "Oak Fence",
  description: "Oak rails and posts that form a sturdy animal barrier.",
  color: "#95622f",
  accent: "#c28a47",
  hardness: 2,
  preferredTool: "axe",
  drop: "oak_fence",
});
assert.equal(ITEMS.oak_fence.placesBlock, "oak_fence");
assert.equal(ITEMS.oak_fence.category, "block");
assert.equal(ITEMS.oak_fence.maxStack, 64);
assert.deepEqual(getMiningDrop("oak_fence"), { itemId: "oak_fence", count: 1 });
assert.deepEqual(getMiningDrop("oak_fence", "wooden_axe"), { itemId: "oak_fence", count: 1 });

const recipe = RECIPES.find(({ id }) => id === "oak_fence");
assert.deepEqual(recipe, {
  id: "oak_fence",
  label: "Oak fence",
  note: "Four boards and two sticks make three oak fence sections.",
  craftingContext: "crafting_table",
  ingredients: [{ itemId: "planks", count: 4 }, { itemId: "stick", count: 2 }],
  output: { itemId: "oak_fence", count: 3 },
});
assert.deepEqual(INITIAL_RECIPE_PATTERNS.oak_fence, {
  kind: "shaped",
  pattern: [["planks", "stick", "planks"], ["planks", "stick", "planks"]],
});
assert.equal(CRAFTING_GRID_RECIPES.length, RECIPES.length, "every aggregate recipe has one exact grid adapter");
assert.equal(Object.keys(INITIAL_RECIPE_PATTERNS).length, RECIPES.length, "the exact-shape catalog has no omissions");

const grid = createCraftingGrid(3).slice();
for (const [slot, itemId] of [[0, "planks"], [1, "stick"], [2, "planks"], [3, "planks"], [4, "stick"], [5, "planks"]] as const) {
  grid[slot] = { itemId, count: 1 };
}
assert.equal(matchCraftingGrid(grid, 3)?.recipe.id, "oak_fence");
const shifted = createCraftingGrid(3).slice();
for (const [slot, itemId] of [[3, "planks"], [4, "stick"], [5, "planks"], [6, "planks"], [7, "stick"], [8, "planks"]] as const) {
  shifted[slot] = { itemId, count: 1 };
}
assert.equal(matchCraftingGrid(shifted, 3)?.recipe.id, "oak_fence", "the shape may occupy either adjacent row pair");
shifted[8] = null;
assert.equal(matchCraftingGrid(shifted, 3), null, "an incomplete fence shape cannot craft");

const taken = takeCraftingResult({ grid, cursor: null }, 3);
assert.equal(taken.ok, true);
if (taken.ok) {
  assert.deepEqual(taken.state.cursor, { itemId: "oak_fence", count: 3 });
  assert.ok(taken.state.grid.every((stack) => stack === null), "one craft consumes exactly four planks and two sticks");
}

let inventory = addItem(createEmptyInventory(), "planks", 4).inventory;
inventory = addItem(inventory, "stick", 2).inventory;
const aggregate = craftRecipe(inventory, "oak_fence", "crafting_table");
assert.equal(aggregate.ok, true);
if (aggregate.ok) {
  assert.equal(countItem(aggregate.inventory, "planks"), 0);
  assert.equal(countItem(aggregate.inventory, "stick"), 0);
  assert.equal(countItem(aggregate.inventory, "oak_fence"), 3);
}

assert.equal(BLOCK_TYPES.indexOf("sapling"), 25);
assert.equal(BLOCK_TYPES.indexOf("stone_bricks"), 26);
assert.equal(BLOCK_TYPES.indexOf("oak_fence"), 27, "oak fence appends without renumbering shipped protocol IDs");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("sapling"), 25);
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("stone_bricks"), 26);
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("oak_fence"), 27, "oak fence persists as five-bit code 28");
assert.equal(isBlockType("oak_fence"), true);
const snapshot = createWorldChunkSnapshot("0:0", [{ x: 7, y: 10, z: 2, blockType: "oak_fence" }]);
assert.equal(snapshot.ok, true);
if (snapshot.ok) {
  assert.deepEqual(decodeWorldChunkSnapshot("0:0", snapshot.snapshotJson), {
    ok: true,
    edits: [{ coordKey: "7:10:2", x: "7", y: "10", z: "2", blockType: "oak_fence" }],
  });
}

console.log("Task 80 oak-fence shared catalog, exact recipe, protocol, and codec tests passed");
