import assert from "node:assert/strict";
import {
  BLOCKS,
  INVENTORY_SIZE,
  ITEMS,
  RECIPES,
  SMELTING_RECIPES,
  addItem,
  countItem,
  craftRecipe,
  createEmptyInventory,
  getDeterministicMiningDrop,
  getMiningDrop,
  smeltRecipe,
  type Inventory,
} from "../shared/game.ts";
import {
  INITIAL_RECIPE_PATTERNS,
  createCraftingGrid,
  matchCraftingGrid,
  takeCraftingResult,
} from "../shared/craftingGrid.ts";
import { BLOCK_TYPES, isBlockType } from "../shared/protocol.ts";
import {
  WORLD_CHUNK_BLOCK_TYPES,
  WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
} from "../shared/worldChunks.ts";
import {
  parseWorldBlockOperation,
  placedWorldBlockForItem,
  resolveWorldBlockOperation,
} from "../shared/worldBlockOperations.ts";

assert.deepEqual(BLOCKS.clay, {
  id: "clay",
  label: "Clay",
  description: "A soft blue-gray deposit that breaks into four clay balls.",
  color: "#9ea4b6",
  accent: "#c0c5d2",
  hardness: 0.6,
  preferredTool: "shovel",
  drop: "clay_ball",
});
assert.equal(ITEMS.clay_ball.category, "material");
assert.equal(ITEMS.clay_ball.maxStack, 64);
for (const held of [null, "wooden_shovel", "diamond_shovel", "wooden_pickaxe"] as const) {
  assert.deepEqual(getMiningDrop("clay", held), { itemId: "clay_ball", count: 4 });
  assert.deepEqual(getDeterministicMiningDrop("clay", held, -17, 3, 29), { itemId: "clay_ball", count: 4 },
    "clay has one exact conserved four-ball result, not a coordinate RNG roll");
}

assert.deepEqual(SMELTING_RECIPES.find(({ id }) => id === "brick"), {
  id: "brick",
  label: "Fire brick",
  input: "clay_ball",
  output: "brick",
});
assert.equal(SMELTING_RECIPES.filter(({ input }) => input === "clay_ball").length, 1);
let furnaceInventory = addItem(createEmptyInventory(), "clay_ball", 4).inventory;
furnaceInventory = addItem(furnaceInventory, "coal", 1).inventory;
const fired = smeltRecipe(furnaceInventory, "brick");
assert.equal(fired.ok, true);
if (fired.ok) {
  assert.equal(countItem(fired.inventory, "clay_ball"), 0);
  assert.equal(countItem(fired.inventory, "brick"), 4, "each clay ball fires into exactly one brick");
  assert.equal(countItem(fired.inventory, "coal"), 0);
}

assert.deepEqual(BLOCKS.bricks, {
  id: "bricks",
  label: "Bricks",
  description: "A sturdy red masonry block crafted from fired clay bricks.",
  color: "#964c3d",
  accent: "#c16f59",
  hardness: 2,
  preferredTool: "pickaxe",
  requiredDropTool: { kind: "pickaxe", minimumTier: "wood" },
  drop: "bricks",
});
assert.equal(ITEMS.bricks.placesBlock, "bricks");
assert.equal(getMiningDrop("bricks"), null);
assert.deepEqual(getMiningDrop("bricks", "wooden_pickaxe"), { itemId: "bricks", count: 1 });
assert.deepEqual(RECIPES.find(({ id }) => id === "bricks"), {
  id: "bricks",
  label: "Bricks",
  note: "Four fired bricks make one masonry block.",
  craftingContext: "field",
  ingredients: [{ itemId: "brick", count: 4 }],
  output: { itemId: "bricks", count: 1 },
});
assert.deepEqual(INITIAL_RECIPE_PATTERNS.bricks, {
  kind: "shaped",
  pattern: [["brick", "brick"], ["brick", "brick"]],
});
const fieldGrid = Array.from({ length: 4 }, () => ({ itemId: "brick" as const, count: 1 }));
assert.equal(matchCraftingGrid(fieldGrid, 2)?.recipe.id, "bricks");
const craftedGrid = takeCraftingResult({ grid: fieldGrid, cursor: null }, 2);
assert.equal(craftedGrid.ok, true);
if (craftedGrid.ok) assert.deepEqual(craftedGrid.state.cursor, { itemId: "bricks", count: 1 });
for (const offset of [[0, 1, 3, 4], [1, 2, 4, 5], [3, 4, 6, 7], [4, 5, 7, 8]] as const) {
  const grid = createCraftingGrid(3).slice();
  for (const slot of offset) grid[slot] = { itemId: "brick", count: 1 };
  assert.equal(matchCraftingGrid(grid, 3)?.recipe.id, "bricks", "the exact 2x2 pattern translates within a crafting table");
}
const invalidGrid = [...fieldGrid, { itemId: "brick" as const, count: 1 }, null, null, null, null];
assert.notEqual(matchCraftingGrid(invalidGrid, 3)?.recipe.id, "bricks", "extra ingredients invalidate the exact shape");
let aggregate = addItem(createEmptyInventory(), "brick", 4).inventory;
const craftedAggregate = craftRecipe(aggregate, "bricks", "field");
assert.equal(craftedAggregate.ok, true);
if (craftedAggregate.ok) {
  aggregate = craftedAggregate.inventory;
  assert.equal(countItem(aggregate, "brick"), 0);
  assert.equal(countItem(aggregate, "bricks"), 1);
}

