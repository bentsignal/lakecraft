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
assert.deepEqual(BLOCK_TYPES, [
  "air", "grass", "dirt", "stone", "wood", "leaves", "planks", "crafting_table",
  "torch", "chest", "door_closed", "door_open", "bed", "coal_ore", "iron_ore",
  "gold_ore", "diamond_ore", "furnace", "ladder", "cobblestone", "sand", "glass", "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence", "oak_fence_gate_closed", "oak_fence_gate_open", "stone_brick_slab", "clay", "bricks", "bedrock",
], "network block identity appends clay and bricks without renumbering shipped blocks");
assert.deepEqual(WORLD_CHUNK_BLOCK_TYPES, [
  "air", "grass", "dirt", "stone", "wood", "leaves", "planks", "crafting_table",
  "torch", "chest", "bed", "door_closed", "door_open", "coal_ore", "iron_ore",
  "furnace", "ladder", "cobblestone", "sand", "glass", "gold_ore", "diamond_ore", "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence", "oak_fence_gate_closed", "oak_fence_gate_open", "stone_brick_slab", "clay", "bricks",
], "persisted snapshot palette appends v4 codes 32 and 33 without renumbering deployed rows");

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

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
for (const [source, label] of [[multiplayer, "multiplayer"], [singleplayer, "single-player"]] as const) {
  assert.match(source, /\[BLOCK\.TNT\]:\s*"tnt"/, `${label} maps engine TNT back to the shared item/block identity`);
  assert.match(source, /tnt:\s*BLOCK\.TNT/, `${label} maps shared TNT into engine block 22`);
}
assert.ok(remoteHeldItemGeometry("gunpowder").length > 0, "remote hands render extruded canonical loose gunpowder");
assert.equal(remoteHeldItemGeometry("tnt").length / 6, 36, "remote TNT is a true bounded six-face cube");
assert.notDeepEqual(remoteHeldItemGeometry("tnt"), remoteHeldItemGeometry("gunpowder"));

console.log("gunpowder and TNT catalog/visual contract tests passed");
