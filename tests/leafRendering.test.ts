import assert from "node:assert/strict";
import { blockFaceIsOccluded, isLeavesBlock } from "../client/game/voxelEngine.ts";
import {
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
} from "../client/game/generated/textureAtlas.ts";
import { BLOCK } from "../client/game/types.ts";

const tile = (name: typeof TEXTURE_ATLAS_NAMES[number]): Uint8Array => {
  const index = TEXTURE_ATLAS_NAMES.indexOf(name);
  const cell = TEXTURE_ATLAS_CELLS[index];
  const left = cell % TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
  const top = Math.floor(cell / TEXTURE_ATLAS_COLUMNS) * TEXTURE_TILE_SIZE;
  const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
  const output = new Uint8Array(TEXTURE_TILE_SIZE * TEXTURE_TILE_SIZE * 4);
  for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const source = ((top + y) * atlasWidth + left + x) * 4;
    output.set(TEXTURE_ATLAS_RGBA.subarray(source, source + 4), (y * TEXTURE_TILE_SIZE + x) * 4);
  }
  return output;
};

const leafNames = ["leaves", "spruce_leaves", "birch_leaves", "jungle_leaves",
  "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "cherry_leaves"] as const;
for (const name of leafNames) {
  const rgba = tile(name);
  let transparent = 0; let opaque = 0; let colored = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] < 128) transparent += 1;
    else {
      opaque += 1;
      if (rgba[offset] !== rgba[offset + 1] || rgba[offset + 1] !== rgba[offset + 2]) colored += 1;
    }
  }
  assert.ok(transparent >= 40, `${name} preserves the installed Minecraft cutout holes`);
  assert.ok(opaque >= 140, `${name} preserves a readable installed leaf silhouette`);
  assert.ok(colored >= 100, `${name} receives its reviewed Minecraft foliage color instead of the grayscale mask`);
}

assert.equal(isLeavesBlock(BLOCK.LEAVES), true);
assert.equal(isLeavesBlock(BLOCK.SPRUCE_LEAVES), true);
assert.equal(blockFaceIsOccluded(BLOCK.STONE, BLOCK.LEAVES), false,
  "leaf holes retain the neighboring terrain face instead of exposing the void");
assert.equal(blockFaceIsOccluded(BLOCK.WOOD, BLOCK.LEAVES), false,
  "leaf holes retain the neighboring trunk face");
assert.equal(blockFaceIsOccluded(BLOCK.LEAVES, BLOCK.WOOD), true,
  "the hidden leaf face against a solid trunk is still culled");
assert.equal(blockFaceIsOccluded(BLOCK.LEAVES, BLOCK.SPRUCE_LEAVES), false,
  "adjacent canopy cells retain Minecraft-style interior cutout layers");

const layeredCanopyFaces = (depth: number): number => {
  let faces = 0;
  for (let z = 0; z < depth; z += 1) {
    for (const neighbor of [z === 0 ? BLOCK.AIR : BLOCK.LEAVES, z === depth - 1 ? BLOCK.AIR : BLOCK.LEAVES]) {
      if (!blockFaceIsOccluded(BLOCK.LEAVES, neighbor)) faces += 1;
    }
  }
  return faces;
};
assert.equal(layeredCanopyFaces(1), 2, "one leaf cell has its two view-axis cutout faces");
assert.equal(layeredCanopyFaces(3), 6,
  "three leaf cells retain six distinct cutout layers instead of collapsing to one outer shell");

console.log("Minecraft cutout leaf tint, depth-neighbor, and layered-canopy tests passed");
