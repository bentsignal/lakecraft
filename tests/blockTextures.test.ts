import assert from "node:assert/strict";
import {
  TEXTURED_WORLD_VERTEX_FLOATS,
  blockTextureForFace,
  textureAtlasUv,
  type BlockFace,
} from "../client/game/blockTextures.ts";
import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_ATLAS_ROWS,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "../client/game/generated/textureAtlas.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";

const FACES: readonly BlockFace[] = ["east", "west", "top", "bottom", "south", "north"];
assert.equal(blockTextureForFace(BLOCK.GRASS, "top"), "grass_top");
assert.equal(blockTextureForFace(BLOCK.GRASS, "bottom"), "dirt");
for (const face of ["east", "west", "south", "north"] as const) {
  assert.equal(blockTextureForFace(BLOCK.GRASS, face), "grass_side");
}

const uniformMappings: ReadonlyArray<readonly [BlockId, TextureAtlasName]> = [
  [BLOCK.DIRT, "dirt"],
  [BLOCK.STONE, "stone"],
  [BLOCK.COBBLESTONE, "cobblestone"],
  [BLOCK.STONE_BRICKS, "stone_bricks"],
  [BLOCK.STONE_BRICK_SLAB, "stone_bricks"],
  [BLOCK.CLAY, "clay"],
  [BLOCK.BRICKS, "bricks"],
  [BLOCK.PLANKS, "oak_planks"],
  [BLOCK.LEAVES, "leaves"],
  [BLOCK.SAND, "sand"],
  [BLOCK.GRAVEL, "gravel"],
  [BLOCK.WOOL, "wool"],
  [BLOCK.COAL_ORE, "coal_ore"],
  [BLOCK.IRON_ORE, "iron_ore"],
  [BLOCK.GOLD_ORE, "gold_ore"],
  [BLOCK.DIAMOND_ORE, "diamond_ore"],
  [BLOCK.GLASS, "glass"],
];
const mappedTextureNames = new Set<TextureAtlasName>(["grass_top", "grass_side", "dirt"]);
for (const [block, texture] of uniformMappings) {
  mappedTextureNames.add(texture);
  for (const face of FACES) assert.equal(blockTextureForFace(block, face), texture);
}
for (const face of ["east", "west", "south", "north"] as const) {
  assert.equal(blockTextureForFace(BLOCK.WOOD, face), "oak_log");
  mappedTextureNames.add("oak_log");
}
assert.equal(blockTextureForFace(BLOCK.WOOD, "top"), "oak_log_end");
assert.equal(blockTextureForFace(BLOCK.WOOD, "bottom"), "oak_log_end");
mappedTextureNames.add("oak_log_end");
for (const face of ["east", "west", "south"] as const) {
  assert.equal(blockTextureForFace(BLOCK.CRAFTING_TABLE, face), "crafting_table_side");
}
assert.equal(blockTextureForFace(BLOCK.CRAFTING_TABLE, "top"), "crafting_table_top");
assert.equal(blockTextureForFace(BLOCK.CRAFTING_TABLE, "north"), "crafting_table_front");
assert.equal(blockTextureForFace(BLOCK.CRAFTING_TABLE, "bottom"), "oak_planks");
mappedTextureNames.add("crafting_table_side");
mappedTextureNames.add("crafting_table_top");
mappedTextureNames.add("crafting_table_front");
assert.equal(blockTextureForFace(BLOCK.FURNACE, "north"), "furnace_front");
assert.equal(blockTextureForFace(BLOCK.FURNACE, "top"), "furnace_top");
for (const face of ["east", "west", "south", "bottom"] as const) {
  assert.equal(blockTextureForFace(BLOCK.FURNACE, face), "furnace_side");
}
mappedTextureNames.add("furnace_front");
mappedTextureNames.add("furnace_side");
mappedTextureNames.add("furnace_top");
for (const face of ["east", "west", "south", "north"] as const) {
  assert.equal(blockTextureForFace(BLOCK.TNT, face), "tnt_side");
  assert.equal(textureAtlasUv(blockTextureForFace(BLOCK.TNT, face)!), textureAtlasUv("tnt_side"),
    `TNT ${face} reuses the exact labeled side-face UV tile`);
}
assert.equal(blockTextureForFace(BLOCK.TNT, "top"), "tnt_top");
assert.equal(blockTextureForFace(BLOCK.TNT, "bottom"), "tnt_bottom");
mappedTextureNames.add("tnt_side");
mappedTextureNames.add("tnt_top");
mappedTextureNames.add("tnt_bottom");
mappedTextureNames.add("sapling");
assert.deepEqual(
  [...mappedTextureNames].sort(),
  [...TEXTURE_ATLAS_NAMES].sort(),
  "every generated atlas tile is reachable from at least one block face",
);

