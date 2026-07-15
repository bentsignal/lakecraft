import {
  INVENTORY_SIZE,
  ITEMS,
  SMELTING_RECIPES,
  addItemStack,
  cloneInventory,
  maxItemDurability,
  type Inventory,
  type ItemId,
  type ItemStack,
  type SmeltingRecipe,
} from "./game.ts";

export const FURNACE_COAL_BURN_MS = 80_000;
export const FURNACE_COOK_MS = 10_000;
export const MAX_FURNACE_JSON_LENGTH = 1_024;
export const MAX_FURNACE_TRUSTED_TIME_MS = 8_640_000_000_000_000;
export const FURNACE_MIN_XZ = -1_000_000;
export const FURNACE_MAX_XZ = 1_000_000;
export const FURNACE_MIN_Y = -24;
export const FURNACE_MAX_Y = 128;

const INPUT_IDS = new Set<ItemId>(SMELTING_RECIPES.map(({ input }) => input));
const OUTPUT_IDS = new Set<ItemId>(SMELTING_RECIPES.map(({ output }) => output));
const FURNACE_STATE_KEYS = [
  "coordKey",
  "input",
  "fuel",
  "output",
  "burnRemainingMs",
  "cookProgressMs",
  "lastMaterializedAtMs",
] as const;

export interface FurnaceState {
  coordKey: string;
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  burnRemainingMs: number;
  cookProgressMs: number;
  lastMaterializedAtMs: number;
}

export type FurnaceTransferAction =
  | { kind: "deposit_input" | "deposit_fuel"; inventorySlot: number; count: number }
  | { kind: "take_input" | "take_fuel" | "take_output"; count: number };

export type FurnaceCoordinateValidation =
  | { ok: true; coordKey: string; x: number; y: number; z: number }
  | { ok: false; reason: "invalid_coordinate" };

export type FurnaceValidationIssue =
  | "too_large"
  | "invalid_json"
  | "invalid_shape"
  | "invalid_coordinate"
  | "coordinate_mismatch"
  | "invalid_slot"
  | "invalid_timing";

export type FurnaceValidation =
  | { ok: true; state: FurnaceState; furnaceJson: string }
  | { ok: false; reason: FurnaceValidationIssue };

export type FurnaceCreateResult =
  | { ok: true; state: FurnaceState }
  | { ok: false; reason: "invalid_coordinate" | "invalid_time" };

export type FurnaceMaterializationResult =
  | { ok: true; state: FurnaceState; cooked: number; fuelConsumed: number }
  | { ok: false; reason: "invalid_furnace" | "invalid_time"; detail?: FurnaceValidationIssue };

export type FurnaceSerializationResult =
  | { ok: true; state: FurnaceState; furnaceJson: string }
  | { ok: false; reason: FurnaceValidationIssue };

export type FurnaceTransferFailure =
  | "invalid_furnace"
  | "invalid_inventory"
  | "invalid_action"
  | "invalid_time"
  | "empty_source"
  | "wrong_item"
  | "incompatible_stack"
  | "no_capacity"
  | "conservation_failure";

export type FurnaceTransferResult =
  | {
      ok: true;
      state: FurnaceState;
      inventory: Inventory;
      moved: { itemId: ItemId; count: number };
      cooked: number;
      fuelConsumed: number;
    }
  | { ok: false; reason: FurnaceTransferFailure; state: FurnaceState; inventory: Inventory };

function own(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function cloneStack(stack: ItemStack | null): ItemStack | null {
  return stack ? { ...stack } : null;
}

function cloneFurnace(state: FurnaceState): FurnaceState {
  return {
    coordKey: state.coordKey,
    input: cloneStack(state.input),
    fuel: cloneStack(state.fuel),
    output: cloneStack(state.output),
    burnRemainingMs: state.burnRemainingMs,
    cookProgressMs: state.cookProgressMs,
    lastMaterializedAtMs: state.lastMaterializedAtMs,
  };
}

function isTrustedTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 0 && value <= MAX_FURNACE_TRUSTED_TIME_MS;
}

function recipeForInput(stack: ItemStack | null): SmeltingRecipe | null {
  return stack ? SMELTING_RECIPES.find(({ input }) => input === stack.itemId) ?? null : null;
}

