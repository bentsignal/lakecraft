import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_ATLAS_ROWS,
  TEXTURE_TILE_SIZE,
} from "../client/game/generated/textureAtlas.ts";
import { decodeStaticBytes } from "../client/staticData.ts";
import { VISUAL_ASSET_MANIFEST } from "../shared/visualAssetManifest.ts";
import { decodeStaticEncoding, encodeStaticBytes } from "../scripts/static-byte-encoding.mjs";

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

const stoneTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("stone"));
const oreExpectations = Object.freeze({
  coal_ore: { changed: 31, components: [5, 6, 6, 7, 7], hue: (r: number, g: number, b: number) => r === g && g === b && r <= 85 },
  iron_ore: { changed: 25, components: [5, 6, 7, 7], hue: (r: number, g: number, b: number) => r > g && g > b },
  gold_ore: { changed: 23, components: [5, 5, 6, 7], hue: (r: number, g: number, b: number) => r > g && g > b },
  diamond_ore: { changed: 22, components: [5, 5, 6, 6], hue: (r: number, g: number, b: number) => b >= g && g > r },
});
const oreDistributionFingerprints = new Set<string>();
for (const [name, expectation] of Object.entries(oreExpectations)) {
  const ore = atlasTile(TEXTURE_ATLAS_NAMES.indexOf(name as typeof TEXTURE_ATLAS_NAMES[number]));
  const changed = changedPixelKeys(ore, stoneTile);
  assert.equal(changed.size, expectation.changed, `${name} keeps a sparse reviewed mineral coverage`);
  assert.deepEqual(connectedComponentSizes(changed), expectation.components,
    `${name} uses connected irregular mineral clusters instead of singleton dots`);
  const distribution = new Uint8Array(TEXTURE_TILE_SIZE * TEXTURE_TILE_SIZE);
  for (const key of changed) {
    const [x, y] = key.split(",").map(Number);
    distribution[y * TEXTURE_TILE_SIZE + x] = 1;
    const [r, g, b, alpha] = tilePixel(ore, x, y);
    assert.equal(alpha, 255);
    assert.ok(expectation.hue(r, g, b), `${name} mineral pixel ${key} stays in its identifying palette`);
  }
  oreDistributionFingerprints.add(fnv1a32(distribution));
  for (let edge = 0; edge < TEXTURE_TILE_SIZE; edge += 1) {
    assert.deepEqual(tilePixel(ore, edge, 0), tilePixel(stoneTile, edge, 0), `${name} top edge inherits stone`);
    assert.deepEqual(tilePixel(ore, edge, 15), tilePixel(stoneTile, edge, 15), `${name} bottom edge inherits stone`);
    assert.deepEqual(tilePixel(ore, 0, edge), tilePixel(stoneTile, 0, edge), `${name} left edge inherits stone`);
    assert.deepEqual(tilePixel(ore, 15, edge), tilePixel(stoneTile, 15, edge), `${name} right edge inherits stone`);
  }
}
assert.equal(oreDistributionFingerprints.size, 4, "each ore has an independently recognizable cluster distribution");

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
assert.ok(darkOpeningPixels(furnaceFrontTile) >= 50, "the furnace front keeps one unmistakable dark opening");
assert.ok(darkOpeningPixels(furnaceSideTile) <= 30, "neutral furnace masonry never repeats the front opening");

const tntSideTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("tnt_side"));
const tntTopTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("tnt_top"));
const tntBottomTile = atlasTile(TEXTURE_ATLAS_NAMES.indexOf("tnt_bottom"));
assert.equal(new Set([tntSideTile, tntTopTile, tntBottomTile].map(fnv1a32)).size, 3,
  "TNT side, fuse top, and strapped bottom remain face-distinct");
for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) {
  assert.deepEqual(tilePixel(tntSideTile, 0, y), tilePixel(tntSideTile, 15, y),
    "TNT side label tile has matching dark vertical bundle edges");
}
const expectedTntInk = new Set([
  "1,6","2,6","3,6","2,7","2,8","2,9",
  "6,6","9,6","6,7","7,7","9,7","6,8","8,8","9,8","6,9","9,9",
  "12,6","13,6","14,6","13,7","13,8","13,9",
]);
const actualTntInk = new Set<string>();
for (let y = 6; y <= 9; y += 1) for (let x = 1; x < 15; x += 1) {
  const pixel = tilePixel(tntSideTile, x, y);
  assert.ok(pixel.join(",") === "34,34,34,255" || pixel.join(",") === "238,221,187,255",
    "the TNT wordmark sits only on a clean high-contrast paper band");
  if (pixel.join(",") === "34,34,34,255") actualTntInk.add(`${x},${y}`);
}
assert.deepEqual(actualTntInk, expectedTntInk, "the side tile retains the reviewed open T-N-T pixel lettering");
assert.equal([...tntTopTile].filter((_, offset) => offset % 4 === 0
  && tntTopTile[offset] === 255 && tntTopTile[offset + 1] === 170 && tntTopTile[offset + 2] === 34).length, 1,
"the top face keeps one unmistakable fuse ember");
let bottomFasteners = 0;
for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
  if (tilePixel(tntBottomTile, x, y).join(",") === "170,136,85,255") bottomFasteners += 1;
}
assert.equal(bottomFasteners, 4, "the TNT bottom keeps four visible packing fasteners and no fuse");

