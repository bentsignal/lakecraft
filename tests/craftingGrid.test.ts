import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CRAFTING_GRID_RECIPES,
  INITIAL_RECIPE_PATTERNS,
  adaptRecipesToGrid,
  createCraftingGrid,
  isValidCraftingGrid,
  isValidCraftingStack,
  leftClickCraftingSlot,
  matchCraftingGrid,
  previewCraftingResult,
  rightClickCraftingSlot,
  takeCraftingResult,
  type CraftingGrid,
  type CraftingGridRecipe,
  type CraftingGridSize,
  type CraftingGridState,
  type ShapedCraftingRecipe,
} from "../shared/craftingGrid.ts";
import { ITEMS, RECIPES, createItemStack, type ItemId, type ItemStack } from "../shared/game.ts";

function stack(itemId: ItemId, count = 1): ItemStack {
  return { itemId, count };
}

function itemCounts(entries: Iterable<readonly [ItemId, number]>): Record<string, number> {
  const counts = new Map<ItemId, number>();
  for (const [itemId, count] of entries) counts.set(itemId, (counts.get(itemId) ?? 0) + count);
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function gridFromPattern(recipe: CraftingGridRecipe, size: CraftingGridSize, rowOffset = 0, columnOffset = 0): CraftingGrid {
  const grid = createCraftingGrid(size).slice() as Array<ItemStack | null>;
  if (recipe.kind === "shapeless") {
    recipe.ingredients.forEach((itemId, index) => { grid[index] = stack(itemId, index + 2); });
    return grid;
  }
  recipe.pattern.forEach((row, patternRow) => row.forEach((itemId, patternColumn) => {
    if (itemId) grid[(rowOffset + patternRow) * size + columnOffset + patternColumn] = stack(itemId, 3);
  }));
  return grid;
}

assert.deepEqual(createCraftingGrid(2), [null, null, null, null]);
assert.equal(CRAFTING_GRID_RECIPES.length, RECIPES.length, "every current progression recipe has a grid layout");
assert.deepEqual(CRAFTING_GRID_RECIPES.map(({ id }) => id), RECIPES.map(({ id }) => id));
assert.deepEqual(Object.keys(INITIAL_RECIPE_PATTERNS).sort(), RECIPES.map(({ id }) => id).sort());

// The aggregate recipe consumed by authoritative inventory replay must require
// exactly the same item multiset as the occupied grid cells shown to players.
// This covers handwritten recipes plus every generated tool and armor pattern.
for (const recipe of RECIPES) {
  const gridRecipe = CRAFTING_GRID_RECIPES.find(({ id }) => id === recipe.id)!;
  const occupiedItems = gridRecipe.kind === "shaped"
    ? gridRecipe.pattern.flat().filter((itemId): itemId is ItemId => itemId !== null)
    : gridRecipe.ingredients;
  assert.deepEqual(
    itemCounts(occupiedItems.map((itemId) => [itemId, 1] as const)),
    itemCounts(recipe.ingredients.map(({ itemId, count }) => [itemId, count] as const)),
    `${recipe.id} grid cells and aggregate ingredients must consume the same item multiset`,
  );
}

assert.equal(
  createHash("sha256").update(JSON.stringify(INITIAL_RECIPE_PATTERNS)).digest("hex"),
  "a053acf93be5d998f9d3ffe26e33b9560387cceb66ad70f921389e6aa0bdd2bf",
  "generated recipe patterns preserve the exact serialized layout and insertion order",
);
assert.equal(adaptRecipesToGrid([{ ...RECIPES[0], id: "unmapped" }]).length, 0);
assert.deepEqual(INITIAL_RECIPE_PATTERNS.torch, { kind: "shaped", pattern: [["coal"], ["stick"]] }, "torches use the Minecraft coal-over-stick layout");
assert.deepEqual(INITIAL_RECIPE_PATTERNS.torch_charcoal, { kind: "shaped", pattern: [["charcoal"], ["stick"]] }, "alternate torches use the Minecraft charcoal-over-stick layout");
assert.deepEqual((INITIAL_RECIPE_PATTERNS.stone_pickaxe as ShapedCraftingRecipe).pattern[0], ["cobblestone", "cobblestone", "cobblestone"]);
assert.deepEqual(INITIAL_RECIPE_PATTERNS.tnt, {
  kind: "shaped",
  pattern: [["gunpowder", "sand", "gunpowder"], ["sand", "gunpowder", "sand"], ["gunpowder", "sand", "gunpowder"]],
}, "TNT uses the recognizable alternating five-gunpowder/four-sand layout");
assert.deepEqual(INITIAL_RECIPE_PATTERNS.arrows, {
  kind: "shaped",
  pattern: [["flint"], ["stick"], ["feather"]],
}, "arrows use Minecraft's flint-over-stick-over-feather layout");

// Every recipe matches its canonical 3x3 layout and previews the established output quantity.
for (const recipe of CRAFTING_GRID_RECIPES) {
  const grid = gridFromPattern(recipe, 3);
  const match = matchCraftingGrid(grid, 3);
  assert.equal(match?.recipe.id, recipe.id, `${recipe.id} should match its canonical layout`);
  assert.deepEqual(previewCraftingResult(grid, 3), {
    recipeId: recipe.id,
    output: createItemStack(recipe.output.itemId, recipe.output.count),
  });
  const before = structuredClone(grid);
  const taken = takeCraftingResult({ grid, cursor: null }, 3);
  assert.equal(taken.ok, true, `${recipe.id} should be takeable`);
  if (!taken.ok) continue;
  assert.equal(taken.recipeId, recipe.id);
  assert.deepEqual(taken.state.cursor, createItemStack(recipe.output.itemId, recipe.output.count));
  for (const slot of match?.consumedSlots ?? []) {
    assert.equal(taken.state.grid[slot]?.count, (before[slot]?.count ?? 0) - 1, `${recipe.id} consumes one per occupied cell`);
  }
  assert.deepEqual(grid, before, `${recipe.id} must not mutate the input grid`);
}

// Compact player crafting supports canonical field recipes, translated within the grid.
for (const id of ["planks_from_log", "sticks_from_planks", "crafting_table", "torch", "torch_charcoal", "flint_and_steel", "shears"]) {
  const recipe = CRAFTING_GRID_RECIPES.find((candidate) => candidate.id === id)!;
  const grid = gridFromPattern(recipe, 2);
  assert.equal(matchCraftingGrid(grid, 2)?.recipe.id, id);
}
const translatedStickRecipe = CRAFTING_GRID_RECIPES.find(({ id }) => id === "sticks_from_planks")!;
assert.equal(matchCraftingGrid(gridFromPattern(translatedStickRecipe, 3, 0, 2), 3)?.recipe.id, "sticks_from_planks");
assert.equal(matchCraftingGrid(gridFromPattern(translatedStickRecipe, 3, 1, 1), 3)?.recipe.id, "sticks_from_planks");

// Asymmetric tool shapes can be placed in either Minecraft orientation.
for (const id of ["wooden_axe", "stone_axe", "iron_axe", "bow"]) {
  const recipe = CRAFTING_GRID_RECIPES.find((candidate) => candidate.id === id) as ShapedCraftingRecipe;
  const mirrored: ShapedCraftingRecipe = { ...recipe, pattern: recipe.pattern.map((row) => [...row].reverse()) };
  assert.equal(matchCraftingGrid(gridFromPattern(mirrored, 3), 3)?.recipe.id, id);
}

// Shapeless recipes ignore position, but neither extra nor substituted items are accepted.
const logAtEnd = createCraftingGrid(3).slice() as Array<ItemStack | null>;
logAtEnd[8] = stack("log", 64);
assert.equal(matchCraftingGrid(logAtEnd, 3)?.recipe.id, "planks_from_log");
logAtEnd[0] = stack("dirt");
assert.equal(matchCraftingGrid(logAtEnd, 3), null);
logAtEnd[0] = null;
logAtEnd[8] = stack("planks");
assert.equal(matchCraftingGrid(logAtEnd, 3), null);

// Left click: pick up, place, merge to capacity, leave remainder, and swap unlike stacks.
let state: CraftingGridState = { grid: [stack("planks", 10), null, null, null], cursor: null };
let clicked = leftClickCraftingSlot(state, 0, 2);
assert.equal(clicked.ok, true);
assert.deepEqual(clicked.state, { grid: [null, null, null, null], cursor: stack("planks", 10) });
clicked = leftClickCraftingSlot(clicked.state, 1, 2);
assert.deepEqual(clicked.state, { grid: [null, stack("planks", 10), null, null], cursor: null });
clicked = leftClickCraftingSlot({ grid: [stack("planks", 60), null, null, null], cursor: stack("planks", 10) }, 0, 2);
assert.deepEqual(clicked.state, { grid: [stack("planks", 64), null, null, null], cursor: stack("planks", 6) });
clicked = leftClickCraftingSlot({ grid: [stack("dirt", 3), null, null, null], cursor: stack("planks", 2) }, 0, 2);
assert.deepEqual(clicked.state, { grid: [stack("planks", 2), null, null, null], cursor: stack("dirt", 3) });

// Right click: split with the larger half on cursor, then place one at a time.
let right = rightClickCraftingSlot({ grid: [stack("planks", 9), null, null, null], cursor: null }, 0, 2);
assert.deepEqual(right.state, { grid: [stack("planks", 4), null, null, null], cursor: stack("planks", 5) });
right = rightClickCraftingSlot(right.state, 1, 2);
assert.deepEqual(right.state, { grid: [stack("planks", 4), stack("planks", 1), null, null], cursor: stack("planks", 4) });
right = rightClickCraftingSlot(right.state, 1, 2);
assert.deepEqual(right.state, { grid: [stack("planks", 4), stack("planks", 2), null, null], cursor: stack("planks", 3) });
const blockedRight = rightClickCraftingSlot({ grid: [stack("dirt"), null, null, null], cursor: stack("planks") }, 0, 2);
assert.equal(blockedRight.ok, false);
assert.deepEqual(blockedRight.state, { grid: [stack("dirt"), null, null, null], cursor: stack("planks") });

// Result collection merges only when the whole result fits and otherwise consumes nothing.
const planksRecipe = CRAFTING_GRID_RECIPES.find(({ id }) => id === "planks_from_log")!;
const oneLog = gridFromPattern(planksRecipe, 2);
const mergedResult = takeCraftingResult({ grid: oneLog, cursor: stack("planks", 60) }, 2);
assert.equal(mergedResult.ok, true);
assert.deepEqual(mergedResult.state.cursor, stack("planks", 64));
const overflowOriginal = { grid: oneLog, cursor: stack("planks", 61) } satisfies CraftingGridState;
const overflow = takeCraftingResult(overflowOriginal, 2);
assert.equal(overflow.ok, false);
assert.equal(overflow.ok ? null : overflow.reason, "cursor_blocked");
assert.deepEqual(overflow.state, overflowOriginal);
const incompatible = takeCraftingResult({ grid: oneLog, cursor: stack("dirt") }, 2);
assert.equal(incompatible.ok, false);
assert.deepEqual(incompatible.state.grid, oneLog);

// Exploit resistance: malformed grids, bad indexes, invalid/overflow stacks, and partial shapes are rejected.
for (const invalid of [
  { itemId: "planks", count: 0 },
  { itemId: "planks", count: 65 },
  { itemId: "planks", count: 1.5 },
  { itemId: "planks", count: Number.NaN },
  { itemId: "not_an_item", count: 1 },
] as unknown as ItemStack[]) {
  assert.equal(isValidCraftingStack(invalid), false);
}
assert.equal(isValidCraftingGrid([null, null, null], 2), false);
assert.equal(matchCraftingGrid([stack("planks"), stack("planks"), null, null], 2), null, "partial table shape is not a recipe");
const invalidGridClick = leftClickCraftingSlot({ grid: [null], cursor: null }, 0, 2);
assert.equal(invalidGridClick.ok, false);
const invalidSlotClick = leftClickCraftingSlot({ grid: createCraftingGrid(2), cursor: null }, 4, 2);
assert.equal(invalidSlotClick.ok, false);
const invalidCursorClick = leftClickCraftingSlot({ grid: createCraftingGrid(2), cursor: stack("planks", 65) }, 0, 2);
assert.equal(invalidCursorClick.ok, false);

// Stack metadata (including durability) is detached and never merged across different values.
const wornTool = { itemId: "wooden_pickaxe", count: 1, durability: 12 } as ItemStack;
const pickedTool = leftClickCraftingSlot({ grid: [wornTool, null, null, null], cursor: null }, 0, 2);
assert.equal(pickedTool.ok, true);
assert.deepEqual(pickedTool.state.cursor, wornTool);
assert.notEqual(pickedTool.state.cursor, wornTool);
assert.equal(isValidCraftingStack({ itemId: "wooden_pickaxe", count: 2 } as ItemStack), false);
assert.equal(isValidCraftingStack({ itemId: "wooden_pickaxe", count: 1, durability: ITEMS.wooden_pickaxe.tool!.maxDurability + 1 }), false);
assert.equal(isValidCraftingStack({ itemId: "dirt", count: 1, durability: 1 }), false);

for (const recipeId of ["stone_pickaxe", "stone_axe", "stone_shovel", "stone_sword"]) {
  const recipe = RECIPES.find(({ id }) => id === recipeId)!;
  assert.equal(recipe.ingredients.some(({ itemId }) => itemId === "stone"), false, `${recipeId} cannot bypass cobblestone progression`);
  assert.equal(recipe.ingredients.some(({ itemId }) => itemId === "cobblestone"), true);
}

console.log("crafting grid model checks passed");
