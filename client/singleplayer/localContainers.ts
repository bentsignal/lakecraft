import {
  CHEST_SLOT_COUNT,
  validateChestInventoryJson,
  type ChestInventory,
} from "../../shared/chests.ts";
import { applyChestTransfer, type ChestTransferDirection } from "../../shared/chestTransfers.ts";
import {
  FURNACE_MAX_XZ,
  FURNACE_MAX_Y,
  FURNACE_MIN_XZ,
  FURNACE_MIN_Y,
  applyFurnaceTransfer,
  createEmptyFurnace,
  materializeFurnace,
  validateFurnaceCoordinate,
  validateFurnaceState,
  type FurnaceState,
  type FurnaceTransferAction,
} from "../../shared/furnaces.ts";
import {
  INVENTORY_SIZE,
  ITEMS,
  addItemStack,
  cloneInventory,
  createEmptyInventory,
  maxItemDurability,
  type Inventory,
  type ItemStack,
} from "../../shared/game.ts";

/**
 * Container count, rather than world extent, bounds browser storage. Five
 * hundred and twelve of each container still covers a large survival world
 * while remaining comfortably below the single-player save slot budget.
 */
export const MAX_LOCAL_CHESTS = 512;
export const MAX_LOCAL_FURNACES = 512;
export const LOCAL_CONTAINER_MIN_XZ = FURNACE_MIN_XZ;
export const LOCAL_CONTAINER_MAX_XZ = FURNACE_MAX_XZ;
export const LOCAL_CONTAINER_MIN_Y = FURNACE_MIN_Y;
export const LOCAL_CONTAINER_MAX_Y = FURNACE_MAX_Y;

export interface LocalContainers {
  readonly chests: ReadonlyMap<string, ChestInventory>;
  readonly furnaces: ReadonlyMap<string, FurnaceState>;
}

export interface LocalChestSnapshot {
  coordKey: string;
  inventory: ChestInventory;
}

export interface LocalContainersSnapshot {
  chests: LocalChestSnapshot[];
  furnaces: FurnaceState[];
}

export type LocalContainerIssue =
  | "invalid_coordinate"
  | "invalid_inventory"
  | "invalid_state"
  | "invalid_time"
  | "invalid_action"
  | "empty_source"
  | "wrong_item"
  | "incompatible_stack"
  | "no_capacity"
  | "conservation_failure"
  | "chest_limit"
  | "furnace_limit";

export type LocalChestFullStackAction = {
  direction: ChestTransferDirection;
  sourceSlot: number;
};

export type LocalFurnaceFullStackAction =
  | { kind: "deposit_input" | "deposit_fuel"; inventorySlot: number }
  | { kind: "take_input" | "take_fuel" | "take_output" };

export type LocalContainersImportResult =
  | { ok: true; containers: LocalContainers; snapshot: LocalContainersSnapshot }
  | { ok: false; reason: LocalContainerIssue; path: string };

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function canonicalCoordinate(rawCoordKey: string): string | null {
  const coordinate = validateFurnaceCoordinate(rawCoordKey);
  return coordinate.ok ? coordinate.coordKey : null;
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

function strictPlayerInventory(value: readonly (ItemStack | null)[]): Inventory | null {
  if (!Array.isArray(value) || value.length !== INVENTORY_SIZE) return null;
  const inventory: Inventory = [];
  for (const candidate of value) {
    if (candidate === null) {
      inventory.push(null);
      continue;
    }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || typeof candidate.itemId !== "string" || !own(ITEMS, candidate.itemId)
      || !Number.isInteger(candidate.count) || candidate.count < 1
      || candidate.count > ITEMS[candidate.itemId].maxStack) return null;
    const maximum = maxItemDurability(candidate.itemId);
    if (maximum === null) {
      if (candidate.durability !== undefined) return null;
      inventory.push({ itemId: candidate.itemId, count: candidate.count });
      continue;
    }
    if (candidate.count !== 1 || !Number.isInteger(candidate.durability)
      || (candidate.durability ?? 0) < 1 || (candidate.durability ?? 0) > maximum) return null;
    inventory.push({ itemId: candidate.itemId, count: 1, durability: candidate.durability });
  }
  return inventory;
}

function canonicalChest(value: unknown): ChestInventory | null {
  if (!Array.isArray(value) || value.length !== CHEST_SLOT_COUNT) return null;
  const validation = validateChestInventoryJson(JSON.stringify(value));
  return validation.ok ? validation.inventory : null;
}

