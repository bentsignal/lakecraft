import {
  HOTBAR_SIZE,
  ITEMS,
  addItemStack,
  areItemStacksCompatible,
  maxItemDurability,
  normalizeEquipment,
  type ArmorSlot,
  type Equipment,
  type Inventory,
  type ItemStack,
} from "./game.ts";
import {
  createCraftingGrid,
  isValidCraftingGrid,
  isValidCraftingStack,
  leftClickCraftingSlot,
  rightClickCraftingSlot,
  takeCraftingResult,
  type CraftingGridSize,
  type CraftingTakeResult,
} from "./craftingGrid.ts";

export type InventoryWorkspace = {
  inventory: Inventory;
  equipment: Equipment;
  gridSize: CraftingGridSize;
  grid: Inventory;
  /** One cursor is shared by inventory, armor, and crafting-grid interactions. */
  cursor: ItemStack | null;
};

export type InventoryWorkspaceActionReason =
  | "invalid_slot"
  | "incompatible_stack"
  | "stack_full"
  | "no_capacity"
  | "empty_slot";

export type InventoryWorkspaceActionResult =
  | { ok: true; state: InventoryWorkspace }
  | { ok: false; state: InventoryWorkspace; reason: InventoryWorkspaceActionReason };

export type StowedInventorySnapshot = {
  inventory: Inventory;
  equipment: Equipment;
};

export type StowInventoryWorkspaceResult =
  | { ok: true; snapshot: StowedInventorySnapshot }
  | { ok: false; state: InventoryWorkspace; reason: "no_capacity" };

export type TakeWorkspaceCraftingResult =
  | { ok: true; state: InventoryWorkspace; recipeId: string; crafted: { itemId: ItemStack["itemId"]; count: number } }
  | { ok: false; state: InventoryWorkspace; reason: Extract<CraftingTakeResult, { ok: false }>["reason"] };

export type TakeAllWorkspaceCraftingResults =
  | { ok: true; state: InventoryWorkspace; recipeId: string; crafted: { itemId: ItemStack["itemId"]; count: number; batches: number } }
  | { ok: false; state: InventoryWorkspace; reason: Extract<CraftingTakeResult, { ok: false }>["reason"] | "no_capacity" };

const ARMOR_SLOTS: readonly ArmorSlot[] = ["head", "chest", "legs", "feet"];

/**
 * Starts a decomposed local inventory session. Inputs are validated rather than
 * repaired, detached, and never mutated. Grid items and the cursor are absent
 * until the player moves something into them.
 */
export function createInventoryWorkspace(
  inventory: readonly (ItemStack | null)[],
  equipment: Equipment,
  gridSize: CraftingGridSize = 2,
): InventoryWorkspace {
  return cloneInventoryWorkspaceStrict({
    inventory: inventory.map(cloneStack),
    equipment: cloneEquipmentStrict(equipment),
    gridSize,
    grid: createCraftingGrid(gridSize).map(cloneStack),
    cursor: null,
  });
}

/** Strictly validates and deeply detaches a workspace without normalizing stacks. */
export function cloneInventoryWorkspaceStrict(value: InventoryWorkspace): InventoryWorkspace {
  if (!isValidInventoryWorkspace(value)) throw new TypeError("Invalid inventory workspace");
  return {
    inventory: value.inventory.map(cloneStack),
    equipment: cloneEquipmentStrict(value.equipment),
    gridSize: value.gridSize,
    grid: value.grid.map(cloneStack),
    cursor: cloneStack(value.cursor),
  };
}

export function isValidInventoryWorkspace(value: unknown): value is InventoryWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<InventoryWorkspace>;
  if (candidate.gridSize !== 2 && candidate.gridSize !== 3) return false;
  if (!("cursor" in candidate) || candidate.cursor === undefined) return false;
  if (!Array.isArray(candidate.inventory) || candidate.inventory.length < HOTBAR_SIZE
    || !candidate.inventory.every(isValidWorkspaceStack)) return false;
  if (!Array.isArray(candidate.grid) || !isValidCraftingGrid(candidate.grid, candidate.gridSize)
    || !candidate.grid.every(isValidWorkspaceStack)) return false;
  if (!isValidWorkspaceStack(candidate.cursor)) return false;
  return isValidEquipmentStrict(candidate.equipment);
}

export function leftClickInventorySlot(state: InventoryWorkspace, slot: number): InventoryWorkspaceActionResult {
  return clickInventorySlot(state, slot, false);
}

export function rightClickInventorySlot(state: InventoryWorkspace, slot: number): InventoryWorkspaceActionResult {
  return clickInventorySlot(state, slot, true);
}

export function leftClickArmorSlot(state: InventoryWorkspace, slot: ArmorSlot): InventoryWorkspaceActionResult {
  return clickArmorSlot(state, slot);
}

