import assert from "node:assert/strict";
import { getItemIconArt, ITEM_ICON_SIZE } from "../client/components/itemIconArt.ts";
import { ITEMS, createItemStack } from "../shared/game.ts";

assert.deepEqual(ITEMS.bone, {
  id: "bone",
  label: "Bone",
  shortLabel: "BON",
  description: "A dry skeleton bone that can be ground into bone meal.",
  category: "material",
  maxStack: 64,
  glyph: "╱",
  color: "#ded8bf",
});
assert.deepEqual(createItemStack("bone", 64), { itemId: "bone", count: 64 });
assert.equal(ITEMS.string.description.includes("skeleton"), false, "string no longer claims to come from skeletons");
assert.match(ITEMS.string.description, /spider/i);

const bone = getItemIconArt("bone");
assert.equal(bone.family, "material");
assert.equal(bone.variant, "bone");
assert.ok(bone.runs.length >= 12, "bone uses a recognizable authored silhouette, not the material fallback");
assert.notDeepEqual(bone.runs, getItemIconArt("stick").runs, "bone and stick silhouettes remain distinct");
assert.notDeepEqual(bone.runs, getItemIconArt("iron_ingot").runs, "bone does not fall through to generic material art");
for (const run of bone.runs) {
  assert.ok(Number.isInteger(run.x) && Number.isInteger(run.y) && Number.isInteger(run.width));
  assert.ok(run.x >= 0 && run.y >= 0 && run.x + run.width <= ITEM_ICON_SIZE && run.y < ITEM_ICON_SIZE);
  assert.match(run.color, /^#[0-9a-f]{6}$/i);
}

console.log("bone catalog and original 16x16 icon tests passed");