function withChest(containers: LocalContainers, coordKey: string, inventory: ChestInventory): LocalContainers {
  const chests = new Map(containers.chests);
  chests.set(coordKey, cloneInventory(inventory));
  return { chests, furnaces: containers.furnaces };
}

function withFurnace(containers: LocalContainers, coordKey: string, state: FurnaceState): LocalContainers {
  const furnaces = new Map(containers.furnaces);
  furnaces.set(coordKey, cloneFurnace(state));
  return { chests: containers.chests, furnaces };
}

export function createLocalContainers(): LocalContainers {
  return { chests: new Map(), furnaces: new Map() };
}

/** Opens an existing chest or atomically creates its canonical 27 empty slots. */
export function openLocalChest(
  containers: LocalContainers,
  rawCoordKey: string,
): { ok: true; containers: LocalContainers; inventory: ChestInventory; created: boolean }
  | { ok: false; reason: LocalContainerIssue; containers: LocalContainers } {
  const coordKey = canonicalCoordinate(rawCoordKey);
  if (!coordKey) return { ok: false, reason: "invalid_coordinate", containers };
  const existing = containers.chests.get(coordKey);
  if (existing) {
    const inventory = canonicalChest(existing);
    return inventory
      ? { ok: true, containers, inventory: cloneInventory(inventory), created: false }
      : { ok: false, reason: "invalid_state", containers };
  }
  if (containers.chests.size >= MAX_LOCAL_CHESTS) return { ok: false, reason: "chest_limit", containers };
  const inventory = createEmptyInventory(CHEST_SLOT_COUNT);
  return { ok: true, containers: withChest(containers, coordKey, inventory), inventory, created: true };
}

/** Moves exactly one complete source stack; capacity failures never partially move it. */
export function transferLocalChestFullStack(
  containers: LocalContainers,
  rawCoordKey: string,
  playerInventory: readonly (ItemStack | null)[],
  action: LocalChestFullStackAction,
): { ok: true; containers: LocalContainers; inventory: Inventory; moved: ItemStack }
  | { ok: false; reason: LocalContainerIssue; containers: LocalContainers; inventory: Inventory } {
  const player = strictPlayerInventory(playerInventory);
  if (!player) return { ok: false, reason: "invalid_inventory", containers, inventory: cloneInventory(playerInventory) };
  const opened = openLocalChest(containers, rawCoordKey);
  if (!opened.ok) return { ok: false, reason: opened.reason, containers, inventory: player };
  if (!action || !Number.isInteger(action.sourceSlot)) {
    return { ok: false, reason: "invalid_action", containers: opened.containers, inventory: player };
  }
  const source = action.direction === "to_chest" ? player : opened.inventory;
  if (action.direction !== "to_chest" && action.direction !== "from_chest") {
    return { ok: false, reason: "invalid_action", containers: opened.containers, inventory: player };
  }
  if (action.sourceSlot < 0 || action.sourceSlot >= source.length) {
    return { ok: false, reason: "invalid_action", containers: opened.containers, inventory: player };
  }
  const sourceStack = source[action.sourceSlot];
  if (!sourceStack) return { ok: false, reason: "empty_source", containers: opened.containers, inventory: player };
  const transfer = applyChestTransfer(
    { direction: action.direction, sourceSlot: action.sourceSlot, count: sourceStack.count },
    player,
    opened.inventory,
  );
  if (!transfer.ok || transfer.moved.count !== sourceStack.count) {
    return {
      ok: false,
      reason: transfer.ok ? "no_capacity" : transfer.reason,
      containers: opened.containers,
      inventory: player,
    };
  }
  const next = withChest(opened.containers, canonicalCoordinate(rawCoordKey)!, transfer.chestInventory);
  return {
    ok: true,
    containers: next,
    inventory: transfer.playerInventory,
    moved: { ...sourceStack },
  };
}