/** Armor is unstackable, so right click has the same pickup/equip/swap semantics as left click. */
export function rightClickArmorSlot(state: InventoryWorkspace, slot: ArmorSlot): InventoryWorkspaceActionResult {
  return clickArmorSlot(state, slot);
}

export function leftClickWorkspaceCraftingSlot(state: InventoryWorkspace, slot: number): InventoryWorkspaceActionResult {
  const original = cloneInventoryWorkspaceStrict(state);
  const result = leftClickCraftingSlot({ grid: state.grid, cursor: state.cursor }, slot, state.gridSize);
  if (!result.ok) return { ok: false, state: original, reason: mapCraftingClickReason(result.reason) };
  return successFrom(original, { grid: result.state.grid.map(cloneStack), cursor: cloneStack(result.state.cursor) });
}

export function rightClickWorkspaceCraftingSlot(state: InventoryWorkspace, slot: number): InventoryWorkspaceActionResult {
  const original = cloneInventoryWorkspaceStrict(state);
  const result = rightClickCraftingSlot({ grid: state.grid, cursor: state.cursor }, slot, state.gridSize);
  if (!result.ok) return { ok: false, state: original, reason: mapCraftingClickReason(result.reason) };
  return successFrom(original, { grid: result.state.grid.map(cloneStack), cursor: cloneStack(result.state.cursor) });
}

/** Shift-clicking a crafting ingredient returns that exact stack to the pack. */
export function shiftClickWorkspaceCraftingSlot(state: InventoryWorkspace, slot: number): InventoryWorkspaceActionResult {
  const next = cloneInventoryWorkspaceStrict(state);
  if (!Number.isInteger(slot) || slot < 0 || slot >= next.grid.length) return failure(next, "invalid_slot");
  const source = next.grid[slot];
  if (!source) return failure(next, "empty_slot");
  const targetIndexes = [
    ...range(HOTBAR_SIZE, next.inventory.length),
    ...range(0, Math.min(HOTBAR_SIZE, next.inventory.length)),
  ];
  const moved = moveStackToIndexes(next.inventory, source, targetIndexes);
  if (moved <= 0) return failure(next, "no_capacity");
  next.grid[slot] = moved === source.count ? null : withCount(source, source.count - moved);
  return { ok: true, state: next };
}

/**
 * Minecraft-style Shift transfer. Armor auto-equips only into its matching
 * empty slot; otherwise backpack slots (9+) and hotbar slots (0..8) transfer
 * in opposite directions, merging exact identity before using empty slots.
 */
export function shiftClickInventorySlot(state: InventoryWorkspace, slot: number): InventoryWorkspaceActionResult {
  const next = cloneInventoryWorkspaceStrict(state);
  if (!isInventorySlot(next, slot)) return failure(next, "invalid_slot");
  const source = next.inventory[slot];
  if (!source) return failure(next, "empty_slot");

  const armor = ITEMS[source.itemId].armor;
  if (armor && !next.equipment[armor.slot]) {
    next.equipment[armor.slot] = { itemId: source.itemId as NonNullable<Equipment[ArmorSlot]>["itemId"], durability: source.durability! };
    next.inventory[slot] = null;
    return { ok: true, state: next };
  }

  const targetIndexes = slot < HOTBAR_SIZE
    ? range(HOTBAR_SIZE, next.inventory.length)
    : range(0, Math.min(HOTBAR_SIZE, next.inventory.length));
  const moved = moveStackToIndexes(next.inventory, source, targetIndexes);
  if (moved <= 0) return failure(next, "no_capacity");
  next.inventory[slot] = moved === source.count ? null : withCount(source, source.count - moved);
  return { ok: true, state: next };
}

/** Shift-clicking worn armor atomically returns it to inventory or does nothing. */
export function shiftClickArmorSlot(state: InventoryWorkspace, slot: ArmorSlot): InventoryWorkspaceActionResult {
  const next = cloneInventoryWorkspaceStrict(state);
  if (!isArmorSlot(slot)) return failure(next, "invalid_slot");
  const equipped = next.equipment[slot];
  if (!equipped) return failure(next, "empty_slot");
  const source = { ...equipped, count: 1 };
  const targetIndexes = [
    ...range(HOTBAR_SIZE, next.inventory.length),
    ...range(0, Math.min(HOTBAR_SIZE, next.inventory.length)),
  ];
  if (moveStackToIndexes(next.inventory, source, targetIndexes) !== 1) return failure(next, "no_capacity");
  next.equipment[slot] = null;
  return { ok: true, state: next };
}

