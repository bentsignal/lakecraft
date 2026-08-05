import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ITEM_ICON_SIZE, getBowIconArt, getItemIconArt } from "../client/components/itemIconArt.ts";
import { decodeStaticBytes } from "../client/staticData.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";
import { VISUAL_ASSET_MANIFEST } from "../shared/visualAssetManifest.ts";
import { decodeStaticEncoding, encodeStaticBytes } from "../scripts/static-byte-encoding.mjs";

const itemIds = Object.keys(ITEMS) as ItemId[];
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
const occupiedCells = (itemId: ItemId): ReadonlySet<string> => new Set(occupancyMask(itemId).split("|"));
const toolTiers = ["wooden", "stone", "iron", "golden", "diamond"] as const;
for (const kind of ["pickaxe", "axe", "shovel", "sword"] as const) {
  assert.equal(new Set(toolTiers.map((tier) => occupancyMask(`${tier}_${kind}` as ItemId))).size, 1,
    `${kind} keeps one reviewed silhouette while the material palette changes by tier`);
}
assert.equal(new Set(["pickaxe", "axe", "shovel", "sword"]
  .map((kind) => occupancyMask(`iron_${kind}` as ItemId))).size, 4,
"all four progression tools remain recognizable by shape rather than color alone");

const pickaxeCells = occupiedCells("iron_pickaxe");
for (const cell of ["2:5", "14:5", "5:1", "11:1", "2:14", "3:14", "8:2", "9:7"] as const) {
  assert.ok(pickaxeCells.has(cell), `pickaxe retains crown, twin tips, neck, and long grip at ${cell}`);
}
// Open arch under the transverse head + transparent canvas padding
for (const cell of ["6:3", "7:3", "6:4", "7:4", "10:3", "0:0", "15:0", "0:15", "15:15"] as const) {
  assert.equal(pickaxeCells.has(cell), false,
    `pickaxe keeps transparent negative space at ${cell}`);
}
assert.equal(pickaxeCells.has("7:4"), false,
  "pickaxe crown stays shallow instead of collapsing into a filled hook/blob");
const axeCells = occupiedCells("iron_axe");
for (const cell of ["15:2", "15:3", "15:4", "15:5", "8:7", "2:14"] as const) {
  assert.ok(axeCells.has(cell), `axe retains a straight cutting edge, socket, and long grip at ${cell}`);
}
const shovelCells = occupiedCells("iron_shovel");
for (const cell of ["10:1", "14:2", "9:4", "11:7", "2:14"] as const) {
  assert.ok(shovelCells.has(cell), `shovel retains its broad faceted spade, neck, and grip at ${cell}`);
}
const swordCells = occupiedCells("iron_sword");
for (const cell of ["13:1", "14:2", "3:8", "9:11", "1:13", "2:14"] as const) {
  assert.ok(swordCells.has(cell), `sword retains its tapered tip, crossguard, grip, and pommel at ${cell}`);
}
const ironPickaxeColors = new Set(getItemIconArt("iron_pickaxe").runs.map(({ color }) => color));
assert.ok(ironPickaxeColors.has("#d1d6d2") && ironPickaxeColors.has("#7b4e28") && ironPickaxeColors.has("#ba8350"),
  "pickaxe keeps a distance-readable iron head plus two-tone wooden handle for local and remote renderers");
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
const generatorSource = readFileSync(new URL("../scripts/generate-item-icon-art.ts", import.meta.url), "utf8");
for (const contract of ["blockTextureForFace", "TEXTURE_ATLAS_RGBA", "texturedQuad", "atlasBlock"]) {
  assert.ok(generatorSource.includes(contract), `block inventory sprites derive from production atlas data through ${contract}`);
}
const packedPayload = generatedSource.match(/decodeStaticBytes\("([^"]+)", 10271, 6591, true\)/)?.[1];
assert.ok(packedPayload);
assert.equal(packedPayload.length, 8_240,
  "item icons and drawn bow states retain the reviewed geometry-deduplicated extended LZSS fixture");