/** Opens and materializes an existing furnace, or creates one at the caller's trusted local clock. */
export function openLocalFurnace(
  containers: LocalContainers,
  rawCoordKey: string,
  trustedNowMs: number,
): { ok: true; containers: LocalContainers; furnace: FurnaceState; created: boolean; cooked: number; fuelConsumed: number }
  | { ok: false; reason: LocalContainerIssue; containers: LocalContainers } {
  const coordKey = canonicalCoordinate(rawCoordKey);
  if (!coordKey) return { ok: false, reason: "invalid_coordinate", containers };
  const existing = containers.furnaces.get(coordKey);
  if (existing) {
    if (existing.coordKey !== coordKey) return { ok: false, reason: "invalid_state", containers };
    const materialized = materializeFurnace(existing, trustedNowMs);
    if (!materialized.ok) {
      return {
        ok: false,
        reason: materialized.reason === "invalid_time" ? "invalid_time" : "invalid_state",
        containers,
      };
    }
    return {
      ok: true,
      containers: withFurnace(containers, coordKey, materialized.state),
      furnace: materialized.state,
      created: false,
      cooked: materialized.cooked,
      fuelConsumed: materialized.fuelConsumed,
    };
  }
  if (containers.furnaces.size >= MAX_LOCAL_FURNACES) return { ok: false, reason: "furnace_limit", containers };
  const created = createEmptyFurnace(coordKey, trustedNowMs);
  if (!created.ok) return { ok: false, reason: created.reason, containers };
  return {
    ok: true,
    containers: withFurnace(containers, coordKey, created.state),
    furnace: created.state,
    created: true,
    cooked: 0,
    fuelConsumed: 0,
  };
}

export const materializeLocalFurnace = openLocalFurnace;

/** Materializes elapsed cook time and then moves exactly one complete source stack. */
export function transferLocalFurnaceFullStack(
  containers: LocalContainers,
  rawCoordKey: string,
  playerInventory: readonly (ItemStack | null)[],
  action: LocalFurnaceFullStackAction,
  trustedNowMs: number,
): { ok: true; containers: LocalContainers; inventory: Inventory; furnace: FurnaceState; moved: ItemStack; cooked: number; fuelConsumed: number }
  | { ok: false; reason: LocalContainerIssue; containers: LocalContainers; inventory: Inventory } {
  const player = strictPlayerInventory(playerInventory);
  if (!player) return { ok: false, reason: "invalid_inventory", containers, inventory: cloneInventory(playerInventory) };
  const advanced = materializeLocalFurnace(containers, rawCoordKey, trustedNowMs);
  if (!advanced.ok) return { ok: false, reason: advanced.reason, containers: advanced.containers, inventory: player };
  if (!action || typeof action.kind !== "string") {
    return { ok: false, reason: "invalid_action", containers: advanced.containers, inventory: player };
  }
  let transferAction: FurnaceTransferAction;
  let source: ItemStack | null | undefined;
  if (action.kind === "deposit_input" || action.kind === "deposit_fuel") {
    if (!Number.isInteger(action.inventorySlot) || action.inventorySlot < 0 || action.inventorySlot >= player.length) {
      return { ok: false, reason: "invalid_action", containers: advanced.containers, inventory: player };
    }
    source = player[action.inventorySlot];
    if (!source) return { ok: false, reason: "empty_source", containers: advanced.containers, inventory: player };
    transferAction = { kind: action.kind, inventorySlot: action.inventorySlot, count: source.count };
  } else if (action.kind === "take_input" || action.kind === "take_fuel" || action.kind === "take_output") {
    source = action.kind === "take_input" ? advanced.furnace.input
      : action.kind === "take_fuel" ? advanced.furnace.fuel
      : advanced.furnace.output;
    if (!source) return { ok: false, reason: "empty_source", containers: advanced.containers, inventory: player };
    transferAction = { kind: action.kind, count: source.count };
  } else {
    return { ok: false, reason: "invalid_action", containers: advanced.containers, inventory: player };
  }
  const transferred = applyFurnaceTransfer(advanced.furnace, player, transferAction, trustedNowMs);
  if (!transferred.ok) {
    return { ok: false, reason: transferred.reason, containers: advanced.containers, inventory: transferred.inventory };
  }
  const next = withFurnace(advanced.containers, transferred.state.coordKey, transferred.state);
  return {
    ok: true,
    containers: next,
    inventory: transferred.inventory,
    furnace: transferred.state,
    moved: { ...source },
    cooked: advanced.cooked + transferred.cooked,
    fuelConsumed: advanced.fuelConsumed + transferred.fuelConsumed,
  };
}

