import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
  sampleWorldChunkSnapshot,
} from "../shared/worldChunks.ts";
import {
  parseWorldBlockOperation,
  placedWorldBlockForItem,
  resolveWorldBlockOperation,
} from "../shared/worldBlockOperations.ts";
import { planCreeperBlockDrops } from "../shared/creeperExplosion.ts";
import {
  PRESENCE_ACTIVE_WRITE_INTERVAL_MS,
  PRESENCE_SAMPLE_INTERVAL_MS,
  PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS,
} from "../shared/presenceMotion.ts";

assert.deepEqual(BLOCKS.stone_brick_slab, {
  id: "stone_brick_slab",
  label: "Stone Brick Slab",
  description: "A half-height course of fitted stone bricks.",
  color: "#74766f",
  accent: "#a3a59c",
  hardness: 1.5,
  preferredTool: "pickaxe",
  requiredDropTool: { kind: "pickaxe", minimumTier: "wood" },
  drop: "stone_brick_slab",
});
assert.equal(ITEMS.stone_brick_slab.category, "block");
assert.equal(ITEMS.stone_brick_slab.placesBlock, "stone_brick_slab");
assert.equal(ITEMS.stone_brick_slab.maxStack, 64);
assert.deepEqual(getMiningDrop("stone_brick_slab", "wooden_pickaxe"), {
  itemId: "stone_brick_slab",
  count: 1,
});

assert.deepEqual(RECIPES.find(({ id }) => id === "stone_brick_slab"), {
  id: "stone_brick_slab",
  label: "Stone brick slabs",
  note: "Three stone bricks make six half-height building slabs.",
  craftingContext: "crafting_table",
  ingredients: [{ itemId: "stone_bricks", count: 3 }],
  output: { itemId: "stone_brick_slab", count: 6 },
});
assert.deepEqual(INITIAL_RECIPE_PATTERNS.stone_brick_slab, {
  kind: "shaped",
  pattern: [["stone_bricks", "stone_bricks", "stone_bricks"]],
});

const slabGrid = createCraftingGrid(3).slice();
for (const slot of [3, 4, 5]) slabGrid[slot] = { itemId: "stone_bricks", count: 1 };
assert.equal(matchCraftingGrid(slabGrid, 3)?.recipe.id, "stone_brick_slab",
  "the exact three-wide middle row crafts slabs");
const slabCraft = takeCraftingResult({ grid: slabGrid, cursor: null }, 3);
assert.equal(slabCraft.ok, true);
if (slabCraft.ok) {
  assert.deepEqual(slabCraft.state.cursor, { itemId: "stone_brick_slab", count: 6 });
  assert.ok(slabCraft.state.grid.every((stack) => stack === null));
}
for (const row of [0, 2]) {
  const translated = createCraftingGrid(3).slice();
  for (let column = 0; column < 3; column += 1) translated[row * 3 + column] = { itemId: "stone_bricks", count: 1 };
  assert.equal(matchCraftingGrid(translated, 3)?.recipe.id, "stone_brick_slab",
    `the horizontal slab row may occupy crafting row ${row + 1}`);
}
const vertical = createCraftingGrid(3).slice();
for (const slot of [1, 4, 7]) vertical[slot] = { itemId: "stone_bricks", count: 1 };
assert.notEqual(matchCraftingGrid(vertical, 3)?.recipe.id, "stone_brick_slab",
  "a vertical column is not a slab recipe");
const extra = slabGrid.slice();
extra[0] = { itemId: "stone_bricks", count: 1 };
assert.notEqual(matchCraftingGrid(extra, 3)?.recipe.id, "stone_brick_slab",
  "extra ingredients invalidate the exact recipe");

let aggregate = addItem(createEmptyInventory(), "stone_bricks", 3).inventory;
const aggregateCraft = craftRecipe(aggregate, "stone_brick_slab", "crafting_table");
assert.equal(aggregateCraft.ok, true);
if (aggregateCraft.ok) {
  aggregate = aggregateCraft.inventory;
  assert.equal(countItem(aggregate, "stone_bricks"), 0);
  assert.equal(countItem(aggregate, "stone_brick_slab"), 6);
}