for (const specialBlock of [
  BLOCK.AIR,
  BLOCK.TORCH,
  BLOCK.CHEST,
  BLOCK.DOOR_CLOSED,
  BLOCK.DOOR_OPEN,
  BLOCK.BED,
  BLOCK.LADDER,
  BLOCK.SAPLING,
] as const) {
  for (const face of FACES) {
    assert.equal(blockTextureForFace(specialBlock, face), null, `${specialBlock}:${face} uses special geometry`);
  }
}

const expectedCellSpanU = (TEXTURE_TILE_SIZE - 1) / (TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE);
const expectedCellSpanV = (TEXTURE_TILE_SIZE - 1) / (TEXTURE_ATLAS_ROWS * TEXTURE_TILE_SIZE);
for (let index = 0; index < TEXTURE_ATLAS_NAMES.length; index += 1) {
  const name = TEXTURE_ATLAS_NAMES[index];
  const uv = textureAtlasUv(name);
  assert.equal(textureAtlasUv(name), uv, `${name} reuses one allocation-free UV descriptor`);
  assert.equal(Object.isFrozen(uv), true);
  assert.ok(uv.left >= 0 && uv.left < uv.right && uv.right <= 1);
  assert.ok(uv.bottom >= 0 && uv.bottom < uv.top && uv.top <= 1);
  assert.ok(Math.abs((uv.right - uv.left) - expectedCellSpanU) < 1e-12);
  assert.ok(Math.abs((uv.top - uv.bottom) - expectedCellSpanV) < 1e-12);
  const column = index % TEXTURE_ATLAS_COLUMNS;
  const row = Math.floor(index / TEXTURE_ATLAS_COLUMNS);
  assert.equal(Math.floor(((uv.left + uv.right) / 2) * TEXTURE_ATLAS_COLUMNS), column);
  assert.equal(
    Math.floor((1 - (uv.bottom + uv.top) / 2) * TEXTURE_ATLAS_ROWS),
    row,
    `${name} preserves top-to-bottom atlas ordering after UNPACK_FLIP_Y_WEBGL`,
  );
}

const firstRow = textureAtlasUv("grass_top");
assert.ok(firstRow.top > 0.98 && firstRow.bottom > 0.83 && firstRow.bottom < 0.84);
const lastRow = textureAtlasUv("bricks");
assert.ok(lastRow.bottom > 0 && lastRow.bottom < 0.02 && lastRow.top < 0.17);

// The textured mesh deliberately replaces RGB with UV+shade, preserving the
// old six-float stride instead of increasing every streamed chunk allocation.
assert.equal(TEXTURED_WORLD_VERTEX_FLOATS, 6);
const representativeWorldVertices = 170_000;
const representativeWorldBytes = representativeWorldVertices
  * TEXTURED_WORLD_VERTEX_FLOATS
  * Float32Array.BYTES_PER_ELEMENT;
const atlasBytes = TEXTURE_ATLAS_RGBA.byteLength;
assert.equal(atlasBytes, 30 * 16 * 16 * 4, "the append-only RGBA texture stays at 30 KiB");
assert.ok(representativeWorldBytes <= 4_080_000, "170k streamed vertices stay within the 4.08MB world VBO budget");
assert.ok(
  representativeWorldBytes + atlasBytes < 4 * 1024 * 1024,
  "representative world VBO plus atlas stays below 4 MiB",
);

console.log(JSON.stringify({
  benchmark: "textured world vertex memory",
  worldVertices: representativeWorldVertices,
  floatsPerVertex: TEXTURED_WORLD_VERTEX_FLOATS,
  worldBufferBytes: representativeWorldBytes,
  atlasBytes,
  combinedBytes: representativeWorldBytes + atlasBytes,
}));
console.log("lakecraft block texture mapping tests: ok");
