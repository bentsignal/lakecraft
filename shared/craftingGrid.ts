import { ITEMS, RECIPES, createItemStack, maxItemDurability, type ItemId, type ItemQuantity, type ItemStack, type Recipe } from "./game.ts";

export type CraftingGridSize = 2 | 3;
export type CraftingGrid = ReadonlyArray<ItemStack | null>;

export type CraftingGridState = {
  grid: CraftingGrid;
  cursor: ItemStack | null;
};

export type ShapedCraftingRecipe = {
  kind: "shaped";
  id: string;
  output: ItemQuantity;
  pattern: ReadonlyArray<ReadonlyArray<ItemId | null>>;
  allowHorizontalMirror?: boolean;
};

export type ShapelessCraftingRecipe = {
  kind: "shapeless";
  id: string;
  output: ItemQuantity;
  ingredients: ReadonlyArray<ItemId>;
};

export type CraftingGridRecipe = ShapedCraftingRecipe | ShapelessCraftingRecipe;

export type CraftingGridMatch = {
  recipe: CraftingGridRecipe;
  /** One entry per ingredient unit. A future recipe may consume a slot more than once. */
  consumedSlots: ReadonlyArray<number>;
};

export type CraftingClickResult =
  | { ok: true; state: CraftingGridState }
  | { ok: false; state: CraftingGridState; reason: "invalid_grid" | "invalid_slot" | "invalid_stack" | "incompatible_stack" | "stack_full" };

export type CraftingTakeResult =
  | { ok: true; state: CraftingGridState; recipeId: string; crafted: ItemQuantity }
  | { ok: false; state: CraftingGridState; reason: "invalid_grid" | "invalid_stack" | "no_recipe" | "cursor_blocked" };

type RecipeShape = Omit<ShapedCraftingRecipe, "id" | "output"> | Omit<ShapelessCraftingRecipe, "id" | "output">;
type RecipePatternEntry = readonly [id: string, shape: RecipeShape];

const P = "planks" as const;
const S = "stick" as const;
const C = "cobblestone" as const;
const K = "coal" as const;
const H = "charcoal" as const;
const W = "wool" as const;

function equipmentPatternEntries(prefix: string, material: ItemId, armor: boolean): RecipePatternEntry[] {
  const shapes: ReadonlyArray<readonly [string, ReadonlyArray<ReadonlyArray<ItemId | null>>]> = armor
    ? [
      ["helmet", [[material, material, material], [material, null, material]]],
      ["chestplate", [[material, null, material], [material, material, material], [material, material, material]]],
      ["leggings", [[material, material, material], [material, null, material], [material, null, material]]],
      ["boots", [[material, null, material], [material, null, material]]],
    ]
    : [
      ["pickaxe", [[material, material, material], [null, S, null], [null, S, null]]],
      ["axe", [[material, material], [material, S], [null, S]]],
      ["shovel", [[material], [S], [S]]],
      ["sword", [[material], [material], [S]]],
    ];
  return shapes.map(([suffix, pattern], index) => [
    `${prefix}_${suffix}`,
    index === 1 && !armor
      ? { kind: "shaped", pattern, allowHorizontalMirror: true }
      : { kind: "shaped", pattern },
  ]);
}

const GENERATED_EQUIPMENT_PATTERNS = Object.fromEntries(([
  ["wooden", P, false],
  ["stone", C, false],
  ["iron", "iron_ingot", false],
  ["golden", "gold_ingot", false],
  ["diamond", "diamond", false],
  ["leather", "leather", true],
  ["iron", "iron_ingot", true],
  ["golden", "gold_ingot", true],
  ["diamond", "diamond", true],
] as const).flatMap(([prefix, material, armor]) => equipmentPatternEntries(prefix, material, armor)));

/**
 * Canonical, Minecraft-style layouts for every recipe currently exported by
 * shared/game.ts. Outputs remain sourced from RECIPES so the grid cannot drift
 * from the game's progression quantities.
 */