function validPlainStack(value: unknown, allowed: ReadonlySet<ItemId>): ItemStack | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !own(record, "itemId") || !own(record, "count")) return undefined;
  if (typeof record.itemId !== "string" || !own(ITEMS, record.itemId)) return undefined;
  const itemId = record.itemId as ItemId;
  if (!allowed.has(itemId) || typeof record.count !== "number" || !Number.isInteger(record.count)
    || record.count < 1 || record.count > ITEMS[itemId].maxStack) return undefined;
  return { itemId, count: record.count };
}

function validInventory(value: readonly (ItemStack | null)[]): value is Inventory {
  if (!Array.isArray(value) || value.length !== INVENTORY_SIZE) return false;
  for (const slot of value) {
    if (slot === null) continue;
    if (!slot || typeof slot !== "object" || Array.isArray(slot) || !own(ITEMS, slot.itemId)) return false;
    const item = ITEMS[slot.itemId];
    if (!Number.isInteger(slot.count) || slot.count < 1 || slot.count > item.maxStack) return false;
    const maximum = maxItemDurability(slot.itemId);
    if (maximum !== null) {
      if (slot.count !== 1 || !Number.isInteger(slot.durability)
        || (slot.durability ?? 0) < 1 || (slot.durability ?? 0) > maximum) return false;
    } else if (slot.durability !== undefined) return false;
  }
  return true;
}

function canonicalJson(state: FurnaceState): string {
  return JSON.stringify({
    coordKey: state.coordKey,
    input: state.input,
    fuel: state.fuel,
    output: state.output,
    burnRemainingMs: state.burnRemainingMs,
    cookProgressMs: state.cookProgressMs,
    lastMaterializedAtMs: state.lastMaterializedAtMs,
  });
}

export function validateFurnaceCoordinate(rawCoordKey: string): FurnaceCoordinateValidation {
  if (typeof rawCoordKey !== "string") return { ok: false, reason: "invalid_coordinate" };
  const match = /^(-?\d{1,7}):(-?\d{1,3}):(-?\d{1,7})$/.exec(rawCoordKey.trim());
  if (!match) return { ok: false, reason: "invalid_coordinate" };
  const x = Number(match[1]);
  const y = Number(match[2]);
  const z = Number(match[3]);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(z)
    || x < FURNACE_MIN_XZ || x > FURNACE_MAX_XZ
    || y < FURNACE_MIN_Y || y > FURNACE_MAX_Y
    || z < FURNACE_MIN_XZ || z > FURNACE_MAX_XZ) return { ok: false, reason: "invalid_coordinate" };
  return { ok: true, coordKey: `${x}:${y}:${z}`, x, y, z };
}

export function createEmptyFurnace(rawCoordKey: string, trustedNowMs: number): FurnaceCreateResult {
  const coordinate = validateFurnaceCoordinate(rawCoordKey);
  if (!coordinate.ok) return { ok: false, reason: "invalid_coordinate" };
  if (!isTrustedTime(trustedNowMs)) return { ok: false, reason: "invalid_time" };
  return {
    ok: true,
    state: {
      coordKey: coordinate.coordKey,
      input: null,
      fuel: null,
      output: null,
      burnRemainingMs: 0,
      cookProgressMs: 0,
      lastMaterializedAtMs: trustedNowMs,
    },
  };
}

export function validateFurnaceState(value: unknown, expectedCoordKey?: string): FurnaceValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "invalid_shape" };
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== FURNACE_STATE_KEYS.length || !FURNACE_STATE_KEYS.every((key) => own(record, key))
    || keys.some((key) => !(FURNACE_STATE_KEYS as readonly string[]).includes(key))) {
    return { ok: false, reason: "invalid_shape" };
  }
  if (typeof record.coordKey !== "string") return { ok: false, reason: "invalid_coordinate" };
  const coordinate = validateFurnaceCoordinate(record.coordKey);
  if (!coordinate.ok) return coordinate;
  if (expectedCoordKey !== undefined) {
    const expected = validateFurnaceCoordinate(expectedCoordKey);
    if (!expected.ok || expected.coordKey !== coordinate.coordKey) return { ok: false, reason: "coordinate_mismatch" };
  }
  const input = validPlainStack(record.input, INPUT_IDS);
  const fuel = validPlainStack(record.fuel, new Set<ItemId>(["coal"]));
  const output = validPlainStack(record.output, OUTPUT_IDS);
  if (input === undefined || fuel === undefined || output === undefined) return { ok: false, reason: "invalid_slot" };
  if (!Number.isInteger(record.burnRemainingMs) || (record.burnRemainingMs as number) < 0
    || (record.burnRemainingMs as number) > FURNACE_COAL_BURN_MS
    || !Number.isInteger(record.cookProgressMs) || (record.cookProgressMs as number) < 0
    || (record.cookProgressMs as number) >= FURNACE_COOK_MS
    || !isTrustedTime(record.lastMaterializedAtMs)
    || (input === null && record.cookProgressMs !== 0)) return { ok: false, reason: "invalid_timing" };
  const state: FurnaceState = {
    coordKey: coordinate.coordKey,
    input,
    fuel,
    output,
    burnRemainingMs: record.burnRemainingMs as number,
    cookProgressMs: record.cookProgressMs as number,
    lastMaterializedAtMs: record.lastMaterializedAtMs as number,
  };
  const furnaceJson = canonicalJson(state);
  return furnaceJson.length <= MAX_FURNACE_JSON_LENGTH
    ? { ok: true, state, furnaceJson }
    : { ok: false, reason: "too_large" };
}

