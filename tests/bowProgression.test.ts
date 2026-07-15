import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { MOB_DEFINITIONS } from "../client/game/mobs.ts";
import {
  INITIAL_RECIPE_PATTERNS,
  createCraftingGrid,
  matchCraftingGrid,
  takeCraftingResult,
  type CraftingGrid,
} from "../shared/craftingGrid.ts";
import { MOB_AUTHORITY_DEFINITIONS, deterministicMobDrops } from "../shared/mobCombat.ts";
import {
  ITEMS,
  RECIPES,
  createItemStack,
  maxItemDurability,
  type ItemStack,
} from "../shared/game.ts";

assert.deepEqual(
  { category: ITEMS.string.category, maxStack: ITEMS.string.maxStack },
  { category: "material", maxStack: 64 },
);
assert.deepEqual(
  { category: ITEMS.arrow.category, maxStack: ITEMS.arrow.maxStack },
  { category: "material", maxStack: 64 },
);
assert.equal(ITEMS.bow.category, "tool");
assert.equal(ITEMS.bow.maxStack, 1);
assert.equal(ITEMS.bow.tool, undefined, "a bow must not gain mining-tool or melee-tool semantics");
assert.deepEqual(ITEMS.bow.ranged, { maxDurability: 384, maxChargeMs: 1_000 });
assert.equal(maxItemDurability("bow"), 384);
assert.deepEqual(createItemStack("bow"), { itemId: "bow", count: 1, durability: 384 });

const bowRecipe = RECIPES.find(({ id }) => id === "bow");
const arrowRecipe = RECIPES.find(({ id }) => id === "arrows");
assert.ok(bowRecipe && arrowRecipe);
assert.deepEqual(bowRecipe.ingredients, [{ itemId: "stick", count: 3 }, { itemId: "string", count: 3 }]);
assert.deepEqual(bowRecipe.output, { itemId: "bow", count: 1 });
assert.deepEqual(arrowRecipe.ingredients, [
  { itemId: "cobblestone", count: 1 },
  { itemId: "stick", count: 1 },
  { itemId: "wool", count: 1 },
]);
assert.deepEqual(arrowRecipe.output, { itemId: "arrow", count: 4 });
assert.deepEqual(INITIAL_RECIPE_PATTERNS.bow, {
  kind: "shaped",
  pattern: [[null, "stick", "string"], ["stick", null, "string"], [null, "stick", "string"]],
  allowHorizontalMirror: true,
});
assert.deepEqual(INITIAL_RECIPE_PATTERNS.arrows, {
  kind: "shaped",
  pattern: [["cobblestone"], ["stick"], ["wool"]],
});

function stack(itemId: ItemStack["itemId"]): ItemStack { return { itemId, count: 1 }; }
const bowGrid: CraftingGrid = [
  null, stack("stick"), stack("string"),
  stack("stick"), null, stack("string"),
  null, stack("stick"), stack("string"),
];
assert.equal(matchCraftingGrid(bowGrid, 3)?.recipe.id, "bow");
const mirroredBow = [
  stack("string"), stack("stick"), null,
  stack("string"), null, stack("stick"),
  stack("string"), stack("stick"), null,
] satisfies CraftingGrid;
assert.equal(matchCraftingGrid(mirroredBow, 3)?.recipe.id, "bow");
const bowCrafted = takeCraftingResult({ grid: bowGrid, cursor: null }, 3);
assert.ok(bowCrafted.ok);
if (bowCrafted.ok) assert.deepEqual(bowCrafted.state.cursor, createItemStack("bow"));

const arrowGrid = createCraftingGrid(3).slice() as Array<ItemStack | null>;
arrowGrid[1] = stack("cobblestone");
arrowGrid[4] = stack("stick");
arrowGrid[7] = stack("wool");
const arrowsCrafted = takeCraftingResult({ grid: arrowGrid, cursor: null }, 3);
assert.ok(arrowsCrafted.ok);
if (arrowsCrafted.ok) assert.deepEqual(arrowsCrafted.state.cursor, { itemId: "arrow", count: 4 });

const authoritativeDrops = MOB_AUTHORITY_DEFINITIONS.skeleton.drops;
const localDrops = MOB_DEFINITIONS.skeleton.drops;
assert.deepEqual(localDrops, authoritativeDrops, "local presentation fallback mirrors the Lakebed-authoritative drop catalog");
assert.deepEqual(authoritativeDrops.map(({ itemId }) => itemId), ["arrow", "string"]);
const observedDropIds = new Set<string>();
for (let revision = 1; revision <= 64; revision += 1) {
  const first = deterministicMobDrops("skeleton-5nf-4", "skeleton", revision);
  const second = deterministicMobDrops("skeleton-5nf-4", "skeleton", revision);
  assert.deepEqual(second, first, `skeleton revision ${revision} drops are deterministic`);
  for (const drop of first) {
    assert.ok(drop.itemId === "arrow" || drop.itemId === "string");
    assert.ok(drop.count >= 1 && drop.count <= 2);
    observedDropIds.add(drop.itemId);
  }
}
assert.deepEqual([...observedDropIds].sort(), ["arrow", "string"]);

const iconHashes = Object.fromEntries(["string", "arrow", "bow"].map((itemId) => [
  itemId,
  createHash("sha256").update(JSON.stringify(getItemIconArt(itemId as "string" | "arrow" | "bow").runs)).digest("hex"),
]));
assert.deepEqual(iconHashes, {
  string: "81f818befa9cb491f713a6693f0fe96a36a761d766cf2a02368f147cc524085f",
  arrow: "2b55a7d3abe7c73da29eb16b6c723f4a530d615377eae32ab702419aef52ce9e",
  bow: "ff20adc3a65a9a9045bb294995ed54fb1c810b78293d2348b7b7a317ffbb1de8",
});
assert.equal(new Set(Object.values(iconHashes)).size, 3, "each progression item has distinct original pixel art");

console.log("lakecraft bow item, recipe, drop, and icon progression tests: ok");
