import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ITEM_ICON_SIZE, getBowIconArt, getItemIconArt } from "../client/components/itemIconArt.ts";
import { decodeStaticBytes } from "../client/staticData.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";
import { VISUAL_ASSET_MANIFEST } from "../shared/visualAssetManifest.ts";
import { decodeStaticEncoding, encodeStaticBytes } from "../scripts/static-byte-encoding.mjs";

const itemIds = Object.keys(ITEMS) as ItemId[];
const atlasBlockItemIds = new Set<ItemId>([
  "grass", "dirt", "stone", "cobblestone", "sand", "gravel", "glass", "coal_ore", "iron_ore",
  "gold_ore", "diamond_ore", "log", "leaves", "planks", "crafting_table", "furnace", "tnt",
  "wool", "stone_bricks", "clay", "bricks",
]);
const serializedItemIds = itemIds.filter((itemId) => !atlasBlockItemIds.has(itemId));
assert.ok(itemIds.length >= 70, "coverage includes the complete progression catalog");
const fnv1a32 = (value: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const bowStages = [0, 1, 2, 3].map((stage) => getBowIconArt(stage as 0 | 1 | 2 | 3));
assert.strictEqual(bowStages[0], getItemIconArt("bow"), "idle bow is the canonical inventory sprite");
assert.equal(new Set(bowStages.map((art) => JSON.stringify(art.runs))).size, 4,
  "idle and three draw stages have distinct original silhouettes");
assert.deepEqual(bowStages.slice(1).map((art) => art.variant), ["drawing-0", "drawing-1", "drawing-2"]);

for (const itemId of itemIds) {
  const art = getItemIconArt(itemId);
  assert.equal(art.family, ITEMS[itemId].category, `${itemId} reports its canonical family`);
  assert.ok(art.runs.length >= 8, `${itemId} has a non-placeholder pixel silhouette`);
  assert.equal(getItemIconArt(itemId), art, `${itemId} art is cached and stable`);
  for (const run of art.runs) {
    assert.ok(Number.isInteger(run.x) && Number.isInteger(run.y) && Number.isInteger(run.width), `${itemId} uses whole pixel coordinates`);
    assert.ok(run.x >= 0 && run.y >= 0 && run.x + run.width <= ITEM_ICON_SIZE && run.y < ITEM_ICON_SIZE, `${itemId} stays inside its 16px canvas`);
    assert.match(run.color, /^#[0-9a-f]{6}$/i, `${itemId} has an explicit RGB palette`);
  }
}

for (const tier of ["wooden", "stone", "iron", "golden", "diamond"] as const) {
  const variants = ["pickaxe", "axe", "shovel", "sword"].map((kind) => getItemIconArt(`${tier}_${kind}` as ItemId).variant);
  assert.equal(new Set(variants).size, 4, `${tier} tool silhouettes remain distinct`);
}
for (const material of ["leather", "iron", "golden", "diamond"] as const) {
  const variants = ["helmet", "chestplate", "leggings", "boots"].map((piece) => getItemIconArt(`${material}_${piece}` as ItemId).variant);
  assert.equal(new Set(variants).size, 4, `${material} armor silhouettes remain distinct`);
}
assert.notDeepEqual(getItemIconArt("coal_ore").runs, getItemIconArt("coal").runs, "ore and loose materials differ");
assert.notDeepEqual(getItemIconArt("charcoal").runs, getItemIconArt("coal").runs, "charcoal has an original charred-log silhouette distinct from coal");
assert.notDeepEqual(getItemIconArt("raw_iron").runs, getItemIconArt("iron_ingot").runs, "raw and smelted materials differ");
assert.notDeepEqual(getItemIconArt("gunpowder").runs, getItemIconArt("coal").runs, "gunpowder has its own loose-grain silhouette");
assert.equal(getItemIconArt("tnt").variant, "tnt", "TNT retains its block identity in hotbars and inventory grids");
const occupancyMask = (itemId: ItemId): string => {
  const cells: string[] = [];
  for (const run of getItemIconArt(itemId).runs) for (let x = run.x; x < run.x + run.width; x += 1) cells.push(`${x}:${run.y}`);
  return cells.sort().join("|");
};
const occupiedArtCells = (art: ReturnType<typeof getItemIconArt>): ReadonlySet<string> => {
  const cells = new Set<string>();
  for (const run of art.runs) for (let x = run.x; x < run.x + run.width; x += 1) cells.add(`${x}:${run.y}`);
  return cells;
};
const occupiedCells = (itemId: ItemId): ReadonlySet<string> => occupiedArtCells(getItemIconArt(itemId));
const componentSize = (cells: ReadonlySet<string>): number => {
  const first = cells.values().next().value;
  if (!first) return 0;
  const visited = new Set([first]);
  const pending = [first];
  while (pending.length > 0) {
    const [x, y] = pending.pop()!.split(":").map(Number);
    for (const neighbor of [
      `${x - 1}:${y - 1}`, `${x}:${y - 1}`, `${x + 1}:${y - 1}`,
      `${x - 1}:${y}`, `${x + 1}:${y}`,
      `${x - 1}:${y + 1}`, `${x}:${y + 1}`, `${x + 1}:${y + 1}`,
    ]) {
      if (cells.has(neighbor) && !visited.has(neighbor)) { visited.add(neighbor); pending.push(neighbor); }
    }
  }
  return visited.size;
};
const toolTiers = ["wooden", "stone", "iron", "golden", "diamond"] as const;
for (const kind of ["pickaxe", "axe", "shovel", "sword"] as const) {
  assert.equal(new Set(toolTiers.map((tier) => occupancyMask(`${tier}_${kind}` as ItemId))).size, 1,
    `${kind} keeps one reviewed silhouette while the material palette changes by tier`);
}
assert.equal(new Set(["pickaxe", "axe", "shovel", "sword"]
  .map((kind) => occupancyMask(`iron_${kind}` as ItemId))).size, 4,
"all four progression tools retain independently authored, shape-distinct families");

for (const itemId of ["iron_axe", "iron_shovel", "iron_sword"] as const) {
  const cells = occupiedCells(itemId);
  assert.equal(componentSize(cells), cells.size, `${itemId} is one pixel-connected installed silhouette`);
}
for (const [stage, art] of bowStages.entries()) {
  const cells = occupiedArtCells(art);
  assert.equal(componentSize(cells), cells.size, `bow stage ${stage} keeps its limb, string, and arrow connected`);
}
const bowOccupancy = bowStages.map((art) => [...occupiedArtCells(art)].length);
assert.deepEqual(bowOccupancy, [70, 88, 88, 88],
  "installed idle and draw textures preserve their exact opaque-pixel progression");

const planeCatalogIds = itemIds.filter((itemId) => ITEMS[itemId].category === "material" || ITEMS[itemId].category === "food");
assert.ok(new Set(planeCatalogIds.map(occupancyMask)).size >= 20,
  "installed food and material sprites retain a broad set of recognizable silhouettes");
const intentionallyLooseParticles = new Set<ItemId>(["bone_meal", "gunpowder"]);
for (const itemId of planeCatalogIds) {
  if (intentionallyLooseParticles.has(itemId)) continue;
  const cells = occupiedCells(itemId);
  assert.equal(componentSize(cells), cells.size, `${itemId} is one pixel-connected solid or thread silhouette`);
}
for (const itemId of ["iron_pickaxe", "iron_axe", "iron_shovel", "iron_sword"] as const) {
  const cells = occupiedCells(itemId);
  assert.ok(cells.size >= 50 && cells.size <= 90, `${itemId} retains the installed compact tool silhouette`);
  assert.equal(componentSize(cells), cells.size, `${itemId} head and handle remain pixel-connected`);
}
for (const family of [
  ["pork", "beef", "mutton", "rotten_flesh"],
  ["cooked_pork", "cooked_beef", "cooked_mutton", "rotten_flesh"],
] as const) {
  assert.equal(new Set(family.map((itemId) => occupancyMask(itemId))).size, family.length,
    `${family.join(", ")} retain identity-specific silhouettes rather than palette-only swaps`);
}

const canonicalArt = JSON.stringify(itemIds.map((itemId) => [itemId, getItemIconArt(itemId)]));
assert.equal(fnv1a32(canonicalArt), VISUAL_ASSET_MANIFEST.itemIcons.fingerprint,
  "the complete 97-icon run/color/variant fixture changed unexpectedly");
const generatedPath = new URL("../client/components/itemIconArt.ts", import.meta.url);
const generatedSource = readFileSync(generatedPath, "utf8");
const atlasRuntimeSource = readFileSync(new URL("../client/components/atlasBlockItemIcon.ts", import.meta.url), "utf8");
const generatorSource = readFileSync(new URL("../scripts/generate-item-icon-art.ts", import.meta.url), "utf8");
for (const contract of ["blockTextureForFace", "TEXTURE_ATLAS_RGBA", "texturedQuad", "atlasBlock"]) {
  assert.ok(generatorSource.includes(contract), `block inventory sprites derive from production atlas data through ${contract}`);
}
for (const contract of ["blockTextureForFace", "TEXTURE_ATLAS_RGBA", "atlasBlockItemIconRuns"]) {
  assert.ok(atlasRuntimeSource.includes(contract), `serialized block runs are losslessly reconstructed through ${contract}`);
}
const packedMatch = generatedSource.match(/decodeStaticBytes\("([^"]+)", (\d+), (\d+), true\)/);
assert.ok(packedMatch);
const [, packedPayload, decodedLength, packedLength] = packedMatch;
assert.equal(packedPayload.length, Math.ceil(Number(packedLength) / 4) * 5,
  "item icons and drawn bow states retain canonical Base85 packing");
const compactArt = decodeStaticBytes(packedPayload, Number(decodedLength), Number(packedLength), true);
let compactCursor = 0;
const shapeRuns: number[] = [];
for (let remaining = compactArt[compactCursor++]; remaining > 0; remaining -= 1) {
  const rows = compactArt[compactCursor++] * 256 + compactArt[compactCursor++];
  assert.ok(rows > 0, "shared icon geometry includes at least one occupied row");
  const occupiedRows = Array.from({ length: 16 }, (_, row) => row).filter((row) => rows & 1 << row);
  const counts = compactCursor;
  compactCursor += occupiedRows.length;
  let runCount = 0;
  for (let row = 0; row < occupiedRows.length; row += 1) runCount += compactArt[counts + row];
  shapeRuns.push(runCount);
  compactCursor += runCount;
}
assert.ok(shapeRuns.length > 0 && shapeRuns.length < 256,
  "shared item and bow geometry table remains bounded below its one-byte limit");
let decodedRunCount = 0;
const readCompactRecord = (label: string): void => {
  const shapeIndex = compactArt[compactCursor++];
  const colorCount = compactArt[compactCursor++];
  const bitsPerColor = compactArt[compactCursor++];
  assert.ok(shapeIndex < shapeRuns.length, `${label} references a known shared geometry`);
  assert.ok(colorCount > 0 && colorCount <= 255, `${label} retains a byte-sized local palette`);
  assert.equal(bitsPerColor, Math.max(1, Math.ceil(Math.log2(colorCount))),
    `${label} uses the minimum exact color-index width`);
  decodedRunCount += shapeRuns[shapeIndex];
  compactCursor += colorCount * 3 + Math.ceil(shapeRuns[shapeIndex] * bitsPerColor / 8);
};
for (const itemId of serializedItemIds) readCompactRecord(itemId);
for (let stage = 0; stage < 3; stage += 1) readCompactRecord(`bow draw stage ${stage}`);
assert.ok(decodedRunCount > 5_000, "the shared stream preserves every detailed item and bow-state run");
assert.equal(compactCursor, compactArt.length, "item and bow decoder consumes the compact stream exactly once");
const itemFixtureDirectory = mkdtempSync(join(tmpdir(), "lakecraft-invalid-item-icons-"));
let invalidItemFixture = 0;
const rejectInvalidItemData = async (bytes: Uint8Array, label: string): Promise<void> => {
  const fixturePath = join(itemFixtureDirectory, `itemIconArt-${invalidItemFixture++}.ts`);
  const fixtureSource = generatedSource
    .replace('"../../shared/game.ts"', JSON.stringify(new URL("../../shared/game.ts", generatedPath).href))
    .replace('"./atlasBlockItemIcon.ts"', JSON.stringify(new URL("../client/components/atlasBlockItemIcon.ts", import.meta.url).href))
    .replace('"../staticData.ts"', JSON.stringify(new URL("../staticData.ts", generatedPath).href))
    .replace(packedMatch[0], `Uint8Array.from(${JSON.stringify([...bytes])})`);
  writeFileSync(fixturePath, fixtureSource);
  await assert.rejects(import(pathToFileURL(fixturePath).href), /^Error: Invalid item icon data\.$/, label);
};
const itemStart = (() => {
  let cursor = 1;
  for (let remaining = compactArt[0]; remaining > 0; remaining -= 1) {
    const rows = compactArt[cursor++] * 256 + compactArt[cursor++];
    const occupied = Array.from({ length: 16 }, (_, row) => row).filter((row) => rows & 1 << row).length;
    const counts = cursor;
    cursor += occupied;
    for (let row = 0; row < occupied; row += 1) cursor += compactArt[counts + row];
  }
  return cursor;
})();
try {
  const missingShapes = compactArt.slice();
  missingShapes[0] = 0;
  await rejectInvalidItemData(missingShapes, "an empty shared-shape table fails closed");
  const emptyRows = compactArt.slice();
  emptyRows[1] = 0; emptyRows[2] = 0;
  await rejectInvalidItemData(emptyRows, "an empty shared-shape row mask fails closed");
  const invalidShape = compactArt.slice();
  invalidShape[itemStart] = 255;
  await rejectInvalidItemData(invalidShape, "an unknown shape reference fails closed");
  const invalidBits = compactArt.slice();
  invalidBits[itemStart + 2] = 0;
  await rejectInvalidItemData(invalidBits, "a noncanonical color-index width fails closed");
  const invalidColor = compactArt.slice();
  const firstColorCount = invalidColor[itemStart + 1];
  invalidColor[itemStart + 3 + firstColorCount * 3] = 255;
  await rejectInvalidItemData(invalidColor, "an out-of-range variable-width color index fails closed");
  let record = itemStart;
  let paddingRecord = -1;
  for (let index = 0; index < serializedItemIds.length + 3; index += 1) {
    const shapeIndex = compactArt[record];
    const colorCount = compactArt[record + 1];
    const bits = compactArt[record + 2];
    const colorBytes = Math.ceil(shapeRuns[shapeIndex] * bits / 8);
    if (shapeRuns[shapeIndex] * bits % 8 !== 0) { paddingRecord = record; break; }
    record += 3 + colorCount * 3 + colorBytes;
  }
  assert.ok(paddingRecord >= 0, "review fixture contains a partially occupied color byte");
  const invalidPadding = compactArt.slice();
  const paddingShape = invalidPadding[paddingRecord];
  const paddingColors = invalidPadding[paddingRecord + 1];
  const paddingBits = invalidPadding[paddingRecord + 2];
  const paddingEnd = paddingRecord + 3 + paddingColors * 3
    + Math.ceil(shapeRuns[paddingShape] * paddingBits / 8) - 1;
  invalidPadding[paddingEnd] |= 1;
  await rejectInvalidItemData(invalidPadding, "nonzero per-record color padding fails closed");
  await rejectInvalidItemData(compactArt.subarray(0, compactArt.length - 1),
    "a truncated variable-width item payload fails closed");
  const decodedEncoding = decodeStaticEncoding(packedPayload);
  if (decodedEncoding.length > Number(packedLength)) {
    const noncanonical = decodedEncoding.slice();
    noncanonical[Number(packedLength)] = 1;
    const fixturePath = join(itemFixtureDirectory, `itemIconArt-${invalidItemFixture++}.ts`);
    const fixtureSource = generatedSource
      .replace('"../../shared/game.ts"', JSON.stringify(new URL("../../shared/game.ts", generatedPath).href))
      .replace('"./atlasBlockItemIcon.ts"', JSON.stringify(new URL("../client/components/atlasBlockItemIcon.ts", import.meta.url).href))
      .replace('"../staticData.ts"', JSON.stringify(new URL("../staticData.ts", generatedPath).href))
      .replace(packedPayload, encodeStaticBytes(noncanonical));
    writeFileSync(fixturePath, fixtureSource);
    await assert.rejects(import(pathToFileURL(fixturePath).href), /^Error: Invalid static data\.$/,
      "nonzero Base85 padding fails closed");
  }
} finally {
  rmSync(itemFixtureDirectory, { recursive: true, force: true });
}
assert.deepEqual([...decodeStaticBytes(encodeStaticBytes([2, 65, 32, 1]), 6, 4)],
  [65, 65, 65, 65, 65, 65], "the shared decoder preserves overlapping backward-copy semantics");
assert.deepEqual([...decodeStaticBytes(encodeStaticBytes([2, 65, 240, 1, 11]), 30, 5, true)],
  Array<number>(30).fill(65), "extended LZSS preserves long overlapping backward-copy semantics");
const invalidStaticData = (run: () => unknown, label: string): void => {
  assert.throws(run, /^Error: Invalid static data\.$/, label);
};
invalidStaticData(() => decodeStaticBytes("0000", 0, 0), "partial Base85 groups fail closed");
invalidStaticData(() => decodeStaticBytes("0000`", 0, 0), "characters outside the Base85 alphabet fail closed");
invalidStaticData(() => decodeStaticBytes(",,,,,", 0, 0), "Base85 values outside uint32 fail closed");
invalidStaticData(() => decodeStaticBytes(encodeStaticBytes([254, 65]), 1, 2),
  "nonzero unused final control bits fail closed");
invalidStaticData(() => decodeStaticBytes(encodeStaticBytes([2, 65, 240, 1]), 20, 4, true),
  "truncated extended tokens fail closed");
invalidStaticData(() => decodeStaticBytes(encodeStaticBytes([2, 65, 240, 0, 1]), 20, 5, true),
  "zero-distance backreferences fail closed");
invalidStaticData(() => decodeStaticBytes(encodeStaticBytes([2, 65, 240, 2, 1]), 20, 5, true),
  "backreferences before the decoded prefix fail closed");
invalidStaticData(() => decodeStaticBytes(encodeStaticBytes([2, 65, 240, 1, 1]), 18, 5, true),
  "copies beyond the declared output fail closed");
invalidStaticData(() => decodeStaticBytes(encodeStaticBytes([2, 65, 240, 1, 11]), 31, 5, true),
  "declared output larger than the stream fail closed");
invalidStaticData(() => decodeStaticBytes(encodeStaticBytes([0, 65]), 2, 2),
  "declared output larger than a literal stream fail closed");
invalidStaticData(() => decodeStaticBytes(encodeStaticBytes([0, 65]), 0, 2),
  "unconsumed compressed bytes fail closed");
invalidStaticData(() => decodeStaticBytes(encodeStaticBytes([0, 65, 1]), 1, 2),
  "nonzero Base85 padding fails closed");
invalidStaticData(() => decodeStaticBytes(`${encodeStaticBytes([2, 65, 32, 1])}00000`, 6, 8),
  "excess compressed groups fail closed");
assert.ok(generatedSource.includes('import { decodeStaticBytes } from "../staticData.ts";')
    && generatedSource.includes("const cache = (() => {")
    && generatedSource.includes("const shapes: number[][] = []"),
  "packed bytes and decoded row geometry stay scoped to the one-time cache initializer");

const regenerationDirectory = mkdtempSync(join(tmpdir(), "lakecraft-item-icons-"));
try {
  const regeneratedPath = join(regenerationDirectory, "itemIconArt.ts");
  const regeneration = spawnSync(process.execPath, [
    "--experimental-strip-types",
    new URL("../scripts/generate-item-icon-art.ts", import.meta.url).pathname,
    regeneratedPath,
  ], { encoding: "utf8" });
  assert.equal(regeneration.status, 0, regeneration.stderr || regeneration.stdout);
  assert.equal(readFileSync(regeneratedPath, "utf8"), generatedSource,
    "the reviewed icon procedures deterministically regenerate the compact client module");
} finally {
  rmSync(regenerationDirectory, { recursive: true, force: true });
}

console.log(`item icon art tests passed (${itemIds.length} original 16x16 sprites)`);