export function validateFurnaceJson(rawFurnaceJson: string, expectedCoordKey?: string): FurnaceValidation {
  if (typeof rawFurnaceJson !== "string" || rawFurnaceJson.length > MAX_FURNACE_JSON_LENGTH) {
    return { ok: false, reason: "too_large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawFurnaceJson);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  return validateFurnaceState(parsed, expectedCoordKey);
}

export function serializeFurnaceState(state: FurnaceState): FurnaceSerializationResult {
  const validation = validateFurnaceState(state);
  return validation.ok ? validation : validation;
}

function canAcceptOutput(output: ItemStack | null, recipe: SmeltingRecipe): boolean {
  return output === null || (output.itemId === recipe.output && output.count < ITEMS[recipe.output].maxStack);
}

function decrementStack(stack: ItemStack, count: number): ItemStack | null {
  return stack.count === count ? null : { ...stack, count: stack.count - count };
}

/**
 * Replays only cook/fuel event boundaries from the last persisted timestamp.
 * There are no interval writes: a query or mutation can materialize arbitrary
 * offline time in one bounded pass (slots cap the pass to at most 128 events).
 */
export function materializeFurnace(state: FurnaceState, trustedNowMs: number): FurnaceMaterializationResult {
  const validation = validateFurnaceState(state);
  if (!validation.ok) return { ok: false, reason: "invalid_furnace", detail: validation.reason };
  if (!isTrustedTime(trustedNowMs) || trustedNowMs < validation.state.lastMaterializedAtMs) {
    return { ok: false, reason: "invalid_time" };
  }
  const next = cloneFurnace(validation.state);
  let remaining = trustedNowMs - next.lastMaterializedAtMs;
  let cooked = 0;
  let fuelConsumed = 0;

  // Slots cap useful work at 64 cooks plus bounded fuel transitions. A fixed
  // loop is accepted by Lakebed's anonymous compiler and prevents adversarial
  // persisted state from creating unbounded server work.
  for (let event = 0; event < 260 && remaining > 0; event += 1) {
    const recipe = recipeForInput(next.input);
    const canCook = recipe !== null && canAcceptOutput(next.output, recipe);
    if (next.burnRemainingMs <= 0) {
      if (!canCook || !next.fuel) break;
      next.fuel = decrementStack(next.fuel, 1);
      next.burnRemainingMs = FURNACE_COAL_BURN_MS;
      fuelConsumed += 1;
    }

    if (!canCook || !recipe || !next.input) {
      const elapsed = Math.min(remaining, next.burnRemainingMs);
      next.burnRemainingMs -= elapsed;
      remaining -= elapsed;
      if (elapsed === 0 || next.burnRemainingMs === 0) break;
      continue;
    }

    const elapsed = Math.min(remaining, next.burnRemainingMs, FURNACE_COOK_MS - next.cookProgressMs);
    next.burnRemainingMs -= elapsed;
    next.cookProgressMs += elapsed;
    remaining -= elapsed;
    if (next.cookProgressMs !== FURNACE_COOK_MS) {
      if (elapsed === 0) break;
      continue;
    }

    next.input = decrementStack(next.input, 1);
    next.output = next.output
      ? { ...next.output, count: next.output.count + 1 }
      : { itemId: recipe.output, count: 1 };
    next.cookProgressMs = 0;
    cooked += 1;
  }

  if (!next.input) next.cookProgressMs = 0;
  next.lastMaterializedAtMs = trustedNowMs;
  return { ok: true, state: next, cooked, fuelConsumed };
}

function conservationKey(stack: ItemStack): string {
  return `${stack.itemId}:${stack.durability ?? ""}`;
}

function combinedTotals(inventory: readonly (ItemStack | null)[], state: FurnaceState): Map<string, number> {
  const totals = new Map<string, number>();
  for (const stack of [...inventory, state.input, state.fuel, state.output]) {
    if (!stack) continue;
    const key = conservationKey(stack);
    totals.set(key, (totals.get(key) ?? 0) + stack.count);
  }
  return totals;
}

function totalsEqual(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, count] of left) if (right.get(key) !== count) return false;
  return true;
}

