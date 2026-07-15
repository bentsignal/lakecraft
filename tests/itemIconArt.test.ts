import assert from "node:assert/strict";
import { ITEM_ICON_SIZE, getItemIconArt } from "../client/components/itemIconArt.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";

const itemIds = Object.keys(ITEMS) as ItemId[];
assert.ok(itemIds.length >= 70, "coverage includes the complete progression catalog");

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

console.log(`item icon art tests passed (${itemIds.length} original 16x16 sprites)`);
