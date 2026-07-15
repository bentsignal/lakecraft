import assert from "node:assert/strict";
import {
  APPLE_DROP_CHANCE_DENOMINATOR,
  BLOCKS,
  ITEMS,
  RECIPES,
  SAPLING_DROP_CHANCE_DENOMINATOR,
  addItem,
  craftRecipe,
  createEmptyInventory,
  createItemStack,
  getDeterministicMiningDrop,
  getMiningDrop,
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
import { resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";

assert.deepEqual(BLOCKS.sapling, {
  id: "sapling",
  label: "Oak Sapling",
  description: "A young oak that can grow on dirt or grass.",
  color: "#477537",
  accent: "#82a94e",
  hardness: 0,
  preferredTool: "hand",
  drop: "sapling",
});
assert.equal(ITEMS.sapling.category, "block");
assert.equal(ITEMS.sapling.placesBlock, "sapling");
assert.equal(ITEMS.sapling.maxStack, 64);
assert.deepEqual(getMiningDrop("sapling"), { itemId: "sapling", count: 1 });
assert.deepEqual(ITEMS.bone_meal, {
  id: "bone_meal",
  label: "Bone Meal",
  shortLabel: "BML",
  description: "Powdered bone that rapidly grows oak saplings.",
  category: "material",
  maxStack: 64,
  glyph: "⁙",
  color: "#e6e1ce",
});

const boneMealRecipe = RECIPES.find(({ id }) => id === "bone_meal");
assert.deepEqual(boneMealRecipe, {
  id: "bone_meal",
  label: "Bone meal",
  note: "One bone makes three handfuls of bone meal.",
  craftingContext: "field",
  ingredients: [{ itemId: "bone", count: 1 }],
  output: { itemId: "bone_meal", count: 3 },
});
assert.deepEqual(INITIAL_RECIPE_PATTERNS.bone_meal, { kind: "shapeless", ingredients: ["bone"] });
assert.equal(CRAFTING_GRID_RECIPES.length, RECIPES.length, "every aggregate recipe has one exact grid adapter");
assert.equal(Object.keys(INITIAL_RECIPE_PATTERNS).length, RECIPES.length, "every aggregate recipe has one authored grid pattern");
assert.equal(new Set(CRAFTING_GRID_RECIPES.map(({ id }) => id)).size, RECIPES.length);
const boneGrid = [{ itemId: "bone", count: 1 }, null, null, null] as const;
assert.equal(matchCraftingGrid(boneGrid, 2)?.recipe.id, "bone_meal");
const gridCraft = takeCraftingResult({ grid: boneGrid, cursor: null }, 2);
assert.equal(gridCraft.ok, true);
if (gridCraft.ok) {
  assert.deepEqual(gridCraft.state.cursor, { itemId: "bone_meal", count: 3 });
  assert.deepEqual(gridCraft.state.grid, [null, null, null, null]);
}
let inventory = addItem(createEmptyInventory(), "bone", 1).inventory;
const aggregateCraft = craftRecipe(inventory, boneMealRecipe!);
assert.equal(aggregateCraft.ok, true);
if (aggregateCraft.ok) {
  inventory = aggregateCraft.inventory;
  assert.equal(inventory.some((stack) => stack?.itemId === "bone_meal" && stack.count === 3), true);
  assert.equal(inventory.some((stack) => stack?.itemId === "bone"), false);
}

assert.equal(BLOCK_TYPES.indexOf("wool"), 24, "wool's deployed protocol index remains stable");
assert.equal(BLOCK_TYPES.indexOf("sapling"), 25, "sapling appends to the protocol palette");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("wool"), 24, "wool's persisted code remains stable");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("sapling"), 25, "sapling appends as persisted code 26");
assert.equal(isBlockType("sapling"), true);
const snapshot = createWorldChunkSnapshot("0:0", [{ x: 2, y: 8, z: 3, blockType: "sapling" }]);
assert.equal(snapshot.ok, true);
if (snapshot.ok) assert.deepEqual(decodeWorldChunkSnapshot("0:0", snapshot.snapshotJson), {
  ok: true,
  edits: [{ coordKey: "2:8:3", x: "2", y: "8", z: "3", blockType: "sapling" }],
});
const saplingInventory = createEmptyInventory();
saplingInventory[0] = createItemStack("sapling", 2);
const placed = resolveWorldBlockOperation({
  operationId: "place_oak_sapling_0001",
  kind: "place",
  x: 2,
  y: 8,
  z: 3,
  expectedBlock: "air",
  placedBlock: "sapling",
  selectedHotbar: 0,
  expectedHeldItem: "sapling",
  expectedInventoryRevision: "4",
  expectedChunkRevision: "9",
}, {
  currentBlock: "air",
  inventory: saplingInventory,
  inventoryRevision: "4",
  chunkRevision: "9",
});
assert.equal(placed.ok, true);
if (placed.ok) {
  assert.equal(placed.effect.nextBlock, "sapling");
  assert.deepEqual(placed.effect.inventory[0], { itemId: "sapling", count: 1 });
}

assert.equal(APPLE_DROP_CHANCE_DENOMINATOR, 200);
assert.equal(SAPLING_DROP_CHANCE_DENOMINATOR, 20);
const drops = Array.from({ length: 20_000 }, (_, index) => (
  getDeterministicMiningDrop("leaves", null, index - 10_000, 63, -41)?.itemId ?? null
));
assert.deepEqual(drops, Array.from({ length: 20_000 }, (_, index) => (
  getDeterministicMiningDrop("leaves", null, index - 10_000, 63, -41)?.itemId ?? null
)), "leaf loot replays byte-for-byte from coordinates");
const apples = drops.filter((drop) => drop === "apple").length;
const saplings = drops.filter((drop) => drop === "sapling").length;
assert.ok(apples >= 70 && apples <= 130, `apple sample ${apples}/20000 escaped the 1/200 budget`);
assert.ok(saplings >= 850 && saplings <= 1_150, `sapling sample ${saplings}/20000 escaped the 1/20 budget`);
assert.ok(drops.every((drop) => drop === null || drop === "apple" || drop === "sapling"));
for (let index = 0; index < 500; index += 1) {
  assert.deepEqual(getDeterministicMiningDrop("leaves", "shears", index, 63, -41), { itemId: "leaves", count: 1 });
}

console.log(JSON.stringify({ apples, saplings, samples: drops.length }));
console.log("Task 77 shared sapling, bone-meal recipe, codec, and conserved leaf-drop rules passed");
