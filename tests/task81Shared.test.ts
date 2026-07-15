import assert from "node:assert/strict";
import {
  BLOCKS,
  INVENTORY_SIZE,
  ITEMS,
  RECIPES,
  addItem,
  countItem,
  craftRecipe,
  createEmptyInventory,
  getMiningDrop,
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
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
} from "../shared/worldChunks.ts";
import {
  gameBlockForWorldBlock,
  isToggleableWorldBlock,
  parseWorldBlockOperation,
  placedWorldBlockForItem,
  resolveWorldBlockOperation,
  toggledWorldBlock,
} from "../shared/worldBlockOperations.ts";

assert.deepEqual(BLOCKS.oak_fence_gate, {
  id: "oak_fence_gate",
  label: "Oak Fence Gate",
  description: "A hinged oak gate that opens a passage through connected fences.",
  color: "#8d5a2b",
  accent: "#c28a47",
  hardness: 2,
  preferredTool: "axe",
  drop: "oak_fence_gate",
});
assert.equal(ITEMS.oak_fence_gate.category, "block");
assert.equal(ITEMS.oak_fence_gate.placesBlock, "oak_fence_gate");
assert.equal(ITEMS.oak_fence_gate.maxStack, 64);
assert.deepEqual(getMiningDrop("oak_fence_gate"), { itemId: "oak_fence_gate", count: 1 });

const recipe = RECIPES.find(({ id }) => id === "oak_fence_gate");
assert.deepEqual(recipe, {
  id: "oak_fence_gate",
  label: "Oak fence gate",
  note: "Two boards and four sticks make one hinged oak gate.",
  craftingContext: "crafting_table",
  ingredients: [{ itemId: "planks", count: 2 }, { itemId: "stick", count: 4 }],
  output: { itemId: "oak_fence_gate", count: 1 },
});
assert.deepEqual(INITIAL_RECIPE_PATTERNS.oak_fence_gate, {
  kind: "shaped",
  pattern: [["stick", "planks", "stick"], ["stick", "planks", "stick"]],
});

const grid = createCraftingGrid(3).slice();
for (const [slot, itemId] of [[0, "stick"], [1, "planks"], [2, "stick"], [3, "stick"], [4, "planks"], [5, "stick"]] as const) {
  grid[slot] = { itemId, count: 1 };
}
assert.equal(matchCraftingGrid(grid, 3)?.recipe.id, "oak_fence_gate");
const gridCraft = takeCraftingResult({ grid, cursor: null }, 3);
assert.equal(gridCraft.ok, true);
if (gridCraft.ok) {
  assert.deepEqual(gridCraft.state.cursor, { itemId: "oak_fence_gate", count: 1 });
  assert.ok(gridCraft.state.grid.every((stack) => stack === null));
}
const malformed = grid.slice();
malformed[2] = { itemId: "planks", count: 1 };
assert.equal(matchCraftingGrid(malformed, 3), null, "swapping one gate stick for a plank fails exact matching");

let ingredients = addItem(createEmptyInventory(), "stick", 4).inventory;
ingredients = addItem(ingredients, "planks", 2).inventory;
const aggregateCraft = craftRecipe(ingredients, "oak_fence_gate", "crafting_table");
assert.equal(aggregateCraft.ok, true);
if (aggregateCraft.ok) {
  assert.equal(countItem(aggregateCraft.inventory, "stick"), 0);
  assert.equal(countItem(aggregateCraft.inventory, "planks"), 0);
  assert.equal(countItem(aggregateCraft.inventory, "oak_fence_gate"), 1);
}

assert.equal(BLOCK_TYPES.indexOf("oak_fence"), 27);
assert.equal(BLOCK_TYPES.indexOf("oak_fence_gate_closed"), 28);
assert.equal(BLOCK_TYPES.indexOf("oak_fence_gate_open"), 29);
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("oak_fence"), 27);
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("oak_fence_gate_closed"), 28, "closed gate persists as code 29");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("oak_fence_gate_open"), 29, "open gate persists as code 30");
assert.equal(isBlockType("oak_fence_gate_closed"), true);
assert.equal(isBlockType("oak_fence_gate_open"), true);
const snapshot = createWorldChunkSnapshot("0:0", [
  { x: 1, y: 9, z: 1, blockType: "oak_fence_gate_closed" },
  { x: 2, y: 9, z: 1, blockType: "oak_fence_gate_open" },
]);
assert.equal(snapshot.ok, true);
if (snapshot.ok) {
  assert.deepEqual(decodeWorldChunkSnapshot("0:0", snapshot.snapshotJson), {
    ok: true,
    edits: [
      { coordKey: "1:9:1", x: "1", y: "9", z: "1", blockType: "oak_fence_gate_closed" },
      { coordKey: "2:9:1", x: "2", y: "9", z: "1", blockType: "oak_fence_gate_open" },
    ],
  });
}