const compactArt = decodeStaticBytes(packedPayload, 10_271, 6_591, true);
let compactCursor = 0;
const shapeRuns: number[] = [];
for (let remaining = compactArt[compactCursor++]; remaining > 0; remaining -= 1) {
  const runCount = compactArt[compactCursor];
  shapeRuns.push(runCount);
  compactCursor += 1 + runCount + Math.ceil(runCount / 2);
}
assert.equal(shapeRuns.length, 68, "shared item and bow geometry table remains bounded well below its one-byte limit");
let decodedRunCount = 0;
const readCompactRecord = (label: string): void => {
  const shapeIndex = compactArt[compactCursor++];
  const colorCount = compactArt[compactCursor++];
  assert.ok(shapeIndex < shapeRuns.length, `${label} references a known shared geometry`);
  assert.ok(colorCount > 0 && colorCount <= 16, `${label} retains its nibble-sized local palette`);
  decodedRunCount += shapeRuns[shapeIndex];
  compactCursor += colorCount * 3 + Math.ceil(shapeRuns[shapeIndex] / 2);
};
for (const itemId of itemIds) readCompactRecord(itemId);
assert.equal(decodedRunCount, 5_210, "geometry sharing preserves every reviewed icon run");
for (let stage = 0; stage < 3; stage += 1) readCompactRecord(`bow draw stage ${stage}`);
assert.equal(decodedRunCount, 5_348, "the shared stream preserves every reviewed item and bow-state run");
assert.equal(compactCursor, compactArt.length, "item and bow decoder consumes the compact stream exactly once");
const itemFixtureDirectory = mkdtempSync(join(tmpdir(), "lakecraft-invalid-item-icons-"));
let invalidItemFixture = 0;
const rejectInvalidItemData = async (bytes: Uint8Array, label: string): Promise<void> => {
  const fixturePath = join(itemFixtureDirectory, `itemIconArt-${invalidItemFixture++}.ts`);
  const fixtureSource = generatedSource
    .replace('"../../shared/game.ts"', JSON.stringify(new URL("../../shared/game.ts", generatedPath).href))
    .replace('"../staticData.ts"', JSON.stringify(new URL("../staticData.ts", generatedPath).href))
    .replace(/decodeStaticBytes\("[^"]+", 10271, 6591, true\)/, `Uint8Array.from(${JSON.stringify([...bytes])})`);
  writeFileSync(fixturePath, fixtureSource);
  await assert.rejects(import(pathToFileURL(fixturePath).href), /^Error: Invalid item icon data\.$/, label);
};
const rejectInvalidItemPayload = async (payload: string, label: string): Promise<void> => {
  const fixturePath = join(itemFixtureDirectory, `itemIconArt-${invalidItemFixture++}.ts`);
  const fixtureSource = generatedSource
    .replace('"../../shared/game.ts"', JSON.stringify(new URL("../../shared/game.ts", generatedPath).href))
    .replace('"../staticData.ts"', JSON.stringify(new URL("../staticData.ts", generatedPath).href))
    .replace(packedPayload, payload);
  writeFileSync(fixturePath, fixtureSource);
  await assert.rejects(import(pathToFileURL(fixturePath).href), /^Error: Invalid static data\.$/, label);
};
try {
  const missingShapes = compactArt.slice();
  missingShapes[0] = 0;
  await rejectInvalidItemData(missingShapes, "an empty shared-shape table fails closed");
  const invalidShape = compactArt.slice();
  const itemStart = (() => {
    let cursor = 1;
    for (let remaining = compactArt[0]; remaining > 0; remaining -= 1) {
      const runs = compactArt[cursor];
      cursor += 1 + runs + Math.ceil(runs / 2);
    }
    return cursor;
  })();
  invalidShape[itemStart] = 255;
  await rejectInvalidItemData(invalidShape, "an unknown shape reference fails closed");
  const invalidColor = compactArt.slice();
  invalidColor[itemStart + 2 + invalidColor[itemStart + 1] * 3] = 255;
  await rejectInvalidItemData(invalidColor, "an out-of-range local color index fails closed");
  await rejectInvalidItemData(compactArt.subarray(0, compactArt.length - 1),
    "a truncated item payload fails closed");
  const noncanonicalItemPayload = decodeStaticEncoding(packedPayload).subarray(0, 6_591);
  assert.equal(noncanonicalItemPayload[6_587], 1, "reviewed shared stream ends with one used token bit");
  noncanonicalItemPayload[6_587] = 3;
  await rejectInvalidItemPayload(encodeStaticBytes(noncanonicalItemPayload),
    "the real item module rejects claimed nonexistent final tokens");
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
    && generatedSource.includes("const shapes: number[] = []"),
  "packed bytes and bounded shape offsets stay scoped to the one-time cache initializer");

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
