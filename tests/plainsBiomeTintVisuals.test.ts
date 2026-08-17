import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import {
  BLOCK_ITEM_CUBE_VERTEX_FLOATS,
  appendBlockItemCubeGeometry,
} from "../client/game/blockItemCubeGeometry.ts";
import {
  droppedBlockCubeVertexCount,
  writeDroppedItemGeometry,
} from "../client/game/droppedItemRenderer.ts";
import {
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
} from "../client/game/generated/textureAtlas.ts";

const tilePixels = (name: typeof TEXTURE_ATLAS_NAMES[number]): Uint8Array => {
  const index = TEXTURE_ATLAS_NAMES.indexOf(name);
  const cell = TEXTURE_ATLAS_CELLS[index];
  const tileX = cell % TEXTURE_ATLAS_COLUMNS;
  const tileY = Math.floor(cell / TEXTURE_ATLAS_COLUMNS);
  const output = new Uint8Array(TEXTURE_TILE_SIZE * TEXTURE_TILE_SIZE * 4);
  for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const source = ((tileY * TEXTURE_TILE_SIZE + y) * TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE
      + tileX * TEXTURE_TILE_SIZE + x) * 4;
    output.set(TEXTURE_ATLAS_RGBA.subarray(source, source + 4), (y * TEXTURE_TILE_SIZE + x) * 4);
  }
  return output;
};

const greenPixels = (rgba: Uint8Array): number => {
  let count = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] > 0 && rgba[offset + 1] > rgba[offset] && rgba[offset + 1] > rgba[offset + 2]) count += 1;
  }
  return count;
};

assert.ok(greenPixels(tilePixels("grass_top")) > 200, "fixed plains grass top cannot regress to its grayscale source mask");
assert.ok(greenPixels(tilePixels("grass_side")) > 40, "fixed plains grass sides retain their installed tinted overlay");
assert.ok(greenPixels(tilePixels("leaves")) > 100, "fixed plains oak leaves cannot regress to their grayscale source mask");
assert.ok(greenPixels(tilePixels("short_grass")) > 30,
  "short grass applies the same fixed plains tint instead of rendering its grayscale source mask");

for (const itemId of ["grass", "leaves"] as const) {
  const iconColors = getItemIconArt(itemId).runs.map(({ color }) => [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ]);
  assert.ok(iconColors.some(([red, green, blue]) => green > red && green > blue),
    `${itemId} inventory cube inherits the plains-tinted atlas`);

  const cube: number[] = [];
  const vertices = appendBlockItemCubeGeometry(cube, itemId);
  assert.ok(vertices > 0);
  assert.ok(Array.from({ length: vertices }, (_, vertex) => vertex * BLOCK_ITEM_CUBE_VERTEX_FLOATS)
    .some((offset) => cube[offset + 4] > cube[offset + 3] && cube[offset + 4] > cube[offset + 5]),
  `${itemId} held/third-person cube inherits the plains-tinted atlas`);

  const droppedVertices = droppedBlockCubeVertexCount(itemId);
  const dropped = new Float32Array(droppedVertices * 6);
  const stats = { totalItemCount: 0, visibleItemCount: 0, vertexCount: 0 };
  writeDroppedItemGeometry(new Float32Array([0, 0, 0]), new Float32Array(1), [itemId], 1, [0, 0, 0], 0, dropped, stats);
  assert.equal(stats.vertexCount, droppedVertices);
  assert.ok(Array.from({ length: droppedVertices }, (_, vertex) => vertex * 6)
    .some((offset) => dropped[offset + 4] > dropped[offset + 3] && dropped[offset + 4] > dropped[offset + 5]),
  `${itemId} dropped cube inherits the plains-tinted atlas`);
}

assert.ok(getItemIconArt("short_grass").runs.some(({ color }) => {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return green > red && green > blue;
}), "Creative short-grass art applies the fixed plains tint too");

const terrain = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const firstPerson = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
for (const [source, label] of [[terrain, "world"], [firstPerson, "first-person"]] as const) {
  assert.ok(source.includes("blockTextureForFace"), `${label} geometry resolves the shared tinted material tile`);
  assert.ok(source.includes("textureAtlasUv"), `${label} geometry samples the shared tinted atlas`);
}

console.log("fixed plains-biome grass/leaf tint propagation tests passed");