export function removeLocalChest(
  containers: LocalContainers,
  rawCoordKey: string,
): { ok: true; containers: LocalContainers; removed: boolean } | { ok: false; reason: "invalid_coordinate"; containers: LocalContainers } {
  const coordKey = canonicalCoordinate(rawCoordKey);
  if (!coordKey) return { ok: false, reason: "invalid_coordinate", containers };
  if (!containers.chests.has(coordKey)) return { ok: true, containers, removed: false };
  const chests = new Map(containers.chests);
  chests.delete(coordKey);
  return { ok: true, containers: { chests, furnaces: containers.furnaces }, removed: true };
}

export function removeLocalFurnace(
  containers: LocalContainers,
  rawCoordKey: string,
): { ok: true; containers: LocalContainers; removed: boolean } | { ok: false; reason: "invalid_coordinate"; containers: LocalContainers } {
  const coordKey = canonicalCoordinate(rawCoordKey);
  if (!coordKey) return { ok: false, reason: "invalid_coordinate", containers };
  if (!containers.furnaces.has(coordKey)) return { ok: true, containers, removed: false };
  const furnaces = new Map(containers.furnaces);
  furnaces.delete(coordKey);
  return { ok: true, containers: { chests: containers.chests, furnaces }, removed: true };
}

/** Clears either container kind when its backing block is mined or replaced. */
export function removeLocalContainersAt(
  containers: LocalContainers,
  rawCoordKey: string,
): { ok: true; containers: LocalContainers; removedChest: boolean; removedFurnace: boolean }
  | { ok: false; reason: "invalid_coordinate"; containers: LocalContainers } {
  const coordKey = canonicalCoordinate(rawCoordKey);
  if (!coordKey) return { ok: false, reason: "invalid_coordinate", containers };
  const chests = new Map(containers.chests);
  const furnaces = new Map(containers.furnaces);
  const removedChest = chests.delete(coordKey);
  const removedFurnace = furnaces.delete(coordKey);
  return { ok: true, containers: { chests, furnaces }, removedChest, removedFurnace };
}

/**
 * Recovers every stored stack before a local chest/furnace block disappears.
 * The operation is all-or-nothing when the caller cannot represent every
 * overflow stack as a world drop, so a full world never silently erases items.
 */
export function recoverLocalContainerContents(
  containers: LocalContainers,
  rawCoordKey: string,
  playerInventory: readonly (ItemStack | null)[],
  maximumOverflowStacks: number,
  trustedNowMs: number,
): { ok: true; containers: LocalContainers; inventory: Inventory; overflow: ItemStack[]; recovered: ItemStack[] }
  | { ok: false; reason: LocalContainerIssue; containers: LocalContainers; inventory: Inventory } {
  const coordKey = canonicalCoordinate(rawCoordKey);
  const player = strictPlayerInventory(playerInventory);
  if (!coordKey) return { ok: false, reason: "invalid_coordinate", containers, inventory: player ?? cloneInventory(playerInventory) };
  if (!player) return { ok: false, reason: "invalid_inventory", containers, inventory: cloneInventory(playerInventory) };
  let working = containers;
  if (containers.furnaces.has(coordKey)) {
    const materialized = materializeLocalFurnace(containers, coordKey, trustedNowMs);
    if (!materialized.ok) return { ...materialized, inventory: player };
    working = materialized.containers;
  }
  const chest = working.chests.get(coordKey);
  const furnace = working.furnaces.get(coordKey);
  const recovered = [
    ...(chest ? chest.filter((stack): stack is ItemStack => stack !== null) : []),
    ...[furnace?.input, furnace?.fuel, furnace?.output].filter((stack): stack is ItemStack => Boolean(stack)),
  ].map((stack) => ({ ...stack }));
  let inventory = player;
  const overflow: ItemStack[] = [];
  for (const stack of recovered) {
    const added = addItemStack(inventory, stack);
    inventory = added.inventory;
    if (added.remainder > 0) overflow.push({ ...stack, count: added.remainder });
  }
  if (!Number.isSafeInteger(maximumOverflowStacks) || maximumOverflowStacks < 0 || overflow.length > maximumOverflowStacks) {
    return { ok: false, reason: "no_capacity", containers, inventory: player };
  }
  const removed = removeLocalContainersAt(working, coordKey);
  return removed.ok
    ? { ok: true, containers: removed.containers, inventory, overflow, recovered }
    : { ok: false, reason: "invalid_coordinate", containers, inventory: player };
}