const stableProtocol = [
  ["sapling", 25],
  ["stone_bricks", 26],
  ["oak_fence", 27],
  ["oak_fence_gate_closed", 28],
  ["oak_fence_gate_open", 29],
] as const;
for (const [block, index] of stableProtocol) {
  assert.equal(BLOCK_TYPES.indexOf(block), index, `${block} keeps its deployed protocol index`);
  assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf(block), index, `${block} keeps its deployed persisted code ${index + 1}`);
}
assert.equal(BLOCK_TYPES.indexOf("stone_brick_slab"), 30, "the slab keeps its deployed append-only protocol identity");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("stone_brick_slab"), 30,
  "the slab keeps its deployed persisted code 31");
assert.ok(WORLD_CHUNK_BLOCK_TYPES.length >= 31,
  "the deployed append-only palette remains stable through slab code 31");
assert.ok(WORLD_CHUNK_BLOCK_TYPES.length <= WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES,
  "the deployed palette fits within the expanded codec capacity");
assert.equal(isBlockType("stone_brick_slab"), true);

const snapshot = createWorldChunkSnapshot("0:0", [
  { x: 1, y: 9, z: 1, blockType: "oak_fence_gate_open" },
  { x: 2, y: 9, z: 1, blockType: "stone_brick_slab" },
]);
assert.equal(snapshot.ok, true);
if (snapshot.ok) {
  assert.deepEqual(decodeWorldChunkSnapshot("0:0", snapshot.snapshotJson), {
    ok: true,
    edits: [
      { coordKey: "1:9:1", x: "1", y: "9", z: "1", blockType: "oak_fence_gate_open" },
      { coordKey: "2:9:1", x: "2", y: "9", z: "1", blockType: "stone_brick_slab" },
    ],
  });
  assert.deepEqual(sampleWorldChunkSnapshot("0:0", snapshot.snapshotJson, [
    { x: 1, y: 9, z: 1 },
    { x: 2, y: 9, z: 1 },
  ]), { ok: true, blocks: ["oak_fence_gate_open", "stone_brick_slab"] });
}

assert.equal(placedWorldBlockForItem("stone_brick_slab"), "stone_brick_slab");
const operationInventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
operationInventory[0] = { itemId: "stone_brick_slab", count: 1 };
operationInventory[1] = { itemId: "wooden_pickaxe", count: 1, durability: ITEMS.wooden_pickaxe.tool!.maxDurability };
const placeRequest = {
  operationId: "stone_slab_place_0001",
  kind: "place",
  x: 4,
  y: 8,
  z: -2,
  expectedBlock: "air",
  placedBlock: "stone_brick_slab",
  selectedHotbar: 0,
  expectedHeldItem: "stone_brick_slab",
  expectedInventoryRevision: "3",
  expectedChunkRevision: "9",
} as const;
assert.equal(parseWorldBlockOperation(placeRequest).ok, true);
const placed = resolveWorldBlockOperation(placeRequest, {
  currentBlock: "air",
  inventory: operationInventory,
  inventoryRevision: "3",
  chunkRevision: "9",
});
assert.equal(placed.ok, true);
if (!placed.ok) throw new Error("slab placement fixture must resolve");
assert.equal(placed.effect.nextBlock, "stone_brick_slab");
assert.equal(placed.effect.inventory[0], null, "generic placement consumes exactly one slab");