assert.equal(BLOCK_TYPES.indexOf("stone_brick_slab"), 30);
assert.equal(BLOCK_TYPES.indexOf("clay"), 31, "clay appends after every deployed protocol identity");
assert.equal(BLOCK_TYPES.indexOf("bricks"), 32, "bricks appends after clay");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("stone_brick_slab"), 30);
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("clay"), 31, "clay persists as code 32");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("bricks"), 32, "bricks persists as code 33");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.length, 768);
assert.ok(WORLD_CHUNK_BLOCK_TYPES.length <= WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES);
assert.equal(isBlockType("clay"), true);
assert.equal(isBlockType("bricks"), true);
const snapshot = createWorldChunkSnapshot("0:0", [
  { x: 1, y: 8, z: 2, blockType: "clay" },
  { x: 2, y: 8, z: 2, blockType: "bricks" },
]);
assert.equal(snapshot.ok, true);
if (snapshot.ok) assert.deepEqual(decodeWorldChunkSnapshot("0:0", snapshot.snapshotJson), {
  ok: true,
  edits: [
    { coordKey: "1:8:2", x: "1", y: "8", z: "2", blockType: "clay" },
    { coordKey: "2:8:2", x: "2", y: "8", z: "2", blockType: "bricks" },
  ],
});

const clayInventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
clayInventory[1] = { itemId: "wooden_shovel", count: 1, durability: ITEMS.wooden_shovel.tool!.maxDurability };
const mineClay = {
  operationId: "clay_mine_task85_0001",
  kind: "mine",
  x: 4,
  y: 6,
  z: -3,
  expectedBlock: "clay",
  selectedHotbar: 1,
  expectedHeldItem: "wooden_shovel",
  expectedInventoryRevision: "5",
  expectedChunkRevision: "9",
} as const;
assert.equal(parseWorldBlockOperation(mineClay).ok, true);
const minedClay = resolveWorldBlockOperation(mineClay, {
  currentBlock: "clay",
  inventory: clayInventory,
  inventoryRevision: "5",
  chunkRevision: "9",
});
assert.equal(minedClay.ok, true);
if (!minedClay.ok) throw new Error("clay mining fixture must resolve");
assert.deepEqual(minedClay.effect.drop, { itemId: "clay_ball", count: 4 });
assert.deepEqual(minedClay.effect.inventory[0], { itemId: "clay_ball", count: 4 });
assert.equal(minedClay.effect.toolUse.remainingDurability, ITEMS.wooden_shovel.tool!.maxDurability - 1);
assert.deepEqual(resolveWorldBlockOperation(mineClay, {
  currentBlock: minedClay.effect.nextBlock,
  inventory: minedClay.effect.inventory,
  inventoryRevision: minedClay.effect.inventoryRevision,
  chunkRevision: minedClay.effect.chunkRevision,
}), { ok: false, reason: "stale_chunk_revision" }, "a stale replay cannot duplicate four clay balls");

assert.equal(placedWorldBlockForItem("bricks"), "bricks");
const brickInventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
brickInventory[0] = { itemId: "bricks", count: 1 };
brickInventory[1] = { itemId: "wooden_pickaxe", count: 1, durability: ITEMS.wooden_pickaxe.tool!.maxDurability };
const placeBricks = {
  operationId: "brick_place_task85_01",
  kind: "place",
  x: 5,
  y: 6,
  z: -3,
  expectedBlock: "air",
  placedBlock: "bricks",
  selectedHotbar: 0,
  expectedHeldItem: "bricks",
  expectedInventoryRevision: "11",
  expectedChunkRevision: "21",
} as const;
const placedBricks = resolveWorldBlockOperation(placeBricks, {
  currentBlock: "air",
  inventory: brickInventory,
  inventoryRevision: "11",
  chunkRevision: "21",
});
assert.equal(placedBricks.ok, true);
if (!placedBricks.ok) throw new Error("bricks placement fixture must resolve");
assert.equal(placedBricks.effect.inventory[0], null, "placing consumes exactly one bricks block");
const mineBricks = {
  operationId: "brick_mine_task85_001",
  kind: "mine",
  x: 5,
  y: 6,
  z: -3,
  expectedBlock: "bricks",
  selectedHotbar: 1,
  expectedHeldItem: "wooden_pickaxe",
  expectedInventoryRevision: placedBricks.effect.inventoryRevision,
  expectedChunkRevision: placedBricks.effect.chunkRevision,
} as const;
const minedBricks = resolveWorldBlockOperation(mineBricks, {
  currentBlock: "bricks",
  inventory: placedBricks.effect.inventory,
  inventoryRevision: placedBricks.effect.inventoryRevision,
  chunkRevision: placedBricks.effect.chunkRevision,
});
assert.equal(minedBricks.ok, true);
if (!minedBricks.ok) throw new Error("bricks mining fixture must resolve");
assert.deepEqual(minedBricks.effect.drop, { itemId: "bricks", count: 1 });
assert.deepEqual(minedBricks.effect.inventory[0], { itemId: "bricks", count: 1 });

console.log("Task 85 clay, brick smelting, exact bricks crafting, codec, and operation tests passed");