function transferFailure(reason: FurnaceTransferFailure, state: FurnaceState, inventory: readonly (ItemStack | null)[]): FurnaceTransferResult {
  return { ok: false, reason, state: cloneFurnace(state), inventory: cloneInventory(inventory) };
}

/** Materializes at trusted server time, then applies an exact all-or-nothing slot transfer. */
export function applyFurnaceTransfer(
  state: FurnaceState,
  inventory: readonly (ItemStack | null)[],
  action: FurnaceTransferAction,
  trustedNowMs: number,
): FurnaceTransferResult {
  const stateValidation = validateFurnaceState(state);
  if (!stateValidation.ok) return transferFailure("invalid_furnace", state, inventory);
  if (!validInventory(inventory)) return transferFailure("invalid_inventory", stateValidation.state, inventory);
  if (!action || !Number.isInteger(action.count) || action.count < 1 || action.count > 64) {
    return transferFailure("invalid_action", stateValidation.state, inventory);
  }
  const materialized = materializeFurnace(stateValidation.state, trustedNowMs);
  if (!materialized.ok) return transferFailure(
    materialized.reason === "invalid_time" ? "invalid_time" : "invalid_furnace",
    stateValidation.state,
    inventory,
  );
  const furnace = cloneFurnace(materialized.state);
  const player = cloneInventory(inventory);
  const before = combinedTotals(player, furnace);
  let moved: ItemStack;

  if (action.kind === "deposit_input" || action.kind === "deposit_fuel") {
    if (!Number.isInteger(action.inventorySlot) || action.inventorySlot < 0 || action.inventorySlot >= player.length) {
      return transferFailure("invalid_action", furnace, player);
    }
    const source = player[action.inventorySlot];
    if (!source || source.count < action.count) return transferFailure("empty_source", furnace, player);
    const inputDeposit = action.kind === "deposit_input";
    if ((inputDeposit && !INPUT_IDS.has(source.itemId)) || (!inputDeposit && source.itemId !== "coal")) {
      return transferFailure("wrong_item", furnace, player);
    }
    const target = inputDeposit ? furnace.input : furnace.fuel;
    if (target && target.itemId !== source.itemId) return transferFailure("incompatible_stack", furnace, player);
    if ((target?.count ?? 0) + action.count > ITEMS[source.itemId].maxStack) {
      return transferFailure("no_capacity", furnace, player);
    }
    moved = { ...source, count: action.count };
    player[action.inventorySlot] = decrementStack(source, action.count);
    const deposited = target ? { ...target, count: target.count + action.count } : moved;
    if (inputDeposit) furnace.input = deposited;
    else furnace.fuel = deposited;
  } else if (action.kind === "take_input" || action.kind === "take_fuel" || action.kind === "take_output") {
    const slot = action.kind === "take_input" ? furnace.input
      : action.kind === "take_fuel" ? furnace.fuel
      : furnace.output;
    if (!slot || slot.count < action.count) return transferFailure("empty_source", furnace, player);
    moved = { ...slot, count: action.count };
    const added = addItemStack(player, moved, action.count);
    if (added.remainder !== 0) return transferFailure("no_capacity", furnace, player);
    player.splice(0, player.length, ...added.inventory);
    const remainder = decrementStack(slot, action.count);
    if (action.kind === "take_input") {
      furnace.input = remainder;
      if (!remainder) furnace.cookProgressMs = 0;
    } else if (action.kind === "take_fuel") furnace.fuel = remainder;
    else furnace.output = remainder;
  } else {
    return transferFailure("invalid_action", furnace, player);
  }

  if (!totalsEqual(before, combinedTotals(player, furnace))) {
    return transferFailure("conservation_failure", materialized.state, inventory);
  }
  return {
    ok: true,
    state: furnace,
    inventory: player,
    moved: { itemId: moved.itemId, count: moved.count },
    cooked: materialized.cooked,
    fuelConsumed: materialized.fuelConsumed,
  };
}
