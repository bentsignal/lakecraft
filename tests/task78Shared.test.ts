import assert from "node:assert/strict";
import {
  BLOCKS,
  ITEMS,
  RECIPES,
  SMELTING_RECIPES,
  addItem,
  countItem,
  craftRecipe,
  createEmptyInventory,
  getMiningDrop,
  smeltRecipe,
} from "../shared/game.ts";
import {
  CRAFTING_GRID_RECIPES,
  INITIAL_RECIPE_PATTERNS,
  matchCraftingGrid,
  takeCraftingResult,
} from "../shared/craftingGrid.ts";
import { BLOCK_TYPES, isBlockType } from "../shared/protocol.ts";
import {
  WORLD_CHUNK_BLOCK_TYPES,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
} from "../shared/worldChunks.ts";

assert.deepEqual(BLOCKS.stone_bricks, {
  id: "stone_bricks",
  label: "Stone Bricks",
  description: "Cut stone blocks fitted into a durable masonry pattern.",
  color: "#74766f",
  accent: "#a3a59c",
  hardness: 1.5,
  preferredTool: "pickaxe",
  requiredDropTool: { kind: "pickaxe", minimumTier: "wood" },
  drop: "stone_bricks",
});
assert.equal(ITEMS.stone_bricks.category, "block");
assert.equal(ITEMS.stone_bricks.placesBlock, "stone_bricks");
assert.equal(ITEMS.stone_bricks.maxStack, 64);
assert.equal(getMiningDrop("stone_bricks"), null, "hands cannot recover stone bricks");
assert.deepEqual(getMiningDrop("stone_bricks", "wooden_pickaxe"), { itemId: "stone_bricks", count: 1 });

const smelting = SMELTING_RECIPES.find(({ id }) => id === "stone");
assert.deepEqual(smelting, { id: "stone", label: "Smelt stone", input: "cobblestone", output: "stone" });
assert.equal(SMELTING_RECIPES.filter(({ input }) => input === "cobblestone").length, 1);
let furnaceInventory = addItem(createEmptyInventory(), "cobblestone", 7).inventory;
furnaceInventory = addItem(furnaceInventory, "charcoal", 1).inventory;
const smelted = smeltRecipe(furnaceInventory, smelting!);
assert.equal(smelted.ok, true);
if (smelted.ok) {
  assert.equal(countItem(smelted.inventory, "cobblestone"), 0);
  assert.equal(countItem(smelted.inventory, "stone"), 7);
  assert.equal(countItem(smelted.inventory, "charcoal"), 0);
}
assert.equal(countItem(furnaceInventory, "cobblestone"), 7, "smelting never mutates the caller inventory");

const recipe = RECIPES.find(({ id }) => id === "stone_bricks");
assert.deepEqual(recipe, {
  id: "stone_bricks",
  label: "Stone bricks",
  note: "Four stone blocks make four fitted stone bricks.",
  craftingContext: "field",
  ingredients: [{ itemId: "stone", count: 4 }],
  output: { itemId: "stone_bricks", count: 4 },
});
assert.deepEqual(INITIAL_RECIPE_PATTERNS.stone_bricks, {
  kind: "shaped",
  pattern: [["stone", "stone"], ["stone", "stone"]],
});
assert.equal(CRAFTING_GRID_RECIPES.length, RECIPES.length);
assert.equal(Object.keys(INITIAL_RECIPE_PATTERNS).length, RECIPES.length);
const grid = Array.from({ length: 4 }, () => ({ itemId: "stone" as const, count: 1 }));
assert.equal(matchCraftingGrid(grid, 2)?.recipe.id, "stone_bricks");
const gridCraft = takeCraftingResult({ grid, cursor: null }, 2);
assert.equal(gridCraft.ok, true);
if (gridCraft.ok) {
  assert.deepEqual(gridCraft.state.grid, [null, null, null, null]);
  assert.deepEqual(gridCraft.state.cursor, { itemId: "stone_bricks", count: 4 });
}
let aggregateInventory = addItem(createEmptyInventory(), "stone", 4).inventory;
const aggregateCraft = craftRecipe(aggregateInventory, recipe!);
assert.equal(aggregateCraft.ok, true);
if (aggregateCraft.ok) {
  aggregateInventory = aggregateCraft.inventory;
  assert.equal(countItem(aggregateInventory, "stone"), 0);
  assert.equal(countItem(aggregateInventory, "stone_bricks"), 4);
}

assert.equal(BLOCK_TYPES.indexOf("sapling"), 25, "the shipped sapling protocol index remains stable");
assert.equal(BLOCK_TYPES.indexOf("stone_bricks"), 26, "stone bricks append to the protocol palette");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("sapling"), 25, "the shipped sapling persisted code remains stable");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("stone_bricks"), 26, "stone bricks append as persisted code 27");
assert.equal(isBlockType("stone_bricks"), true);
const snapshot = createWorldChunkSnapshot("0:0", [{ x: 5, y: 9, z: 6, blockType: "stone_bricks" }]);
assert.equal(snapshot.ok, true);
if (snapshot.ok) assert.deepEqual(decodeWorldChunkSnapshot("0:0", snapshot.snapshotJson), {
  ok: true,
  edits: [{ coordKey: "5:9:6", x: "5", y: "9", z: "6", blockType: "stone_bricks" }],
});

console.log("Task 78 stone-smelting, exact brick crafting, catalog, and codec tests passed");