/** Validates, optionally materializes, clones and sorts every row without truncating. */
export function exportLocalContainersSnapshot(
  containers: LocalContainers,
  trustedNowMs?: number,
): LocalContainersImportResult {
  if (containers.chests.size > MAX_LOCAL_CHESTS) return { ok: false, reason: "chest_limit", path: "$.chests" };
  if (containers.furnaces.size > MAX_LOCAL_FURNACES) return { ok: false, reason: "furnace_limit", path: "$.furnaces" };
  const chests: LocalChestSnapshot[] = [];
  for (const [key, value] of containers.chests) {
    const coordKey = canonicalCoordinate(key);
    const inventory = canonicalChest(value);
    if (!coordKey || coordKey !== key) return { ok: false, reason: "invalid_coordinate", path: `$.chests[${JSON.stringify(key)}]` };
    if (!inventory) return { ok: false, reason: "invalid_state", path: `$.chests[${JSON.stringify(key)}].inventory` };
    chests.push({ coordKey, inventory });
  }
  const furnaces: FurnaceState[] = [];
  for (const [key, value] of containers.furnaces) {
    const validation = validateFurnaceState(value, key);
    if (!validation.ok) {
      return { ok: false, reason: "invalid_state", path: `$.furnaces[${JSON.stringify(key)}]` };
    }
    let state = validation.state;
    if (trustedNowMs !== undefined) {
      const materialized = materializeFurnace(state, trustedNowMs);
      if (!materialized.ok) {
        return { ok: false, reason: "invalid_time", path: `$.furnaces[${JSON.stringify(key)}]` };
      }
      state = materialized.state;
    }
    furnaces.push(cloneFurnace(state));
  }
  chests.sort((left, right) => left.coordKey.localeCompare(right.coordKey));
  furnaces.sort((left, right) => left.coordKey.localeCompare(right.coordKey));
  const snapshot = { chests, furnaces };
  return {
    ok: true,
    containers: {
      chests: new Map(chests.map(({ coordKey, inventory }) => [coordKey, cloneInventory(inventory)])),
      furnaces: new Map(furnaces.map((state) => [state.coordKey, cloneFurnace(state)])),
    },
    snapshot,
  };
}

/** Strict canonical snapshot import. Duplicate, extra, invalid or excessive rows fail closed. */
export function importLocalContainersSnapshot(value: unknown): LocalContainersImportResult {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value as Record<string, unknown>, ["chests", "furnaces"])) {
    return { ok: false, reason: "invalid_state", path: "$" };
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.chests)) return { ok: false, reason: "invalid_state", path: "$.chests" };
  if (!Array.isArray(record.furnaces)) return { ok: false, reason: "invalid_state", path: "$.furnaces" };
  if (record.chests.length > MAX_LOCAL_CHESTS) return { ok: false, reason: "chest_limit", path: "$.chests" };
  if (record.furnaces.length > MAX_LOCAL_FURNACES) return { ok: false, reason: "furnace_limit", path: "$.furnaces" };
  const chests = new Map<string, ChestInventory>();
  for (let index = 0; index < record.chests.length; index += 1) {
    const candidate = record.chests[index];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || !exactKeys(candidate as Record<string, unknown>, ["coordKey", "inventory"])) {
      return { ok: false, reason: "invalid_state", path: `$.chests[${index}]` };
    }
    const row = candidate as Record<string, unknown>;
    if (typeof row.coordKey !== "string") return { ok: false, reason: "invalid_coordinate", path: `$.chests[${index}].coordKey` };
    const coordKey = canonicalCoordinate(row.coordKey);
    if (!coordKey || coordKey !== row.coordKey || chests.has(coordKey)) {
      return { ok: false, reason: "invalid_coordinate", path: `$.chests[${index}].coordKey` };
    }
    const inventory = canonicalChest(row.inventory);
    if (!inventory) return { ok: false, reason: "invalid_state", path: `$.chests[${index}].inventory` };
    chests.set(coordKey, inventory);
  }
  const furnaces = new Map<string, FurnaceState>();
  for (let index = 0; index < record.furnaces.length; index += 1) {
    const validation = validateFurnaceState(record.furnaces[index]);
    if (!validation.ok || furnaces.has(validation.state.coordKey)) {
      return { ok: false, reason: "invalid_state", path: `$.furnaces[${index}]` };
    }
    furnaces.set(validation.state.coordKey, cloneFurnace(validation.state));
  }
  return exportLocalContainersSnapshot({ chests, furnaces });
}