assert.equal(placedWorldBlockForItem("oak_fence_gate"), "oak_fence_gate_closed");
assert.equal(gameBlockForWorldBlock("oak_fence_gate_closed"), "oak_fence_gate");
assert.equal(gameBlockForWorldBlock("oak_fence_gate_open"), "oak_fence_gate");
for (const block of ["door_closed", "door_open", "oak_fence_gate_closed", "oak_fence_gate_open"] as const) {
  assert.equal(isToggleableWorldBlock(block), true);
  assert.equal(toggledWorldBlock(toggledWorldBlock(block)), block, `${block} closes over a two-toggle cycle`);
}
assert.equal(isToggleableWorldBlock("oak_fence"), false);

const gateToggle = {
  operationId: "gate_toggle_000001",
  kind: "toggle",
  x: 4,
  y: 8,
  z: -2,
  expectedBlock: "oak_fence_gate_closed",
  expectedChunkRevision: "7",
} as const;
assert.equal(parseWorldBlockOperation(gateToggle).ok, true);
assert.equal(parseWorldBlockOperation({ ...gateToggle, expectedBlock: "oak_fence" }).ok, false);
const untouchedInventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
const opened = resolveWorldBlockOperation(gateToggle, {
  currentBlock: "oak_fence_gate_closed",
  inventory: untouchedInventory,
  inventoryRevision: "3",
  chunkRevision: "7",
});
assert.equal(opened.ok, true);
if (!opened.ok) throw new Error("unreachable");
assert.equal(opened.effect.nextBlock, "oak_fence_gate_open");
assert.equal(opened.effect.chunkRevision, "8");
assert.equal(opened.effect.inventoryRevision, "3");
assert.equal(opened.effect.inventoryChanged, false);
assert.deepEqual(opened.effect.inventory, untouchedInventory);
assert.deepEqual(resolveWorldBlockOperation(gateToggle, {
  currentBlock: opened.effect.nextBlock,
  inventory: opened.effect.inventory,
  inventoryRevision: opened.effect.inventoryRevision,
  chunkRevision: opened.effect.chunkRevision,
}), { ok: false, reason: "stale_chunk_revision" }, "an exact replay cannot toggle or duplicate anything twice");

const closeRequest = { ...gateToggle, operationId: "gate_toggle_000002", expectedBlock: "oak_fence_gate_open" as const, expectedChunkRevision: "8" };
const closed = resolveWorldBlockOperation(closeRequest, {
  currentBlock: "oak_fence_gate_open",
  inventory: opened.effect.inventory,
  inventoryRevision: "3",
  chunkRevision: "8",
});
assert.equal(closed.ok, true);
if (closed.ok) assert.equal(closed.effect.nextBlock, "oak_fence_gate_closed");

const placeInventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
placeInventory[0] = { itemId: "oak_fence_gate", count: 1 };
const placeRequest = {
  operationId: "gate_place_000001",
  kind: "place",
  x: 4,
  y: 8,
  z: -2,
  expectedBlock: "air",
  placedBlock: "oak_fence_gate_closed",
  selectedHotbar: 0,
  expectedHeldItem: "oak_fence_gate",
  expectedInventoryRevision: "0",
  expectedChunkRevision: "0",
} as const;
const placed = resolveWorldBlockOperation(placeRequest, {
  currentBlock: "air",
  inventory: placeInventory,
  inventoryRevision: "0",
  chunkRevision: "0",
});
assert.equal(placed.ok, true);
if (placed.ok) {
  assert.equal(placed.effect.nextBlock, "oak_fence_gate_closed");
  assert.equal(placed.effect.consumed, "oak_fence_gate");
  assert.equal(countItem(placed.effect.inventory, "oak_fence_gate"), 0);
}

for (const state of ["oak_fence_gate_closed", "oak_fence_gate_open"] as const) {
  const mined = resolveWorldBlockOperation({
    operationId: `gate_mine_${state === "oak_fence_gate_closed" ? "closed" : "opened"}`,
    kind: "mine",
    x: 4,
    y: 8,
    z: -2,
    expectedBlock: state,
    selectedHotbar: 0,
    expectedHeldItem: null,
    expectedInventoryRevision: "0",
    expectedChunkRevision: "0",
  }, {
    currentBlock: state,
    inventory: createEmptyInventory(),
    inventoryRevision: "0",
    chunkRevision: "0",
  });
  assert.equal(mined.ok, true);
  if (mined.ok) {
    assert.deepEqual(mined.effect.drop, { itemId: "oak_fence_gate", count: 1 });
    assert.equal(countItem(mined.effect.inventory, "oak_fence_gate"), 1, `${state} conserves one item identity`);
  }
}

console.log("Task 81 fence-gate shared recipe, codec, parser, exact-once toggle, and conservation tests passed");
