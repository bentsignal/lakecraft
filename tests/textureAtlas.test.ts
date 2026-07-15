import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_ATLAS_ROWS,
  TEXTURE_TILE_SIZE,
} from "../client/game/generated/textureAtlas.ts";

const EXPECTED_NAMES = [
  "grass_top",
  "grass_side",
  "dirt",
  "stone",
  "cobblestone",
  "oak_log",
  "oak_planks",
  "leaves",
  "sand",
  "coal_ore",
  "iron_ore",
  "gold_ore",
  "diamond_ore",
  "glass",
  "crafting_table_side",
  "furnace_side",
  "oak_log_end",
  "crafting_table_top",
  "crafting_table_front",
  "furnace_front",
  "furnace_top",
  "tnt_side",
  "tnt_top",
  "tnt_bottom",
  "gravel",
  "wool",
  "sapling",
  "stone_bricks",
  "clay",
  "bricks",
] as const;

function fnv1a32(bytes: Iterable<number>): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function atlasTile(index: number): Uint8Array {
  const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
  const tileX = index % TEXTURE_ATLAS_COLUMNS;
  const tileY = Math.floor(index / TEXTURE_ATLAS_COLUMNS);
  const tile = new Uint8Array(TEXTURE_TILE_SIZE * TEXTURE_TILE_SIZE * 4);
  let target = 0;
  for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
      const source = (
        (tileY * TEXTURE_TILE_SIZE + y) * atlasWidth
        + tileX * TEXTURE_TILE_SIZE
        + x
      ) * 4;
      tile.set(TEXTURE_ATLAS_RGBA.subarray(source, source + 4), target);
      target += 4;
    }
  }
  return tile;
}

assert.equal(TEXTURE_TILE_SIZE, 16, "world textures stay at Minecraft-scale 16px resolution");
assert.equal(TEXTURE_ATLAS_COLUMNS, 5);
assert.equal(TEXTURE_ATLAS_ROWS, 6);
assert.deepEqual(TEXTURE_ATLAS_NAMES, EXPECTED_NAMES, "tile order is part of the renderer contract");
assert.equal(TEXTURE_ATLAS_NAMES.length, 30);

const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const atlasHeight = TEXTURE_ATLAS_ROWS * TEXTURE_TILE_SIZE;
assert.deepEqual([atlasWidth, atlasHeight], [80, 96]);
assert.equal(TEXTURE_ATLAS_RGBA.length, atlasWidth * atlasHeight * 4);
const tileFingerprints = new Set<string>();
for (let index = 0; index < TEXTURE_ATLAS_NAMES.length; index += 1) {
  const tile = atlasTile(index);
  const colors = new Set<string>();
  for (let offset = 0; offset < tile.length; offset += 4) {
    colors.add(`${tile[offset]},${tile[offset + 1]},${tile[offset + 2]},${tile[offset + 3]}`);
  }
  assert.ok(colors.size >= 3, `${TEXTURE_ATLAS_NAMES[index]} must retain readable pixel variation`);
  if (TEXTURE_ATLAS_NAMES[index] !== "glass" && TEXTURE_ATLAS_NAMES[index] !== "sapling") {
    for (let offset = 3; offset < tile.length; offset += 4) {
      assert.equal(tile[offset], 255, `${TEXTURE_ATLAS_NAMES[index]} remains an opaque terrain material`);
    }
  }
  tileFingerprints.add(fnv1a32(tile));
}
assert.equal(tileFingerprints.size, 30, "every named atlas tile must be visually distinct");

for (let index = TEXTURE_ATLAS_NAMES.length; index < TEXTURE_ATLAS_COLUMNS * TEXTURE_ATLAS_ROWS; index += 1) {
  assert.equal(atlasTile(index).every((channel) => channel === 0), true, "unused atlas capacity stays transparent and inert");
}

const glassTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("glass"));
const glassAlphaCounts = new Map<number, number>();
for (let offset = 3; offset < glassTile.length; offset += 4) {
  glassAlphaCounts.set(glassTile[offset], (glassAlphaCounts.get(glassTile[offset]) ?? 0) + 1);
}
assert.deepEqual([...glassAlphaCounts.keys()].sort((a, b) => a - b), [24, 102, 187]);
assert.equal(glassAlphaCounts.get(187), 60, "glass keeps a readable one-pixel outer frame");
assert.ok((glassAlphaCounts.get(24) ?? 0) >= 180, "the low-alpha center keeps the world visible");

const saplingTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("sapling"));
const saplingAlphaCounts = new Map<number, number>();
for (let offset = 3; offset < saplingTile.length; offset += 4) {
  saplingAlphaCounts.set(saplingTile[offset], (saplingAlphaCounts.get(saplingTile[offset]) ?? 0) + 1);
}
assert.deepEqual([...saplingAlphaCounts.keys()].sort((a, b) => a - b), [0, 255]);
assert.ok((saplingAlphaCounts.get(0) ?? 0) >= 150, "sapling negative space stays transparent for crossed quads");
assert.ok((saplingAlphaCounts.get(255) ?? 0) >= 45, "sapling foliage remains readable at Minecraft-scale 16px");

// Intentional atlas regeneration should update this fingerprint in the same change.
assert.equal(fnv1a32(TEXTURE_ATLAS_RGBA), "7fd3debd", "generated RGBA atlas changed unexpectedly");

const png = readFileSync(new URL("../client/game/generated/texture-atlas-v1.png", import.meta.url));
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(png.toString("ascii", 12, 16), "IHDR");
assert.equal(png.readUInt32BE(16), atlasWidth, "PNG width matches generated TypeScript");
assert.equal(png.readUInt32BE(20), atlasHeight, "PNG height matches generated TypeScript");

const regenerationDirectory = mkdtempSync(join(tmpdir(), "lakecraft-atlas-regression-"));
try {
  const regeneratedPngPath = join(regenerationDirectory, "texture-atlas-v1.png");
  const regeneratedTsPath = join(regenerationDirectory, "textureAtlas.ts");
  const regeneration = spawnSync(process.execPath, [
    new URL("../scripts/pixelate-texture-sheet.mjs", import.meta.url).pathname,
    new URL("../design/texture-concepts/lakecraft-materials-v1.png", import.meta.url).pathname,
    regeneratedPngPath,
    "--columns",
    "5",
    "--rows",
    "6",
    "--source-columns",
    "4",
    "--source-rows",
    "4",
    "--inset",
    "0",
    "--names",
    EXPECTED_NAMES.join(","),
    "--ts",
    regeneratedTsPath,
  ], { encoding: "utf8" });
  assert.equal(regeneration.status, 0, regeneration.stderr || regeneration.stdout);
  assert.deepEqual(readFileSync(regeneratedPngPath), png, "the concept sheet deterministically regenerates the PNG atlas");
  assert.deepEqual(
    readFileSync(regeneratedTsPath),
    readFileSync(new URL("../client/game/generated/textureAtlas.ts", import.meta.url)),
    "the concept sheet deterministically regenerates the embedded RGBA source",
  );
} finally {
  rmSync(regenerationDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  benchmark: "generated texture atlas integrity",
  atlas: `${atlasWidth}x${atlasHeight}`,
  tiles: TEXTURE_ATLAS_NAMES.length,
  tileSize: TEXTURE_TILE_SIZE,
  rgbaBytes: TEXTURE_ATLAS_RGBA.byteLength,
  rgbaFingerprint: fnv1a32(TEXTURE_ATLAS_RGBA),
  glassAlphaCounts: Object.fromEntries(glassAlphaCounts),
}));
console.log("lakecraft texture atlas tests: ok");
