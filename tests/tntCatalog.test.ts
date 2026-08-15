import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCKS, ITEMS, RECIPES, createEmptyInventory, addItem, craftRecipe } from "../shared/game.ts";
import { BLOCK_TYPES, isBlockType } from "../shared/protocol.ts";
import { WORLD_CHUNK_BLOCK_TYPES, createWorldChunkSnapshot, decodeWorldChunkSnapshot } from "../shared/worldChunks.ts";
import { INITIAL_RECIPE_PATTERNS, matchCraftingGrid } from "../shared/craftingGrid.ts";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockTextureForFace } from "../client/game/blockTextures.ts";
import { BLOCK } from "../client/game/types.ts";
import { remoteHeldItemGeometry } from "../client/game/remotePlayerRenderer.ts";

assert.equal(ITEMS.gunpowder.category, "material");
assert.equal(ITEMS.gunpowder.maxStack, 64);
assert.equal(ITEMS.tnt.placesBlock, "tnt");
assert.equal(BLOCKS.tnt.drop, "tnt");
assert.equal(BLOCKS.tnt.preferredTool, "hand");
assert.equal(isBlockType("tnt"), true);
assert.equal(BLOCK_TYPES.indexOf("tnt"), 22, "the deployed TNT protocol code remains stable");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("tnt"), 22, "the deployed TNT persisted code remains stable");
const deployedProtocolPrefix = [
  "air", "grass", "dirt", "stone", "wood", "leaves", "planks", "crafting_table",
  "torch", "chest", "door_closed", "door_open", "bed", "coal_ore", "iron_ore",
  "gold_ore", "diamond_ore", "furnace", "ladder", "cobblestone", "sand", "glass", "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence", "oak_fence_gate_closed", "oak_fence_gate_open", "stone_brick_slab", "clay", "bricks", "bedrock",
  "wall_torch_east", "wall_torch_north", "wall_torch_south", "wall_torch_west", "oak_slab", "cobblestone_slab", "brick_slab",
  "oak_stairs_east", "oak_stairs_north", "oak_stairs_south", "oak_stairs_west",
  "cobblestone_stairs_east", "cobblestone_stairs_north", "cobblestone_stairs_south", "cobblestone_stairs_west",
  "stone_brick_stairs_east", "stone_brick_stairs_north", "stone_brick_stairs_south", "stone_brick_stairs_west",
  "brick_stairs_east", "brick_stairs_north", "brick_stairs_south", "brick_stairs_west",
] as const;
assert.deepEqual(BLOCK_TYPES.slice(0, deployedProtocolPrefix.length), deployedProtocolPrefix,
  "network block identity preserves every shipped code before the creative expansion");
const deployedPersistencePrefix = [
  "air", "grass", "dirt", "stone", "wood", "leaves", "planks", "crafting_table",
  "torch", "chest", "bed", "door_closed", "door_open", "coal_ore", "iron_ore",
  "furnace", "ladder", "cobblestone", "sand", "glass", "gold_ore", "diamond_ore", "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence", "oak_fence_gate_closed", "oak_fence_gate_open", "stone_brick_slab", "clay", "bricks",
  "wall_torch_east", "wall_torch_north", "wall_torch_south", "wall_torch_west", "oak_slab", "cobblestone_slab", "brick_slab",
  "oak_stairs_east", "oak_stairs_north", "oak_stairs_south", "oak_stairs_west",
  "cobblestone_stairs_east", "cobblestone_stairs_north", "cobblestone_stairs_south", "cobblestone_stairs_west",
  "stone_brick_stairs_east", "stone_brick_stairs_north", "stone_brick_stairs_south", "stone_brick_stairs_west",
  "brick_stairs_east", "brick_stairs_north", "brick_stairs_south", "brick_stairs_west",
] as const;
assert.deepEqual(WORLD_CHUNK_BLOCK_TYPES.slice(0, deployedPersistencePrefix.length), deployedPersistencePrefix,
  "persisted snapshots preserve every deployed code before the creative expansion");

const recipe = RECIPES.find(({ id }) => id === "tnt");
assert.deepEqual(recipe?.ingredients, [{ itemId: "gunpowder", count: 5 }, { itemId: "sand", count: 4 }]);
let inventory = addItem(createEmptyInventory(), "gunpowder", 5).inventory;
inventory = addItem(inventory, "sand", 4).inventory;
const crafted = craftRecipe(inventory, recipe!);
assert.equal(crafted.ok, true);
if (crafted.ok) assert.equal(crafted.inventory.some((stack) => stack?.itemId === "tnt" && stack.count === 1), true);

const pattern = INITIAL_RECIPE_PATTERNS.tnt;
assert.equal(pattern.kind, "shaped");
if (pattern.kind === "shaped") {
  const grid = pattern.pattern.flat().map((itemId) => itemId ? { itemId, count: 1 } : null);
  assert.equal(matchCraftingGrid(grid, 3)?.recipe.id, "tnt");
}

const chunk = createWorldChunkSnapshot("0:0", [{ x: 1, y: 2, z: 3, blockType: "tnt" }]);
assert.equal(chunk.ok, true);
if (chunk.ok) assert.deepEqual(decodeWorldChunkSnapshot("0:0", chunk.snapshotJson), {
  ok: true,
  edits: [{ coordKey: "1:2:3", x: "1", y: "2", z: "3", blockType: "tnt" }],
});

assert.equal(blockTextureForFace(BLOCK.TNT, "north"), "tnt_side");
assert.equal(blockTextureForFace(BLOCK.TNT, "top"), "tnt_top");
assert.equal(blockTextureForFace(BLOCK.TNT, "bottom"), "tnt_bottom");
assert.ok(getItemIconArt("gunpowder").runs.length >= 8);
assert.ok(getItemIconArt("tnt").runs.length >= 8);

const catalog = readFileSync(new URL("../client/gameplay/catalog.ts", import.meta.url), "utf8");
assert.match(catalog, /\[BLOCK\.TNT\]:\s*"tnt"/, "the shared gameplay catalog maps engine TNT to its identity");
assert.match(catalog, /tnt:\s*BLOCK\.TNT/, "the shared gameplay catalog maps held TNT into the engine");
assert.ok(remoteHeldItemGeometry("gunpowder").length > 0, "remote hands render extruded canonical loose gunpowder");
assert.equal(remoteHeldItemGeometry("tnt").length / 6, 9_216, "remote TNT uses the exact authored 16x16 face geometry shared with local F5");
assert.notDeepEqual(remoteHeldItemGeometry("tnt"), remoteHeldItemGeometry("gunpowder"));

console.log("gunpowder and TNT catalog/visual contract tests passed");
