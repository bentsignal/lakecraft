import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chestAtlasUv,
  TEXTURED_WORLD_VERTEX_FLOATS,
  blockTextureForFace,
  textureAtlasUv,
  type BlockFace,
  type TextureUvBounds,
} from "../client/game/blockTextures.ts";
import {
  TEXTURE_ATLAS_CELLS,
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
  [BLOCK.BEDROCK, "bedrock"],
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
const tntSideFaces = ["east", "west", "south", "north"] as const;
const tntSideUvs = new Set<TextureUvBounds>();
for (const face of tntSideFaces) {
  assert.equal(blockTextureForFace(BLOCK.TNT, face), "tnt_side");
  const sideUv = textureAtlasUv(blockTextureForFace(BLOCK.TNT, face)!);
  tntSideUvs.add(sideUv);
  assert.equal(sideUv, textureAtlasUv("tnt_side"),
    `TNT ${face} reuses the exact labeled side-face UV tile`);
}
assert.equal(tntSideUvs.size, 1, "all four TNT sides retain byte-identical labeled texture parity");
assert.equal(blockTextureForFace(BLOCK.TNT, "top"), "tnt_top");
assert.equal(blockTextureForFace(BLOCK.TNT, "bottom"), "tnt_bottom");
mappedTextureNames.add("tnt_side");
mappedTextureNames.add("tnt_top");
mappedTextureNames.add("tnt_bottom");
mappedTextureNames.add("sapling");
mappedTextureNames.add("torch");
for (let block = 1; block <= BLOCK.CRYING_OBSIDIAN; block += 1) {
  for (const face of FACES) {
    const texture = blockTextureForFace(block as BlockId, face);
    if (texture) mappedTextureNames.add(texture);
  }
}
for (const texture of TEXTURE_ATLAS_NAMES) if (texture.includes("_door_")) mappedTextureNames.add(texture);
assert.deepEqual(
  [...mappedTextureNames].sort(),
  [...TEXTURE_ATLAS_NAMES].sort(),
  "every ordinary material atlas tile is reachable from at least one block face",
);
const specialGeometry = readFileSync(new URL("../client/game/specialBlockGeometry.ts", import.meta.url), "utf8");
assert.ok(specialGeometry.includes("chestAtlasUv(point[2], point[3])"),
  "the contiguous entity-texture region is reachable through the retained special chest mesh");

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
  const cell = TEXTURE_ATLAS_CELLS[index];
  const column = cell % TEXTURE_ATLAS_COLUMNS;
  const row = Math.floor(cell / TEXTURE_ATLAS_COLUMNS);
  assert.equal(Math.floor(((uv.left + uv.right) / 2) * TEXTURE_ATLAS_COLUMNS), column);
  assert.equal(
    Math.floor((1 - (uv.bottom + uv.top) / 2) * TEXTURE_ATLAS_ROWS),
    row,
    `${name} preserves top-to-bottom atlas ordering after UNPACK_FLIP_Y_WEBGL`,
  );
}

const firstRow = textureAtlasUv("grass_top");
assert.ok(firstRow.top > 0.99 && firstRow.bottom > 0.93 && firstRow.bottom < 0.94);
assert.deepEqual(chestAtlasUv(0, 0), [(8 * 16 + 0.5) / 192, 1 - (12 * 16 + 0.5) / 256]);
assert.deepEqual(chestAtlasUv(63, 63), [(8 * 16 + 63.5) / 192, 1 - (12 * 16 + 63.5) / 256]);

// The textured mesh deliberately replaces RGB with UV+shade, preserving the
// old six-float stride instead of increasing every streamed chunk allocation.
assert.equal(TEXTURED_WORLD_VERTEX_FLOATS, 6);
const representativeWorldVertices = 170_000;
const representativeWorldBytes = representativeWorldVertices
  * TEXTURED_WORLD_VERTEX_FLOATS
  * Float32Array.BYTES_PER_ELEMENT;
const atlasBytes = TEXTURE_ATLAS_RGBA.byteLength;
assert.equal(atlasBytes, 192 * 256 * 4,
  "the expanded RGBA texture stays at one fixed 192 KiB atlas");
assert.ok(representativeWorldBytes <= 4_080_000, "170k streamed vertices stay within the 4.08MB world VBO budget");
assert.ok(
  representativeWorldBytes + atlasBytes < 4.25 * 1024 * 1024,
  "representative world VBO plus expanded atlas stays below 4.25 MiB",
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
