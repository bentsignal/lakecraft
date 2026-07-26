import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ITEM_ICON_SIZE, getItemIconArt } from "../client/components/itemIconArt.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";

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

const canonicalArt = JSON.stringify(itemIds.map((itemId) => [itemId, getItemIconArt(itemId)]));
assert.equal(fnv1a32(canonicalArt), "d425b5a3", "the complete 97-icon run/color/variant fixture changed unexpectedly");
const generatedPath = new URL("../client/components/itemIconArt.ts", import.meta.url);
const generatedSource = readFileSync(generatedPath, "utf8");
const packedPayload = generatedSource.match(/const packed = atob\("([^"]+)"\)/)?.[1];
assert.ok(packedPayload);
assert.equal(Buffer.from(packedPayload, "base64").length, 5_698,
  "item icons retain the reviewed deterministic LZSS fixture");
assert.ok(generatedSource.includes("new Uint8Array(10250)") && generatedSource.includes("const cache = (() => {"),
  "packed and decoded bytes are scoped to the one-time cache initializer");

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