export const INITIAL_RECIPE_PATTERNS: Readonly<Record<string, RecipeShape>> = {
  planks_from_log: { kind: "shapeless", ingredients: ["log"] },
  sticks_from_planks: { kind: "shaped", pattern: [[P], [P]] },
  crafting_table: { kind: "shaped", pattern: [[P, P], [P, P]] },
  torch: { kind: "shaped", pattern: [[K], [S]] },
  torch_charcoal: { kind: "shaped", pattern: [[H], [S]] },
  furnace: { kind: "shaped", pattern: [[C, C, C], [C, null, C], [C, C, C]] },
  ladder: { kind: "shaped", pattern: [[S, null, S], [S, S, S], [S, null, S]] },
  chest: { kind: "shaped", pattern: [[P, P, P], [P, null, P], [P, P, P]] },
  door: { kind: "shaped", pattern: [[P, P], [P, P], [P, P]] },
  bed: { kind: "shaped", pattern: [[W, W, W], [P, P, P]] },
  tnt: { kind: "shaped", pattern: [["gunpowder", "sand", "gunpowder"], ["sand", "gunpowder", "sand"], ["gunpowder", "sand", "gunpowder"]] },
  flint_and_steel: { kind: "shaped", pattern: [["iron_ingot", null], [null, "flint"]], allowHorizontalMirror: true },
  shears: { kind: "shaped", pattern: [["iron_ingot", null], [null, "iron_ingot"]], allowHorizontalMirror: true },
  bow: { kind: "shaped", pattern: [[null, S, "string"], [S, null, "string"], [null, S, "string"]], allowHorizontalMirror: true },
  arrows: { kind: "shaped", pattern: [["flint"], [S], ["feather"]] },
  ...GENERATED_EQUIPMENT_PATTERNS,
};

export function adaptRecipesToGrid(
  recipes: readonly Recipe[],
  patterns: Readonly<Record<string, RecipeShape>> = INITIAL_RECIPE_PATTERNS,
): readonly CraftingGridRecipe[] {
  return recipes.flatMap((recipe) => {
    const shape = patterns[recipe.id];
    if (!shape) return [];
    return [{ ...shape, id: recipe.id, output: { ...recipe.output } } as CraftingGridRecipe];
  });
}

export const CRAFTING_GRID_RECIPES: readonly CraftingGridRecipe[] = adaptRecipesToGrid(RECIPES);

export function createCraftingGrid(size: CraftingGridSize): CraftingGrid {
  return Array.from({ length: size * size }, () => null);
}

export function isValidCraftingStack(stack: ItemStack | null): boolean {
  if (stack === null) return true;
  const item = ITEMS[stack.itemId];
  if (!item || !Number.isInteger(stack.count) || stack.count < 1 || stack.count > item.maxStack) return false;
  const maximum = maxItemDurability(stack.itemId);
  if (maximum === null) return stack.durability === undefined;
  return stack.count === 1 && (stack.durability === undefined
    || (Number.isInteger(stack.durability) && (stack.durability ?? 0) >= 1 && (stack.durability ?? 0) <= maximum));
}

export function isValidCraftingGrid(grid: CraftingGrid, size: CraftingGridSize): boolean {
  return grid.length === size * size && grid.every(isValidCraftingStack);
}

export function leftClickCraftingSlot(state: CraftingGridState, slot: number, size: CraftingGridSize): CraftingClickResult {
  const checked = validateInteraction(state, slot, size);
  if (checked) return checked;
  const grid = cloneGrid(state.grid);
  const cursor = cloneStack(state.cursor);
  const target = grid[slot];

  if (!cursor) {
    if (!target) return success(grid, null);
    grid[slot] = null;
    return success(grid, target);
  }
  if (!target) {
    grid[slot] = cursor;
    return success(grid, null);
  }
  if (!areStacksCompatible(cursor, target)) {
    grid[slot] = cursor;
    return success(grid, target);
  }

  const capacity = ITEMS[target.itemId].maxStack - target.count;
  if (capacity <= 0) return failure(grid, cursor, "stack_full");
  const moved = Math.min(capacity, cursor.count);
  grid[slot] = withCount(target, target.count + moved);
  return success(grid, moved === cursor.count ? null : withCount(cursor, cursor.count - moved));
}