/** Gathers every exact-identity stack from inventory and grid up to cursor capacity. */
export function doubleClickGatherToCursor(state: InventoryWorkspace): InventoryWorkspaceActionResult {
  const next = cloneInventoryWorkspaceStrict(state);
  const cursor = next.cursor;
  if (!cursor) return failure(next, "empty_slot");
  const maximum = ITEMS[cursor.itemId].maxStack;
  if (cursor.count >= maximum) return failure(next, "stack_full");

  let count = cursor.count;
  for (const slots of [next.inventory, next.grid]) {
    for (let index = 0; index < slots.length && count < maximum; index += 1) {
      const source = slots[index];
      if (!source || !areItemStacksCompatible(source, cursor)) continue;
      const moved = Math.min(source.count, maximum - count);
      count += moved;
      slots[index] = moved === source.count ? null : withCount(source, source.count - moved);
    }
  }
  if (count === cursor.count) return failure(next, "no_capacity");
  next.cursor = withCount(cursor, count);
  return { ok: true, state: next };
}

export function takeWorkspaceCraftingResult(state: InventoryWorkspace): TakeWorkspaceCraftingResult {
  const next = cloneInventoryWorkspaceStrict(state);
  const result = takeCraftingResult({ grid: next.grid, cursor: next.cursor }, next.gridSize);
  if (!result.ok) return { ok: false, state: next, reason: result.reason };
  next.grid = result.state.grid.map(cloneStack);
  next.cursor = cloneStack(result.state.cursor);
  return { ok: true, state: next, recipeId: result.recipeId, crafted: { ...result.crafted } };
}

/**
 * Shift-takes as many batches of the initially matched recipe as will fit.
 * Residual ingredients are never allowed to switch the batch to another recipe.
 */
export function takeAllWorkspaceCraftingResultsToInventory(state: InventoryWorkspace): TakeAllWorkspaceCraftingResults {
  const original = cloneInventoryWorkspaceStrict(state);
  if (original.cursor) return { ok: false, state: original, reason: "cursor_blocked" };
  let next = original;
  let recipeId = "";
  let itemId: ItemStack["itemId"] | null = null;
  let count = 0;
  let batches = 0;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const result = takeWorkspaceCraftingResult(next);
    if (!result.ok) {
      if (batches === 0) return { ok: false, state: original, reason: result.reason };
      break;
    }
    if (recipeId && result.recipeId !== recipeId) break;
    if (!recipeId) {
      recipeId = result.recipeId;
      itemId = result.crafted.itemId;
    }
    if (!result.state.cursor) break;
    const added = addItemStack(result.state.inventory, result.state.cursor, result.state.cursor.count);
    if (added.remainder > 0) {
      if (batches === 0) return { ok: false, state: original, reason: "no_capacity" };
      break;
    }
    next = { ...result.state, inventory: added.inventory, cursor: null };
    count += result.crafted.count;
    batches += 1;
  }
  return { ok: true, state: next, recipeId, crafted: { itemId: itemId!, count, batches } };
}

/**
 * Produces the full canonical snapshot suitable for the Lakebed inventory CAS.
 * The decomposed workspace remains intact. If everything cannot fit, no partial
 * snapshot is exposed and the returned state is an untouched deep clone.
 */
export function stowInventoryWorkspace(state: InventoryWorkspace): StowInventoryWorkspaceResult {
  const original = cloneInventoryWorkspaceStrict(state);
  let inventory = original.inventory.map(cloneStack);
  for (const source of [...original.grid, original.cursor]) {
    if (!source) continue;
    const added = addItemStack(inventory, source, source.count);
    if (added.remainder > 0) return { ok: false, state: original, reason: "no_capacity" };
    inventory = added.inventory;
  }
  return {
    ok: true,
    snapshot: { inventory, equipment: cloneEquipmentStrict(original.equipment) },
  };
}

function clickInventorySlot(state: InventoryWorkspace, slot: number, right: boolean): InventoryWorkspaceActionResult {
  const next = cloneInventoryWorkspaceStrict(state);
  if (!isInventorySlot(next, slot)) return failure(next, "invalid_slot");
  const target = next.inventory[slot];
  const cursor = next.cursor;

  if (!cursor) {
    if (!target) return failure(next, "empty_slot");
    if (right) {
      const picked = Math.ceil(target.count / 2);
      next.cursor = withCount(target, picked);
      next.inventory[slot] = picked === target.count ? null : withCount(target, target.count - picked);
    } else {
      next.cursor = target;
      next.inventory[slot] = null;
    }
    return { ok: true, state: next };
  }

  if (!target) {
    const placed = right ? 1 : cursor.count;
    next.inventory[slot] = withCount(cursor, placed);
    next.cursor = placed === cursor.count ? null : withCount(cursor, cursor.count - placed);
    return { ok: true, state: next };
  }

  if (!areItemStacksCompatible(cursor, target)) {
    if (right) return failure(next, "incompatible_stack");
    next.inventory[slot] = cursor;
    next.cursor = target;
    return { ok: true, state: next };
  }

  const capacity = ITEMS[target.itemId].maxStack - target.count;
  if (capacity <= 0) return failure(next, "stack_full");
  const moved = right ? 1 : Math.min(capacity, cursor.count);
  next.inventory[slot] = withCount(target, target.count + moved);
  next.cursor = moved === cursor.count ? null : withCount(cursor, cursor.count - moved);
  return { ok: true, state: next };
}

