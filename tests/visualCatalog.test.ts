import assert from "node:assert/strict";
import { ITEMS, type ItemId } from "../shared/game.ts";
import {
  ITEM_VISUALS,
  itemVisual,
  itemVisualIds,
  type ItemDisplayContext,
} from "../shared/visualCatalog.ts";

const contexts: readonly ItemDisplayContext[] = [
  "gui",
  "firstPersonRight",
  "thirdPersonRight",
  "ground",
  "fixed",
];

const itemIds = Object.keys(ITEMS).sort() as ItemId[];
assert.deepEqual([...itemVisualIds()].sort(), itemIds, "the visual catalog covers every gameplay item exactly once");

for (const itemId of itemIds) {
  const definition = itemVisual(itemId);
  assert.strictEqual(definition, ITEM_VISUALS[itemId]);
  assert.equal(definition.id, itemId);
  assert.equal(definition.artwork, itemId, `${itemId} uses its one canonical original artwork key`);
  assert.equal(definition.family, ITEMS[itemId].category === "block" ? "block" : "sprite");
  assert.ok(definition.variants.length > 0, `${itemId} declares at least one visual state`);
  for (const context of contexts) {
    const visualTransform = definition.display[context];
    assert.ok(visualTransform, `${itemId} resolves ${context}`);
    for (const component of [
      ...visualTransform.translation,
      ...visualTransform.rotationDegrees,
      ...visualTransform.scale,
    ]) assert.ok(Number.isFinite(component), `${itemId} ${context} contains only finite values`);
    assert.ok(visualTransform.scale.every((component) => component > 0), `${itemId} ${context} has visible scale`);
    if (visualTransform.pivot) {
      assert.ok(visualTransform.pivot.every(Number.isFinite), `${itemId} ${context} pivot contains only finite values`);
      assert.ok(visualTransform.pivot[0] >= 0 && visualTransform.pivot[0] <= 16);
      assert.ok(visualTransform.pivot[1] >= 0 && visualTransform.pivot[1] <= 16);
    }
  }
}

assert.equal(itemVisual("diamond_pickaxe").parent, "handheld", "tools inherit one measured handheld pose");
assert.deepEqual(itemVisual("bow").variants, ["idle", "drawing-0", "drawing-1", "drawing-2"]);
assert.equal(itemVisual("grass").parent, "block", "full blocks retain their isometric/held cube contexts");
assert.equal(itemVisual("diamond").parent, "generated", "flat materials use sprite extrusion contexts");
