import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getItemIconArt, ITEM_ICON_SIZE } from "../client/components/itemIconArt.ts";
import {
  INITIAL_RECIPE_PATTERNS,
  matchCraftingGrid,
  takeCraftingResult,
  type CraftingGrid,
} from "../shared/craftingGrid.ts";
import {
  ITEMS,
  RECIPES,
  applyConfirmedDurableItemUse,
  consumeFood,
  createEmptyInventory,
  createItemStack,
  maxItemDurability,
  type ItemStack,
} from "../shared/game.ts";

assert.deepEqual(ITEMS.apple, {
  id: "apple",
  label: "Apple",
  shortLabel: "APL",
  description: "A crisp oak apple that restores four hunger points.",
  category: "food",
  maxStack: 64,
  glyph: "●",
  color: "#c83228",
  food: { hunger: 4 },
});
const apples = createEmptyInventory();
apples[0] = { itemId: "apple", count: 2 };
const eaten = consumeFood(apples, 0, 11);
assert.equal(eaten.ok, true);
if (eaten.ok) {
  assert.equal(eaten.consumed, "apple");
  assert.equal(eaten.restored, 4);
  assert.equal(eaten.hunger, 15);
  assert.deepEqual(eaten.inventory[0], { itemId: "apple", count: 1 });
}

assert.deepEqual(ITEMS.shears, {
  id: "shears",
  label: "Shears",
  shortLabel: "SHR",
  description: "Iron shears that preserve leaf blocks when clipping them.",
  category: "tool",
  maxStack: 1,
  glyph: "✂",
  color: "#c8cfcc",
  utility: { maxDurability: 238 },
});
assert.equal(ITEMS.shears.tool, undefined, "shears do not inherit mining-tool damage, tier, or effectiveness");
assert.equal(maxItemDurability("shears"), 238);
assert.deepEqual(createItemStack("shears", 64), { itemId: "shears", count: 1, durability: 238 });
const nearlyBroken = createEmptyInventory();
nearlyBroken[0] = { itemId: "shears", count: 1, durability: 2 };
const worn = applyConfirmedDurableItemUse(nearlyBroken, 0, "shears");
assert.deepEqual(worn.inventory[0], { itemId: "shears", count: 1, durability: 1 });
assert.deepEqual(applyConfirmedDurableItemUse(worn.inventory, 0, "shears"), {
  inventory: [null, ...worn.inventory.slice(1)],
  used: true,
  broke: true,
  itemId: "shears",
  remainingDurability: 0,
});

const recipe = RECIPES.find(({ id }) => id === "shears");
assert.deepEqual(recipe, {
  id: "shears",
  label: "Shears",
  note: "Two iron ingots make durable clipping shears.",
  craftingContext: "field",
  ingredients: [{ itemId: "iron_ingot", count: 2 }],
  output: { itemId: "shears", count: 1 },
});
assert.deepEqual(INITIAL_RECIPE_PATTERNS.shears, {
  kind: "shaped",
  pattern: [["iron_ingot", null], [null, "iron_ingot"]],
  allowHorizontalMirror: true,
});
const stack = (itemId: ItemStack["itemId"]): ItemStack => ({ itemId, count: 1 });
const diagonal: CraftingGrid = [stack("iron_ingot"), null, null, stack("iron_ingot")];
const mirrored: CraftingGrid = [null, stack("iron_ingot"), stack("iron_ingot"), null];
assert.equal(matchCraftingGrid(diagonal, 2)?.recipe.id, "shears");
assert.equal(matchCraftingGrid(mirrored, 2)?.recipe.id, "shears");
const crafted = takeCraftingResult({ grid: mirrored, cursor: null }, 2);
assert.equal(crafted.ok, true);
if (crafted.ok) {
  assert.deepEqual(crafted.state.cursor, { itemId: "shears", count: 1, durability: 238 });
  assert.deepEqual(crafted.state.grid, [null, null, null, null]);
}

const appleArt = getItemIconArt("apple");
const shearsArt = getItemIconArt("shears");
assert.equal(ITEM_ICON_SIZE, 16);
assert.equal(appleArt.family, "food");
assert.equal(shearsArt.family, "tool");
assert.equal(appleArt.variant, "apple");
assert.equal(shearsArt.variant, "shears");
for (const art of [appleArt, shearsArt]) {
  assert.ok(art.runs.length >= 16, "new sprites use detailed authored silhouettes");
  for (const run of art.runs) {
    assert.ok(run.x >= 0 && run.y >= 0 && run.x + run.width <= 16 && run.y < 16);
    assert.match(run.color, /^#[0-9a-f]{6}$/i);
  }
}
const iconHashes = {
  apple: createHash("sha256").update(JSON.stringify(appleArt.runs)).digest("hex"),
  shears: createHash("sha256").update(JSON.stringify(shearsArt.runs)).digest("hex"),
};
assert.deepEqual(iconHashes, {
  apple: "a1dd22d67a866d0f67c238b8e617c77dc8a04a0f50445af5fdc7aea3551383d2",
  shears: "3b8eabbd2b6866c023597464a4163f0b8eff738d6110abe468198bd124840ba8",
});

console.log("apple food, durable shears, diagonal crafting, and original 16x16 icon tests passed");