function clickArmorSlot(state: InventoryWorkspace, slot: ArmorSlot): InventoryWorkspaceActionResult {
  const next = cloneInventoryWorkspaceStrict(state);
  if (!isArmorSlot(slot)) return failure(next, "invalid_slot");
  const target = next.equipment[slot];
  const cursor = next.cursor;
  if (!cursor) {
    if (!target) return failure(next, "empty_slot");
    next.cursor = { ...target, count: 1 };
    next.equipment[slot] = null;
    return { ok: true, state: next };
  }

  const armor = ITEMS[cursor.itemId].armor;
  if (!armor || armor.slot !== slot || cursor.count !== 1) return failure(next, "incompatible_stack");
  next.equipment[slot] = {
    itemId: cursor.itemId as NonNullable<Equipment[ArmorSlot]>["itemId"],
    durability: cursor.durability!,
  };
  next.cursor = target ? { ...target, count: 1 } : null;
  return { ok: true, state: next };
}

function moveStackToIndexes(inventory: Inventory, source: ItemStack, indexes: readonly number[]): number {
  let remainder = source.count;
  const maximum = ITEMS[source.itemId].maxStack;
  for (const index of indexes) {
    const target = inventory[index];
    if (!target || !areItemStacksCompatible(target, source) || target.count >= maximum) continue;
    const moved = Math.min(remainder, maximum - target.count);
    inventory[index] = withCount(target, target.count + moved);
    remainder -= moved;
    if (remainder === 0) return source.count;
  }
  for (const index of indexes) {
    if (inventory[index]) continue;
    const moved = Math.min(remainder, maximum);
    inventory[index] = withCount(source, moved);
    remainder -= moved;
    if (remainder === 0) break;
  }
  return source.count - remainder;
}

function cloneEquipmentStrict(equipment: Equipment): Equipment {
  if (!isValidEquipmentStrict(equipment)) throw new TypeError("Invalid inventory equipment");
  // Validation makes normalization an exact detached clone, not a repair.
  return normalizeEquipment(equipment);
}

function isValidEquipmentStrict(value: unknown): value is Equipment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<Record<ArmorSlot, unknown>>;
  if (Object.keys(candidate).length !== ARMOR_SLOTS.length
    || Object.keys(candidate).some((slot) => !isArmorSlot(slot))) return false;
  return ARMOR_SLOTS.every((slot) => {
    const stack = candidate[slot];
    if (stack === null) return true;
    if (!stack || typeof stack !== "object" || Array.isArray(stack)) return false;
    const armor = ITEMS[(stack as { itemId?: ItemStack["itemId"] }).itemId!]?.armor;
    const durability = (stack as { durability?: unknown }).durability;
    return armor?.slot === slot && Number.isInteger(durability)
      && (durability as number) >= 1 && (durability as number) <= armor.maxDurability;
  });
}

function isValidWorkspaceStack(stack: ItemStack | null): boolean {
  if (!isValidCraftingStack(stack) || !stack) return stack === null;
  const maximum = maxItemDurability(stack.itemId);
  return maximum === null || (Number.isInteger(stack.durability)
    && (stack.durability ?? 0) >= 1 && (stack.durability ?? 0) <= maximum);
}

function isInventorySlot(state: InventoryWorkspace, slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < state.inventory.length;
}

function isArmorSlot(slot: string): slot is ArmorSlot {
  return (ARMOR_SLOTS as readonly string[]).includes(slot);
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}

function withCount(stack: ItemStack, count: number): ItemStack {
  return { ...stack, count };
}

function cloneStack(stack: ItemStack | null): ItemStack | null {
  return stack ? { ...stack } : null;
}

function successFrom(
  state: InventoryWorkspace,
  replacement: Pick<InventoryWorkspace, "grid" | "cursor">,
): InventoryWorkspaceActionResult {
  return { ok: true, state: { ...state, ...replacement } };
}

function failure(state: InventoryWorkspace, reason: InventoryWorkspaceActionReason): InventoryWorkspaceActionResult {
  return { ok: false, state, reason };
}

function mapCraftingClickReason(
  reason: "invalid_grid" | "invalid_slot" | "invalid_stack" | "incompatible_stack" | "stack_full",
): InventoryWorkspaceActionReason {
  if (reason === "invalid_slot") return "invalid_slot";
  if (reason === "stack_full") return "stack_full";
  return "incompatible_stack";
}
