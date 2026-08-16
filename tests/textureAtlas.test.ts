import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  CHEST_ATLAS_COLUMN,
  CHEST_ATLAS_ROW,
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_ATLAS_ROWS,
  TEXTURE_TILE_SIZE,
} from "../client/game/generated/textureAtlas.ts";
import { decodeStaticBytes } from "../client/staticData.ts";
import { VISUAL_ASSET_MANIFEST } from "../shared/visualAssetManifest.ts";
import { decodeStaticEncoding, encodeStaticBytes } from "../scripts/static-byte-encoding.mjs";

const BASE_NAMES = [
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
  "bedrock",
  "torch",
] as const;

function fnv1a32(bytes: Iterable<number>): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function atlasCell(cell: number): Uint8Array {
  const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
  const tileX = cell % TEXTURE_ATLAS_COLUMNS;
  const tileY = Math.floor(cell / TEXTURE_ATLAS_COLUMNS);
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

function atlasTile(index: number): Uint8Array {
  return atlasCell(TEXTURE_ATLAS_CELLS[index]);
}

function tilePixel(tile: Uint8Array, x: number, y: number): readonly [number, number, number, number] {
  const offset = (y * TEXTURE_TILE_SIZE + x) * 4;
  return [tile[offset], tile[offset + 1], tile[offset + 2], tile[offset + 3]];
}

function changedPixelKeys(tile: Uint8Array, base: Uint8Array): Set<string> {
  const changed = new Set<string>();
  for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const offset = (y * TEXTURE_TILE_SIZE + x) * 4;
    if (tile.subarray(offset, offset + 4).some((channel, index) => channel !== base[offset + index])) {
      changed.add(`${x},${y}`);
    }
  }
  return changed;
}

function connectedComponentSizes(points: ReadonlySet<string>): number[] {
  const remaining = new Set(points);
  const sizes: number[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    assert.ok(first);
    const pending = [first];
    remaining.delete(first);
    let size = 0;
    while (pending.length) {
      const point = pending.pop()!;
      const [x, y] = point.split(",").map(Number);
      size += 1;
      for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
        if (remaining.delete(neighbor)) pending.push(neighbor);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((left, right) => left - right);
}

assert.equal(TEXTURE_TILE_SIZE, 16, "world textures stay at Minecraft-scale 16px resolution");
assert.equal(TEXTURE_ATLAS_COLUMNS, 16);
assert.equal(TEXTURE_ATLAS_ROWS, 16);
assert.deepEqual(TEXTURE_ATLAS_NAMES.slice(0, BASE_NAMES.length), BASE_NAMES,
  "the deployed tile prefix stays append-only while the creative catalog expands");
assert.equal(TEXTURE_ATLAS_NAMES.length, 229);
assert.equal(new Set(TEXTURE_ATLAS_CELLS).size, 229, "every ordinary material owns one cell");
assert.deepEqual([CHEST_ATLAS_COLUMN, CHEST_ATLAS_ROW], [12, 12]);

const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const atlasHeight = TEXTURE_ATLAS_ROWS * TEXTURE_TILE_SIZE;
assert.deepEqual([atlasWidth, atlasHeight], [256, 256]);
assert.equal(TEXTURE_ATLAS_RGBA.length, atlasWidth * atlasHeight * 4);
const tileFingerprints = new Set<string>();
for (let index = 0; index < TEXTURE_ATLAS_NAMES.length; index += 1) {
  const tile = atlasTile(index);
  const colors = new Set<string>();
  for (let offset = 0; offset < tile.length; offset += 4) {
    colors.add(`${tile[offset]},${tile[offset + 1]},${tile[offset + 2]},${tile[offset + 3]}`);
  }
  assert.ok(colors.size >= 3, `${TEXTURE_ATLAS_NAMES[index]} must retain readable pixel variation`);
  if (!new Set(["glass", "sapling", "torch"]).has(TEXTURE_ATLAS_NAMES[index])
    && !TEXTURE_ATLAS_NAMES[index].endsWith("_stained_glass")
    && !TEXTURE_ATLAS_NAMES[index].includes("_door_")
    && !TEXTURE_ATLAS_NAMES[index].endsWith("_leaves")
  ) {
    for (let offset = 3; offset < tile.length; offset += 4) {
      assert.equal(tile[offset], 255, `${TEXTURE_ATLAS_NAMES[index]} remains an opaque terrain material`);
    }
  }
  tileFingerprints.add(fnv1a32(tile));
}
assert.equal(tileFingerprints.size, 228,
  "the exact installed atlas is distinct except for Minecraft's identical quartz side/top pixels");

assert.equal(new Set(["coal_ore", "iron_ore", "gold_ore", "diamond_ore"]
  .map((name) => fnv1a32(atlasTile(TEXTURE_ATLAS_NAMES.indexOf(name as typeof TEXTURE_ATLAS_NAMES[number]))))).size, 4,
"each exact installed ore remains independently recognizable");

const occupiedCells = new Set<number>(TEXTURE_ATLAS_CELLS);
for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
  occupiedCells.add((CHEST_ATLAS_ROW + y) * TEXTURE_ATLAS_COLUMNS + CHEST_ATLAS_COLUMN + x);
}
for (let cell = 0; cell < TEXTURE_ATLAS_COLUMNS * TEXTURE_ATLAS_ROWS; cell += 1) {
  if (!occupiedCells.has(cell)) assert.equal(atlasCell(cell).every((channel) => channel === 0), true,
    "unused atlas capacity stays transparent and inert");
}

const glassTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("glass"));
const glassAlphaCounts = new Map<number, number>();
for (let offset = 3; offset < glassTile.length; offset += 4) {
  glassAlphaCounts.set(glassTile[offset], (glassAlphaCounts.get(glassTile[offset]) ?? 0) + 1);
}
assert.deepEqual([...glassAlphaCounts.keys()].sort((a, b) => a - b), [0, 255]);
assert.equal(glassAlphaCounts.get(255), 65, "installed glass keeps its exact bright frame and glints");
assert.equal(glassAlphaCounts.get(0), 191, "installed glass keeps its exact transparent center");

const saplingTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("sapling"));
const saplingAlphaCounts = new Map<number, number>();
for (let offset = 3; offset < saplingTile.length; offset += 4) {
  saplingAlphaCounts.set(saplingTile[offset], (saplingAlphaCounts.get(saplingTile[offset]) ?? 0) + 1);
}
assert.deepEqual([...saplingAlphaCounts.keys()].sort((a, b) => a - b), [0, 255]);
assert.equal(saplingAlphaCounts.get(0), 145, "installed sapling negative space stays transparent for crossed quads");
assert.equal(saplingAlphaCounts.get(255), 111, "installed sapling foliage remains readable at Minecraft-scale 16px");

const furnaceSideTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("furnace_side"));
const furnaceFrontTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("furnace_front"));
const darkOpeningPixels = (tile: Uint8Array): number => {
  let count = 0;
  for (let y = 8; y < 14; y += 1) for (let x = 3; x < 13; x += 1) {
    const offset = (y * TEXTURE_TILE_SIZE + x) * 4;
    if ((tile[offset] + tile[offset + 1] + tile[offset + 2]) / 3 < 70) count += 1;
  }
  return count;
};
assert.ok(darkOpeningPixels(furnaceFrontTile) >= 24, "the installed furnace front keeps one unmistakable dark opening");
assert.ok(darkOpeningPixels(furnaceSideTile) <= 4, "the installed furnace side never repeats the front opening");

const tntSideTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("tnt_side"));
const tntTopTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("tnt_top"));
const tntBottomTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("tnt_bottom"));
assert.equal(new Set([tntSideTile, tntTopTile, tntBottomTile].map(fnv1a32)).size, 3,
  "exact installed TNT side, top, and bottom remain face-distinct");

// Intentional atlas regeneration should update this fingerprint in the same change.
assert.equal(fnv1a32(TEXTURE_ATLAS_RGBA), VISUAL_ASSET_MANIFEST.blockAtlas.fingerprint,
  "generated RGBA atlas changed unexpectedly");
