import assert from "node:assert/strict";
import { ITEMS, type ItemId } from "../shared/game.ts";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import {
  ITEM_SPRITE_MAX_VERTICES,
  ITEM_SPRITE_VERTEX_FLOATS,
  appendItemSpriteGeometry,
} from "../client/game/itemSpriteGeometry.ts";

for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  if (ITEMS[itemId].category === "block") continue;
  const output: number[] = [];
  const vertices = appendItemSpriteGeometry(output, getItemIconArt(itemId));
  assert.ok(vertices > 0 && vertices <= ITEM_SPRITE_MAX_VERTICES, `${itemId} produces one bounded 3D sprite`);
  assert.equal(output.length, vertices * ITEM_SPRITE_VERTEX_FLOATS);
  for (let offset = 0; offset < output.length; offset += ITEM_SPRITE_VERTEX_FLOATS) {
    assert.ok(output.slice(offset, offset + ITEM_SPRITE_VERTEX_FLOATS).every(Number.isFinite));
  }
}

const onePixel = {
  family: "material" as const,
  variant: "one-pixel",
  runs: [{ x: 7, y: 7, width: 1, color: "#ffffff" }],
};
const onePixelGeometry: number[] = [];
assert.equal(appendItemSpriteGeometry(onePixelGeometry, onePixel), 36, "one isolated pixel is an exact six-face voxel");
const xs = onePixelGeometry.filter((_, index) => index % ITEM_SPRITE_VERTEX_FLOATS === 0);
const ys = onePixelGeometry.filter((_, index) => index % ITEM_SPRITE_VERTEX_FLOATS === 1);
const zs = onePixelGeometry.filter((_, index) => index % ITEM_SPRITE_VERTEX_FLOATS === 2);
assert.equal(Math.min(...xs), -1 / 16);
assert.equal(Math.max(...xs), 0);
assert.equal(Math.min(...ys), 0);
assert.equal(Math.max(...ys), 1 / 16);
assert.equal(Math.min(...zs), -1 / 32);
assert.equal(Math.max(...zs), 1 / 32);

const pivotedPixelGeometry: number[] = [];
assert.equal(
  appendItemSpriteGeometry(pivotedPixelGeometry, onePixel, { pivotPixels: [7, 7] }),
  onePixelGeometry.length / ITEM_SPRITE_VERTEX_FLOATS,
  "changing a grip pivot preserves sprite topology",
);
assert.notDeepEqual(pivotedPixelGeometry, onePixelGeometry, "pixel-space grip pivots move geometry around the attachment socket");
assert.throws(
  () => appendItemSpriteGeometry([], onePixel, { pivotPixels: [-1, 8] }),
  /finite and visible/,
  "grip pivots stay inside the logical sprite canvas",
);

assert.throws(() => appendItemSpriteGeometry([], {
  family: "material",
  variant: "overlap",
  runs: [
    { x: 1, y: 1, width: 2, color: "#ffffff" },
    { x: 2, y: 1, width: 2, color: "#ffffff" },
  ],
}), /overlap/i);