export function rightClickCraftingSlot(state: CraftingGridState, slot: number, size: CraftingGridSize): CraftingClickResult {
  const checked = validateInteraction(state, slot, size);
  if (checked) return checked;
  const grid = cloneGrid(state.grid);
  const cursor = cloneStack(state.cursor);
  const target = grid[slot];

  if (!cursor) {
    if (!target) return success(grid, null);
    const pickedUp = Math.ceil(target.count / 2);
    const leftBehind = target.count - pickedUp;
    grid[slot] = leftBehind > 0 ? withCount(target, leftBehind) : null;
    return success(grid, withCount(target, pickedUp));
  }
  if (!target) {
    grid[slot] = withCount(cursor, 1);
    return success(grid, cursor.count === 1 ? null : withCount(cursor, cursor.count - 1));
  }
  if (!areStacksCompatible(cursor, target)) return failure(grid, cursor, "incompatible_stack");
  if (target.count >= ITEMS[target.itemId].maxStack) return failure(grid, cursor, "stack_full");
  grid[slot] = withCount(target, target.count + 1);
  return success(grid, cursor.count === 1 ? null : withCount(cursor, cursor.count - 1));
}

export function matchCraftingGrid(
  grid: CraftingGrid,
  size: CraftingGridSize,
  recipes: readonly CraftingGridRecipe[] = CRAFTING_GRID_RECIPES,
): CraftingGridMatch | null {
  if (!isValidCraftingGrid(grid, size)) return null;
  for (const recipe of recipes) {
    const consumedSlots = recipe.kind === "shaped"
      ? matchShaped(grid, size, recipe)
      : matchShapeless(grid, recipe);
    if (consumedSlots) return { recipe, consumedSlots };
  }
  return null;
}

export function previewCraftingResult(
  grid: CraftingGrid,
  size: CraftingGridSize,
  recipes: readonly CraftingGridRecipe[] = CRAFTING_GRID_RECIPES,
): { recipeId: string; output: ItemStack } | null {
  const match = matchCraftingGrid(grid, size, recipes);
  if (!match) return null;
  return { recipeId: match.recipe.id, output: quantityToStack(match.recipe.output) };
}

/**
 * Takes one result into the cursor and consumes exactly one unit from every
 * matched ingredient slot. If the cursor cannot accept the entire result,
 * nothing changes.
 */
export function takeCraftingResult(
  state: CraftingGridState,
  size: CraftingGridSize,
  recipes: readonly CraftingGridRecipe[] = CRAFTING_GRID_RECIPES,
): CraftingTakeResult {
  const original = cloneState(state);
  if (!isValidCraftingGrid(state.grid, size)) return { ok: false, state: original, reason: "invalid_grid" };
  if (!isValidCraftingStack(state.cursor)) return { ok: false, state: original, reason: "invalid_stack" };
  const match = matchCraftingGrid(state.grid, size, recipes);
  if (!match) return { ok: false, state: original, reason: "no_recipe" };

  const output = quantityToStack(match.recipe.output);
  if (!isValidCraftingStack(output)) return { ok: false, state: original, reason: "invalid_stack" };
  if (state.cursor && (!areStacksCompatible(state.cursor, output)
    || state.cursor.count + output.count > ITEMS[output.itemId].maxStack)) {
    return { ok: false, state: original, reason: "cursor_blocked" };
  }

  const grid = cloneGrid(state.grid);
  const consumption = new Map<number, number>();
  for (const slot of match.consumedSlots) consumption.set(slot, (consumption.get(slot) ?? 0) + 1);
  for (const [slot, count] of consumption) {
    const stack = grid[slot];
    if (!stack || stack.count < count) return { ok: false, state: original, reason: "no_recipe" };
    grid[slot] = stack.count === count ? null : withCount(stack, stack.count - count);
  }

  const cursor = state.cursor ? withCount(state.cursor, state.cursor.count + output.count) : output;
  return {
    ok: true,
    state: { grid, cursor },
    recipeId: match.recipe.id,
    crafted: { ...match.recipe.output },
  };
}