const generatedSource = readFileSync(new URL("../client/game/generated/textureAtlas.ts", import.meta.url), "utf8");
const decoderCalls = [...generatedSource.matchAll(/decodeStaticBytes\("([^"]+)", (\d+), (\d+)(, true)?\)/g)];
assert.equal(decoderCalls.length, 4, "ordinary tiles and contiguous chest each retain one palette and index stream");
const [paletteCall, indexCall, chestPaletteCall, chestIndexCall] = decoderCalls;
const packedPalette = paletteCall[1];
const packedIndexes = indexCall[1];
const paletteBytes = Number(paletteCall[2]);
const palettePackedBytes = Number(paletteCall[3]);
const indexBytes = Number(indexCall[2]);
const indexPackedBytes = Number(indexCall[3]);
assert.equal(paletteBytes % 4, 0, "global atlas palette stays RGBA aligned");
assert.equal(packedPalette.length, Math.ceil(palettePackedBytes / 4) * 5,
  "atlas palette retains canonical Base85 length");
assert.equal(packedIndexes.length, Math.ceil(indexPackedBytes / 4) * 5,
  "atlas indexes retain canonical Base85 length");
assert.equal(Number(chestPaletteCall[2]), 61 * 4, "the exact chest keeps its bounded 61-color RGBA palette");
assert.equal(Number(chestIndexCall[2]), 3_072, "the exact 64x64 chest uses one six-bit index stream");
const compactIndexes = decodeStaticBytes(packedIndexes, indexBytes, indexPackedBytes, true);
const generatedPath = new URL("../client/game/generated/textureAtlas.ts", import.meta.url);
const atlasFixtureDirectory = mkdtempSync(join(tmpdir(), "lakecraft-invalid-atlas-"));
let invalidAtlasFixture = 0;
const rejectInvalidAtlasData = async (bytes: Uint8Array, label: string): Promise<void> => {
  const fixturePath = join(atlasFixtureDirectory, `textureAtlas-${invalidAtlasFixture++}.ts`);
  const fixtureSource = generatedSource
    .replace('"../../staticData.ts"', JSON.stringify(new URL("../../staticData.ts", generatedPath).href))
    .replace(indexCall[0], `Uint8Array.from(${JSON.stringify([...bytes])})`);
  writeFileSync(fixturePath, fixtureSource);
  await assert.rejects(import(pathToFileURL(fixturePath).href), /^Error: Invalid texture atlas data\.$/, label);
};
const rejectInvalidAtlasPayload = async (payload: string, label: string): Promise<void> => {
  const fixturePath = join(atlasFixtureDirectory, `textureAtlas-${invalidAtlasFixture++}.ts`);
  const fixtureSource = generatedSource
    .replace('"../../staticData.ts"', JSON.stringify(new URL("../../staticData.ts", generatedPath).href))
    .replace(packedIndexes, payload);
  writeFileSync(fixturePath, fixtureSource);
  await assert.rejects(import(pathToFileURL(fixturePath).href), /^Error: Invalid static data\.$/, label);
};
try {
  const emptyPalette = compactIndexes.slice();
  emptyPalette[0] = 0;
  await rejectInvalidAtlasData(emptyPalette, "a tile with no local colors fails closed");
  const invalidGlobalColor = compactIndexes.slice();
  invalidGlobalColor[TEXTURE_ATLAS_NAMES.length] = 255;
  invalidGlobalColor[TEXTURE_ATLAS_NAMES.length + 1] = 255;
  await rejectInvalidAtlasData(invalidGlobalColor, "an out-of-range global palette index fails closed");
  await rejectInvalidAtlasData(compactIndexes.subarray(0, compactIndexes.length - 1),
    "a truncated tile index payload fails closed");
  const trailingAtlasByte = new Uint8Array(compactIndexes.length + 1);
  trailingAtlasByte.set(compactIndexes);
  await rejectInvalidAtlasData(trailingAtlasByte, "trailing tile index bytes fail closed");
  const noncanonicalAtlasPayload = decodeStaticEncoding(packedIndexes);
  if (noncanonicalAtlasPayload.length > indexPackedBytes) {
    assert.equal(noncanonicalAtlasPayload[indexPackedBytes], 0, "reviewed atlas stream has canonical zero Base85 padding");
    noncanonicalAtlasPayload[indexPackedBytes] = 1;
    await rejectInvalidAtlasPayload(encodeStaticBytes(noncanonicalAtlasPayload),
      "the real atlas module rejects nonzero encoded padding");
  }
} finally {
  rmSync(atlasFixtureDirectory, { recursive: true, force: true });
}
const tileColorCounts = compactIndexes.subarray(0, TEXTURE_ATLAS_NAMES.length);
const localPaletteColors = tileColorCounts.reduce((sum, count) => sum + count, 0);
assert.ok(localPaletteColors > 3_300 && localPaletteColors < 3_400,
  "the expanded ordinary local palettes remain bounded after exact material import");
assert.ok(Math.max(...tileColorCounts) <= 255,
  "local palette color counts stay inside the one-byte format");
assert.ok(compactIndexes.length - tileColorCounts.length - localPaletteColors * 2 >= 9_000,
  "the atlas retains one bounded bitstream for every ordinary 16x16 tile");
let localPaletteCursor = tileColorCounts.length;
for (const colorCount of tileColorCounts) {
  const localPalette = Array.from({ length: colorCount }, (_, index) => (
    compactIndexes[localPaletteCursor + index * 2] * 256
    + compactIndexes[localPaletteCursor + index * 2 + 1]
  ));
  assert.equal(new Set(localPalette).size, colorCount, "tile-local palettes contain no duplicate global indexes");
  assert.ok(localPalette.every((index) => index < paletteBytes / 4), "tile-local palettes reference the global palette");
  localPaletteCursor += colorCount * 2;
}
assert.equal(localPaletteCursor, tileColorCounts.length + localPaletteColors * 2,
  "all local palettes end at the reviewed bitstream boundary");
assert.ok(generatedSource.includes('import { decodeStaticBytes } from "../../staticData.ts";')
    && generatedSource.includes("export const TEXTURE_ATLAS_RGBA = new Uint8Array(262144)")
    && !generatedSource.includes("TEXTURE_ATLAS_INDEXES")
    && !generatedSource.includes("new Uint8Array(7680)"),
  "one-time decoders expand ordinary tiles and the chest directly into the fixed RGBA buffer");

const png = readFileSync(new URL("../client/game/generated/texture-atlas-v1.png", import.meta.url));
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(png.toString("ascii", 12, 16), "IHDR");
assert.equal(png.readUInt32BE(16), atlasWidth, "PNG width matches generated TypeScript");
assert.equal(png.readUInt32BE(20), atlasHeight, "PNG height matches generated TypeScript");

const regenerationDirectory = mkdtempSync(join(tmpdir(), "lakecraft-atlas-regression-"));
try {
  const regeneratedPngPath = join(regenerationDirectory, "texture-atlas-v1.png");
  const regeneratedTsPath = join(regenerationDirectory, "textureAtlas.ts");
  // The checked-in PNG is generated with Node's deterministic zlib output;
  // Bun exposes itself as process.execPath when this suite runs under `bun test`.
  const regeneration = spawnSync("node", [
    new URL("../scripts/pixelate-texture-sheet.mjs", import.meta.url).pathname,
    new URL("../design/texture-concepts/lakecraft-materials-v1.png", import.meta.url).pathname,
    regeneratedPngPath,
    "--columns",
    "16",
    "--rows",
    "16",
    "--source-columns",
    "4",
    "--source-rows",
    "4",
    "--inset",
    "0",
    "--names",
    TEXTURE_ATLAS_NAMES.join(","),
    "--ts",
    regeneratedTsPath,
  ], { encoding: "utf8" });
  assert.equal(regeneration.status, 0, regeneration.stderr || regeneration.stdout);
  assert.deepEqual(readFileSync(regeneratedPngPath), png, "the concept sheet deterministically regenerates the PNG atlas");
  assert.deepEqual(
    readFileSync(regeneratedTsPath, "utf8"),
    generatedSource,
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
