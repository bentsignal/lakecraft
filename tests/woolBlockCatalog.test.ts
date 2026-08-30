import assert from "node:assert/strict";
import {
  BLOCKS,
  ITEMS,
  RECIPES,
  addItem,
  craftRecipe,
  createEmptyInventory,
  getMiningDrop,
} from "../shared/game.ts";
import {
  WORLD_CHUNK_BLOCK_TYPES,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
} from "../shared/worldChunks.ts";

assert.deepEqual(BLOCKS.wool, {
  id: "wool",
  label: "White Wool",
  description: "A soft building block clipped from sheep.",
  color: "#ddd8c8",
  accent: "#f3f0e7",
  hardness: 0.8,
  preferredTool: "hand",
  drop: "wool",
});
assert.deepEqual(ITEMS.wool, {
  id: "wool",
  label: "White Wool",
  shortLabel: "WOL",
  description: "A soft building block clipped from sheep.",
  category: "block",
  maxStack: 64,
  glyph: "▦",
  color: "#ddd8c8",
  placesBlock: "wool",
});
assert.deepEqual(getMiningDrop("wool"), { itemId: "wool", count: 1 });
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("gravel"), 23, "the deployed gravel code remains stable");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.indexOf("wool"), 24, "wool appends as persisted code 25");

const snapshot = createWorldChunkSnapshot("0:0", [{
  id: "placed-wool",
  x: 4,
  y: 7,
  z: 4,
  blockType: "wool",
  editedAt: "1",
}]);
assert.equal(snapshot.ok, true);
if (snapshot.ok) {
  assert.deepEqual(decodeWorldChunkSnapshot("0:0", snapshot.snapshotJson), {
    ok: true,
    edits: [{ coordKey: "4:7:4", x: "4", y: "7", z: "4", blockType: "wool" }],
  });
}

const bedRecipe = RECIPES.find(({ id }) => id === "bed");
assert.deepEqual(bedRecipe?.ingredients, [
  { itemId: "wool", count: 3, tag: "wool" },
  { itemId: "planks", count: 3, tag: "wooden_planks" },
]);
let inventory = addItem(createEmptyInventory(), "wool", 3).inventory;
inventory = addItem(inventory, "planks", 3).inventory;
const crafted = craftRecipe(inventory, bedRecipe!);
assert.equal(crafted.ok, true);
if (crafted.ok) assert.equal(crafted.crafted.itemId, "bed");

console.log("wool block catalog and persisted chunk codec tests passed");