function matchShaped(grid: CraftingGrid, size: CraftingGridSize, recipe: ShapedCraftingRecipe): number[] | null {
  const patterns = recipe.allowHorizontalMirror
    ? [recipe.pattern, mirrorPattern(recipe.pattern)]
    : [recipe.pattern];
  for (const pattern of patterns) {
    const height = pattern.length;
    const width = pattern[0]?.length ?? 0;
    if (height < 1 || width < 1 || height > size || width > size || pattern.some((row) => row.length !== width)) continue;
    for (let offsetRow = 0; offsetRow <= size - height; offsetRow += 1) {
      for (let offsetColumn = 0; offsetColumn <= size - width; offsetColumn += 1) {
        const consumed: number[] = [];
        let matches = true;
        for (let row = 0; row < size && matches; row += 1) {
          for (let column = 0; column < size; column += 1) {
            const inPattern = row >= offsetRow && row < offsetRow + height
              && column >= offsetColumn && column < offsetColumn + width;
            const expected = inPattern ? pattern[row - offsetRow][column - offsetColumn] : null;
            const slot = row * size + column;
            const actual = grid[slot];
            if ((expected === null && actual !== null) || (expected !== null && actual?.itemId !== expected)) {
              matches = false;
              break;
            }
            if (expected !== null) consumed.push(slot);
          }
        }
        if (matches) return consumed;
      }
    }
  }
  return null;
}

function matchShapeless(grid: CraftingGrid, recipe: ShapelessCraftingRecipe): number[] | null {
  const occupied = grid.flatMap((stack, slot) => stack ? [{ itemId: stack.itemId, slot }] : []);
  if (occupied.length !== recipe.ingredients.length) return null;
  const available = [...occupied];
  const consumed: number[] = [];
  for (const ingredient of recipe.ingredients) {
    const index = available.findIndex(({ itemId }) => itemId === ingredient);
    if (index < 0) return null;
    consumed.push(available[index].slot);
    available.splice(index, 1);
  }
  return consumed;
}

function validateInteraction(state: CraftingGridState, slot: number, size: CraftingGridSize): CraftingClickResult | null {
  const original = cloneState(state);
  if (state.grid.length !== size * size) return { ok: false, state: original, reason: "invalid_grid" };
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.grid.length) return { ok: false, state: original, reason: "invalid_slot" };
  if (!state.grid.every(isValidCraftingStack) || !isValidCraftingStack(state.cursor)) {
    return { ok: false, state: original, reason: "invalid_stack" };
  }
  return null;
}

function success(grid: CraftingGrid, cursor: ItemStack | null): CraftingClickResult {
  return { ok: true, state: { grid, cursor: cloneStack(cursor) } };
}

function failure(grid: CraftingGrid, cursor: ItemStack | null, reason: "incompatible_stack" | "stack_full"): CraftingClickResult {
  return { ok: false, state: { grid, cursor: cloneStack(cursor) }, reason };
}

function quantityToStack(quantity: ItemQuantity): ItemStack {
  return createItemStack(quantity.itemId, quantity.count);
}

function areStacksCompatible(left: ItemStack, right: ItemStack): boolean {
  if (left.itemId !== right.itemId) return false;
  const leftDurability = (left as ItemStack & { durability?: number }).durability;
  const rightDurability = (right as ItemStack & { durability?: number }).durability;
  return leftDurability === rightDurability;
}

function cloneState(state: CraftingGridState): CraftingGridState {
  return { grid: cloneGrid(state.grid), cursor: cloneStack(state.cursor) };
}

function cloneGrid(grid: CraftingGrid): Array<ItemStack | null> {
  return grid.map(cloneStack);
}

function cloneStack(stack: ItemStack | null): ItemStack | null {
  return stack ? { ...stack } : null;
}

function withCount(stack: ItemStack, count: number): ItemStack {
  return { ...stack, count };
}

function mirrorPattern(pattern: ReadonlyArray<ReadonlyArray<ItemId | null>>): ReadonlyArray<ReadonlyArray<ItemId | null>> {
  return pattern.map((row) => [...row].reverse());
}
