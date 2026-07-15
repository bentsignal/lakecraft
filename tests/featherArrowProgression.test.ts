import assert from "node:assert/strict";
import { ITEM_ICON_SIZE, getItemIconArt } from "../client/components/itemIconArt.ts";
import { INITIAL_RECIPE_PATTERNS, matchCraftingGrid } from "../shared/craftingGrid.ts";
import {
  ITEMS,
  RECIPES,
  addItem,
  countItem,
  craftRecipe,
  createEmptyInventory,
  createItemStack,
} from "../shared/game.ts";

assert.deepEqual(ITEMS.feather, {
  id: "feather",
  label: "Feather",
  shortLabel: "FTH",
  description: "A light chicken feather used to fletch arrows.",
  category: "material",
  maxStack: 64,
  glyph: "≀",
  color: "#e7e1ce",
});
assert.deepEqual(createItemStack("feather", 64), { itemId: "feather", count: 64 });

const art = getItemIconArt("feather");
assert.equal(art.family, "material");
assert.equal(art.variant, "feather");
assert.ok(art.runs.length >= 16, "feather uses a detailed authored vane and quill silhouette");
assert.notDeepEqual(art.runs, getItemIconArt("arrow").runs);
assert.notDeepEqual(art.runs, getItemIconArt("iron_ingot").runs, "feather cannot use the generic material fallback");
for (const run of art.runs) {
  assert.ok(Number.isInteger(run.x) && Number.isInteger(run.y) && Number.isInteger(run.width));
  assert.ok(run.x >= 0 && run.y >= 0 && run.x + run.width <= ITEM_ICON_SIZE && run.y < ITEM_ICON_SIZE);
  assert.match(run.color, /^#[0-9a-f]{6}$/i);
  assert.notEqual(run.color.toLowerCase(), "#ff00ff", "every authored feather tone has an explicit palette color");
}

const arrows = RECIPES.find(({ id }) => id === "arrows");
assert.ok(arrows);
assert.deepEqual(arrows.ingredients, [
  { itemId: "flint", count: 1 },
  { itemId: "stick", count: 1 },
  { itemId: "feather", count: 1 },
]);
assert.deepEqual(arrows.output, { itemId: "arrow", count: 4 });
assert.equal(arrows.craftingContext, "crafting_table");
assert.deepEqual(INITIAL_RECIPE_PATTERNS.arrows, {
  kind: "shaped",
  pattern: [["flint"], ["stick"], ["feather"]],
});

const canonicalGrid = [
  null, createItemStack("flint"), null,
  null, createItemStack("stick"), null,
  null, createItemStack("feather"), null,
];
assert.equal(matchCraftingGrid(canonicalGrid, 3)?.recipe.id, "arrows");
const legacyGrid = [
  null, createItemStack("cobblestone"), null,
  null, createItemStack("stick"), null,
  null, createItemStack("wool"), null,
];
assert.equal(matchCraftingGrid(legacyGrid, 3), null, "the placeholder stone-and-wool arrow shortcut is removed");

let inventory = addItem(createEmptyInventory(), "flint", 1).inventory;
inventory = addItem(inventory, "stick", 1).inventory;
inventory = addItem(inventory, "feather", 1).inventory;
const crafted = craftRecipe(inventory, arrows);
assert.equal(crafted.ok, true);
if (crafted.ok) {
  assert.deepEqual(crafted.crafted, { itemId: "arrow", count: 4 });
  assert.equal(countItem(crafted.inventory, "arrow"), 4);
  assert.equal(countItem(crafted.inventory, "flint"), 0);
  assert.equal(countItem(crafted.inventory, "stick"), 0);
  assert.equal(countItem(crafted.inventory, "feather"), 0);
}

console.log("feather catalog, original icon, and authentic arrow crafting tests passed");