// Intentional atlas regeneration should update this fingerprint in the same change.
assert.equal(fnv1a32(TEXTURE_ATLAS_RGBA), VISUAL_ASSET_MANIFEST.blockAtlas.fingerprint,
  "generated RGBA atlas changed unexpectedly");
const generatedSource = readFileSync(new URL("../client/game/generated/textureAtlas.ts", import.meta.url), "utf8");
const packedPalette = generatedSource.match(/decodeStaticBytes\("([^"]+)", 632, 547\)/)?.[1];
const packedIndexes = generatedSource.match(/decodeStaticBytes\("([^"]+)", 3683, 3130, true\)/)?.[1];
assert.ok(packedPalette);
assert.ok(packedIndexes);
assert.equal(packedPalette.length, 685,
  "atlas palette retains the reviewed deterministic LZSS fixture");
assert.equal(packedIndexes.length, 3_915,
  "atlas indexes retain the reviewed local-palette bitpack fixture");
const compactIndexes = decodeStaticBytes(packedIndexes, 3_683, 3_130, true);
const generatedPath = new URL("../client/game/generated/textureAtlas.ts", import.meta.url);
const atlasFixtureDirectory = mkdtempSync(join(tmpdir(), "lakecraft-invalid-atlas-"));
let invalidAtlasFixture = 0;
const rejectInvalidAtlasData = async (bytes: Uint8Array, label: string): Promise<void> => {
  const fixturePath = join(atlasFixtureDirectory, `textureAtlas-${invalidAtlasFixture++}.ts`);
  const fixtureSource = generatedSource
    .replace('"../../staticData.ts"', JSON.stringify(new URL("../../staticData.ts", generatedPath).href))
    .replace(/decodeStaticBytes\("[^"]+", 3683, 3130, true\)/, `Uint8Array.from(${JSON.stringify([...bytes])})`);
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
  invalidGlobalColor[30] = 255;
  await rejectInvalidAtlasData(invalidGlobalColor, "an out-of-range global palette index fails closed");
  await rejectInvalidAtlasData(compactIndexes.subarray(0, compactIndexes.length - 1),
    "a truncated tile index payload fails closed");
  const trailingAtlasByte = new Uint8Array(compactIndexes.length + 1);
  trailingAtlasByte.set(compactIndexes);
  await rejectInvalidAtlasData(trailingAtlasByte, "trailing tile index bytes fail closed");
  const noncanonicalAtlasPayload = decodeStaticEncoding(packedIndexes);
  assert.equal(noncanonicalAtlasPayload[3_130], 0, "reviewed atlas stream has canonical zero Base85 padding");
  noncanonicalAtlasPayload[3_130] = 1;
  await rejectInvalidAtlasPayload(encodeStaticBytes(noncanonicalAtlasPayload),
    "the real atlas module rejects nonzero encoded padding");
} finally {
  rmSync(atlasFixtureDirectory, { recursive: true, force: true });
}
const tileColorCounts = compactIndexes.subarray(0, 30);
assert.deepEqual([...tileColorCounts], [
  8, 30, 19, 10, 21, 15, 17, 19, 11, 12, 13, 12, 13, 3, 45,
  4, 4, 4, 5, 5, 3, 8, 8, 5, 5, 5, 7, 5, 4, 5,
], "each tile retains its reviewed local palette cardinality");
assert.equal(tileColorCounts.reduce((sum, count) => sum + count, 0), 325,
  "the 30 bounded local palettes retain their reviewed total size");
assert.ok(Math.max(...tileColorCounts) <= 45,
  "local palettes stay inside the one-byte format and six-bit startup decoder budget");
assert.equal(compactIndexes.length - 30 - 325, 3_328,
  "the atlas retains one bounded bitstream for exactly 30 16x16 tiles");
let localPaletteCursor = 30;
for (const colorCount of tileColorCounts) {
  const localPalette = compactIndexes.subarray(localPaletteCursor, localPaletteCursor + colorCount);
  assert.equal(new Set(localPalette).size, colorCount, "tile-local palettes contain no duplicate global indexes");
  assert.ok(localPalette.every((index) => index < 158), "tile-local palettes reference the reviewed global palette");
  localPaletteCursor += colorCount;
}
assert.equal(localPaletteCursor, 355, "all local palettes end at the reviewed bitstream boundary");
assert.ok(generatedSource.includes('import { decodeStaticBytes } from "../../staticData.ts";')
    && generatedSource.includes("export const TEXTURE_ATLAS_RGBA = new Uint8Array(30720)")
    && !generatedSource.includes("TEXTURE_ATLAS_INDEXES")
    && !generatedSource.includes("new Uint8Array(7680)"),
  "one-time decode expands directly into the fixed RGBA buffer without a transient full-atlas index allocation");

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