const mineRequest = {
  operationId: "stone_slab_mine_00001",
  kind: "mine",
  x: 4,
  y: 8,
  z: -2,
  expectedBlock: "stone_brick_slab",
  selectedHotbar: 1,
  expectedHeldItem: "wooden_pickaxe",
  expectedInventoryRevision: placed.effect.inventoryRevision,
  expectedChunkRevision: placed.effect.chunkRevision,
} as const;
assert.equal(parseWorldBlockOperation(mineRequest).ok, true);
const mined = resolveWorldBlockOperation(mineRequest, {
  currentBlock: "stone_brick_slab",
  inventory: placed.effect.inventory,
  inventoryRevision: placed.effect.inventoryRevision,
  chunkRevision: placed.effect.chunkRevision,
});
assert.equal(mined.ok, true);
if (!mined.ok) throw new Error("slab mining fixture must resolve");
assert.deepEqual(mined.effect.drop, { itemId: "stone_brick_slab", count: 1 });
assert.deepEqual(mined.effect.inventory[0], { itemId: "stone_brick_slab", count: 1 });
assert.equal(mined.effect.toolUse.remainingDurability, ITEMS.wooden_pickaxe.tool!.maxDurability - 1);
assert.deepEqual(resolveWorldBlockOperation(mineRequest, {
  currentBlock: mined.effect.nextBlock,
  inventory: mined.effect.inventory,
  inventoryRevision: mined.effect.inventoryRevision,
  chunkRevision: mined.effect.chunkRevision,
}), { ok: false, reason: "stale_chunk_revision" },
"the shared exact operation path cannot duplicate the slab drop on replay");
assert.deepEqual(planCreeperBlockDrops("slab-blast-2", [{
  x: 1,
  y: 7,
  z: 0,
  coordKey: "1:7:0",
  distanceSquared: 0,
  previousBlock: "stone_brick_slab",
}]), [{ itemId: "stone_brick_slab", count: 1 }],
"a surviving creeper-blast roll preserves the canonical slab item identity");

assert.equal(PRESENCE_ACTIVE_WRITE_INTERVAL_MS, 200);
assert.equal(PRESENCE_SAMPLE_INTERVAL_MS, 50);
assert.equal(PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS, 150,
  "adding a slab cannot increase Lakebed presence/network cadence");
const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.equal(engineSource.match(/gl\.drawArrays\(/g)?.length, 12,
  "the slab must stay inside retained chunk buffers and add no draw pass");
assert.doesNotMatch(engineSource, /STONE_BRICK_SLAB[\s\S]{0,180}gl\.drawArrays\(/,
  "slab geometry cannot draw itself outside the existing chunk batch");
const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const multiplayerSource = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singlePlayerSource = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
for (const [label, source] of [["multiplayer", multiplayerSource], ["single-player", singlePlayerSource]] as const) {
  assert.match(source, /\[BLOCK\.STONE_BRICK_SLAB\]:\s*"stone_brick_slab"/,
    `${label} maps engine slab 30 back to its canonical game identity`);
  assert.match(source, /stone_brick_slab:\s*BLOCK\.STONE_BRICK_SLAB/,
    `${label} maps the held slab item into engine block 30`);
  assert.match(source, /BLOCK\.STONE_BRICKS \|\| block === BLOCK\.STONE_BRICK_SLAB[^\n]*return "stone"/,
    `${label} reuses the existing stone mining, placement, and footstep audio surface`);
}
assert.match(multiplayerSource, /\[BLOCK\.STONE_BRICK_SLAB\]:\s*"stone_brick_slab"[\s\S]*?stone_brick_slab:\s*BLOCK\.STONE_BRICK_SLAB/,
  "multiplayer round-trips engine, protocol, item, and game slab identities");
assert.match(singlePlayerSource, /edit\.block\s*<=\s*BLOCK\.BRICKS/,
  "single-player persistence admits every later append-only engine ID");
const worldMutation = serverSource.slice(
  serverSource.indexOf("editWorldBlock: mutation(async"),
  serverSource.indexOf("startPresenceSession: mutation("),
);
assert.doesNotMatch(serverSource, /stoneBrickSlab[^\n]*mutation|mutation[^\n]*stoneBrickSlab/i,
  "the slab adds no dedicated Lakebed mutation");
assert.doesNotMatch(worldMutation, /setInterval|setTimeout|fetch\(/,
  "slabs reuse the discrete exact-once world operation without polling");

console.log("Task 83 shared slab catalog, exact recipe, final codec identity, generic operation, and cadence budgets passed");
