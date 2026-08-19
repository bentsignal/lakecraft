import {
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  ITEMS,
  addItem,
  applyConfirmedDurableItemUse,
  applyConfirmedToolUse,
  cloneInventory,
  exchangeSelectedItem,
  getDeterministicMiningDrop,
  maxItemDurability,
  type BlockId,
  type Inventory,
  type ItemId,
  type ItemQuantity,
  type ItemStack,
  type DurableItemUseResult,
} from "./game.ts";
import {
  WORLD_CHUNK_BLOCK_TYPES,
  WORLD_EDIT_MAX_XZ,
  WORLD_EDIT_MAX_Y,
  WORLD_EDIT_MIN_XZ,
  WORLD_EDIT_MIN_Y,
  type WorldChunkBlockType,
} from "./worldChunks.ts";
import * as BS from "./bundleStrings.ts";

export const MIN_WORLD_BLOCK_OPERATION_ID_LENGTH = 16;
export const MAX_WORLD_BLOCK_OPERATION_ID_LENGTH = 64;
export const MAX_WORLD_BLOCK_OPERATION_REQUEST_BYTES = 2_048;
export const MAX_WORLD_BLOCK_REVISION = Number.MAX_SAFE_INTEGER;

type OperationBase = {
  operationId: string;
  x: number;
  y: number;
  z: number;
};

type InventoryOperationBase = OperationBase & {
  selectedHotbar: number;
  expectedHeldItem: ItemId | null;
  expectedInventoryRevision: string;
  expectedChunkRevision: string;
};

export type MineWorldBlockOperation = InventoryOperationBase & {
  kind: "mine";
  expectedBlock: Exclude<WorldChunkBlockType, "air">;
};

export type PlaceWorldBlockOperation = InventoryOperationBase & {
  kind: "place";
  expectedBlock: WorldChunkBlockType;
  placedBlock: Exclude<WorldChunkBlockType, "air">;
};

export function isReplaceableWorldBlock(block: WorldChunkBlockType): boolean {
  return block === "air" || block === "water" || block === "lava"
    || block.startsWith("water_flow_") || block.startsWith("lava_flow_");
}

export type ToggleableWorldBlock = Extract<WorldChunkBlockType,
  "door_closed" | "door_open" | "oak_fence_gate_closed" | "oak_fence_gate_open" | `${string}_door_${string}`>;

export type ToggleWorldBlockOperation = OperationBase & {
  kind: "toggle";
  expectedBlock: ToggleableWorldBlock;
  expectedChunkRevision: string;
};

export type WorldBlockOperationRequest =
  | MineWorldBlockOperation
  | PlaceWorldBlockOperation
  | ToggleWorldBlockOperation;

export type WorldBlockOperationParseReason =
  | "invalid_request"
  | "request_too_large"
  | "invalid_operation_id"
  | "invalid_kind"
  | "invalid_coordinate"
  | "invalid_revision"
  | "invalid_block"
  | "invalid_hotbar_slot"
  | "invalid_held_item";

export type WorldBlockOperationParseResult =
  | { ok: true; request: WorldBlockOperationRequest; fingerprint: string }
  | { ok: false; reason: WorldBlockOperationParseReason };

export type WorldBlockOperationState = {
  currentBlock: WorldChunkBlockType;
  inventory: readonly (ItemStack | null)[];
  inventoryRevision: string;
  chunkRevision: string;
};

export type WorldBlockOperationResolutionOptions = Readonly<{
  /** Lakebed single-player credits directly; Railway multiplayer persists a ground drop. */
  miningDropDestination?: "inventory" | "world";
}>;

export type WorldBlockOperationFailureReason =
  | "invalid_request"
  | "invalid_state"
  | "stale_inventory_revision"
  | "stale_chunk_revision"
  | "block_mismatch"
  | "held_item_mismatch"
  | "not_placeable"
  | "placed_block_mismatch"
  | "inventory_full"
  | "revision_overflow";

type ResolvedOperationBase = {
  previousBlock: WorldChunkBlockType;
  nextBlock: WorldChunkBlockType;
  inventory: Inventory;
  inventoryRevision: string;
  chunkRevision: string;
  inventoryChanged: boolean;
};

export type ResolvedMineWorldBlockOperation = ResolvedOperationBase & {
  kind: "mine";
  nextBlock: "air";
  drop: ItemQuantity | null;
  consumed: null;
  toolUse: DurableItemUseResult;
};

export type ResolvedPlaceWorldBlockOperation = ResolvedOperationBase & {
  kind: "place";
  drop: null;
  consumed: ItemId;
  toolUse: null;
};

export type ResolvedToggleWorldBlockOperation = ResolvedOperationBase & {
  kind: "toggle";
  previousBlock: ToggleableWorldBlock;
  nextBlock: ToggleableWorldBlock;
  drop: null;
  consumed: null;
  toolUse: null;
};

export type ResolvedWorldBlockOperation =
  | ResolvedMineWorldBlockOperation
  | ResolvedPlaceWorldBlockOperation
  | ResolvedToggleWorldBlockOperation;

export type WorldBlockOperationResolution =
  | { ok: true; effect: ResolvedWorldBlockOperation }
  | { ok: false; reason: WorldBlockOperationFailureReason };

const WORLD_BLOCK_SET = new Set<string>(WORLD_CHUNK_BLOCK_TYPES);
const ITEM_SET = new Set<string>(Object.keys(ITEMS));
const TOGGLED_WORLD_BLOCKS: Readonly<Partial<Record<ToggleableWorldBlock, ToggleableWorldBlock>>> = {
  door_closed: BS.doorOpen,
  door_open: BS.doorClosed,
  oak_fence_gate_closed: BS.oakFenceGateOpen,
  oak_fence_gate_open: BS.oakFenceGateClosed,
};
const REVISION_PATTERN = /^(0|[1-9]\d{0,15})$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const COMMON_KEYS = [BS.operationId, "kind", "x", "y", "z"] as const;
const INVENTORY_KEYS = [
  ...COMMON_KEYS,
  "expectedBlock",
  BS.selectedHotbar,
  "expectedHeldItem",
  "expectedInventoryRevision",
  "expectedChunkRevision",
] as const;
const MINE_KEYS = INVENTORY_KEYS;
const PLACE_KEYS = [...INVENTORY_KEYS, "placedBlock"] as const;
const TOGGLE_KEYS = [...COMMON_KEYS, "expectedBlock", "expectedChunkRevision"] as const;

export function parseWorldBlockRevision(value: unknown): number | null {
  if (!BS.isString(value) || !REVISION_PATTERN.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

export function normalizeWorldBlockRevision(value: unknown): string | null {
  const revision = parseWorldBlockRevision(value);
  return revision === null ? null : String(revision);
}

export function nextWorldBlockRevision(value: string): string | null {
  const revision = parseWorldBlockRevision(value);
  return revision === null || revision >= MAX_WORLD_BLOCK_REVISION ? null : String(revision + 1);
}

export function isValidWorldBlockOperationId(value: unknown): value is string {
  return BS.isString(value)
    && value.length >= MIN_WORLD_BLOCK_OPERATION_ID_LENGTH
    && value.length <= MAX_WORLD_BLOCK_OPERATION_ID_LENGTH
    && OPERATION_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function isCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isWorldBlock(value: unknown): value is WorldChunkBlockType {
  return BS.isString(value) && WORLD_BLOCK_SET.has(value);
}

export function isToggleableWorldBlock(value: unknown): value is ToggleableWorldBlock {
  return BS.isString(value) && (Object.prototype.hasOwnProperty.call(TOGGLED_WORLD_BLOCKS, value)
    || WORLD_BLOCK_SET.has(value) && /_door_(?:closed|open)_(?:east|north|south|west)$/.test(value));
}

export function toggledWorldBlock(block: ToggleableWorldBlock): ToggleableWorldBlock {
  const fixed = TOGGLED_WORLD_BLOCKS[block];
  if (fixed) return fixed;
  return (block.includes("_door_closed_")
    ? block.replace("_door_closed_", "_door_open_")
    : block.replace("_door_open_", "_door_closed_")) as ToggleableWorldBlock;
}

function isItemId(value: unknown): value is ItemId {
  return BS.isString(value) && ITEM_SET.has(value);
}

function isCanonicalInventory(value: unknown): value is readonly (ItemStack | null)[] {
  if (!Array.isArray(value) || value.length !== INVENTORY_SIZE) return false;
  return value.every((stack) => {
    if (stack === null) return true;
    if (!isRecord(stack) || !isItemId(stack.itemId)) return false;
    const definition = ITEMS[stack.itemId];
    if (typeof stack.count !== "number" || !Number.isInteger(stack.count)
      || stack.count < 1 || stack.count > definition.maxStack) return false;
    const keys = Object.keys(stack);
    const maximum = maxItemDurability(stack.itemId);
    if (maximum === null) return stack.durability === undefined && hasExactKeys(stack, ["itemId", "count"]);
    return stack.count === 1
      && typeof stack.durability === "number"
      && Number.isInteger(stack.durability)
      && stack.durability >= 1
      && stack.durability <= maximum
      && keys.length === 3
      && hasExactKeys(stack, ["itemId", "count", BS.durability]);
  });
}

function requestByteLength(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return null;
  }
}

export function worldBlockOperationFingerprint(request: WorldBlockOperationRequest): string {
  if (request.kind === "toggle") {
    return JSON.stringify([1, request.operationId, request.kind, request.x, request.y, request.z,
      request.expectedBlock, request.expectedChunkRevision]);
  }
  return JSON.stringify([1, request.operationId, request.kind, request.x, request.y, request.z,
    request.expectedBlock, request.selectedHotbar, request.expectedHeldItem,
    request.expectedInventoryRevision, request.expectedChunkRevision,
    request.kind === "place" ? request.placedBlock : null]);
}

export type WorldBlockOperationBounds = Readonly<{ minXZ:number;maxXZ:number;minY:number;maxY:number }>;
const LAKEBED_WORLD_BLOCK_BOUNDS: WorldBlockOperationBounds = Object.freeze({
  minXZ:WORLD_EDIT_MIN_XZ,maxXZ:WORLD_EDIT_MAX_XZ,minY:WORLD_EDIT_MIN_Y,maxY:WORLD_EDIT_MAX_Y,
});

export function parseWorldBlockOperation(
  value: unknown,
  bounds: WorldBlockOperationBounds = LAKEBED_WORLD_BLOCK_BOUNDS,
): WorldBlockOperationParseResult {
  if (!isRecord(value)) return { ok: false, reason: BS.invalidRequest };
  const byteLength = requestByteLength(value);
  if (byteLength === null) return { ok: false, reason: BS.invalidRequest };
  if (byteLength > MAX_WORLD_BLOCK_OPERATION_REQUEST_BYTES) return { ok: false, reason: "request_too_large" };
  if (!isValidWorldBlockOperationId(value.operationId)) return { ok: false, reason: BS.invalidOperationId };
  if (value.kind !== "mine" && value.kind !== "place" && value.kind !== "toggle") {
    return { ok: false, reason: "invalid_kind" };
  }
  const expectedKeys = value.kind === "mine" ? MINE_KEYS : value.kind === "place" ? PLACE_KEYS : TOGGLE_KEYS;
  if (!hasExactKeys(value, expectedKeys)) return { ok: false, reason: BS.invalidRequest };
  if (!isCoordinate(value.x, bounds.minXZ, bounds.maxXZ)
    || !isCoordinate(value.z, bounds.minXZ, bounds.maxXZ)
    || !isCoordinate(value.y, bounds.minY, bounds.maxY)) {
    return { ok: false, reason: BS.invalidCoordinate };
  }
  if (parseWorldBlockRevision(value.expectedChunkRevision) === null) {
    return { ok: false, reason: "invalid_revision" };
  }

  if (value.kind === "toggle") {
    if (!isToggleableWorldBlock(value.expectedBlock)) {
      return { ok: false, reason: "invalid_block" };
    }
    const request: ToggleWorldBlockOperation = {
      operationId: value.operationId,
      kind: value.kind,
      x: value.x,
      y: value.y,
      z: value.z,
      expectedBlock: value.expectedBlock,
      expectedChunkRevision: value.expectedChunkRevision as string,
    };
    return { ok: true, request, fingerprint: worldBlockOperationFingerprint(request) };
  }

  if (parseWorldBlockRevision(value.expectedInventoryRevision) === null) {
    return { ok: false, reason: "invalid_revision" };
  }
  if (typeof value.selectedHotbar !== "number" || !Number.isInteger(value.selectedHotbar)
    || value.selectedHotbar < 0 || value.selectedHotbar >= HOTBAR_SIZE) {
    return { ok: false, reason: "invalid_hotbar_slot" };
  }
  if (value.expectedHeldItem !== null && !isItemId(value.expectedHeldItem)) {
    return { ok: false, reason: "invalid_held_item" };
  }

  if (value.kind === "mine") {
    if (!isWorldBlock(value.expectedBlock) || value.expectedBlock === "air") {
      return { ok: false, reason: "invalid_block" };
    }
    const request: MineWorldBlockOperation = {
      operationId: value.operationId,
      kind: value.kind,
      x: value.x,
      y: value.y,
      z: value.z,
      expectedBlock: value.expectedBlock,
      selectedHotbar: value.selectedHotbar,
      expectedHeldItem: value.expectedHeldItem as ItemId | null,
      expectedInventoryRevision: value.expectedInventoryRevision as string,
      expectedChunkRevision: value.expectedChunkRevision as string,
    };
    return { ok: true, request, fingerprint: worldBlockOperationFingerprint(request) };
  }

  if (!isWorldBlock(value.expectedBlock) || !isReplaceableWorldBlock(value.expectedBlock)
    || !isWorldBlock(value.placedBlock) || value.placedBlock === "air") {
    return { ok: false, reason: "invalid_block" };
  }
  const request: PlaceWorldBlockOperation = {
    operationId: value.operationId,
    kind: value.kind,
    x: value.x,
    y: value.y,
    z: value.z,
    expectedBlock: value.expectedBlock,
    placedBlock: value.placedBlock,
    selectedHotbar: value.selectedHotbar,
    expectedHeldItem: value.expectedHeldItem as ItemId | null,
    expectedInventoryRevision: value.expectedInventoryRevision as string,
    expectedChunkRevision: value.expectedChunkRevision as string,
  };
  return { ok: true, request, fingerprint: worldBlockOperationFingerprint(request) };
}

export function gameBlockForWorldBlock(block: WorldChunkBlockType): BlockId | null {
  if (block === "air") return null;
  if (block === "wood") return "log";
  if (block.startsWith("wall_torch_")) return "torch";
  const stairs = block.indexOf("_stairs_");
  if (stairs >= 0) return `${block.slice(0, stairs)}_stairs` as BlockId;
  const door = block.indexOf("_door_");
  if (door >= 0) return (block.slice(0, door) === "oak" ? "door" : `${block.slice(0, door)}_door`) as BlockId;
  if (block === BS.doorClosed || block === BS.doorOpen) return "door";
  if (block === BS.oakFenceGateClosed || block === BS.oakFenceGateOpen) return BS.oakFenceGate;
  return block;
}

function isPlacedVariant(item: ItemId, block: WorldChunkBlockType): boolean {
  if (item === "torch") return block.startsWith("wall_torch_");
  return item.endsWith("_stairs") && block.startsWith(`${item}_`)
    || item.endsWith("_door") && block.startsWith(`${item.slice(0, -5)}_door_closed_`)
    || item === "door" && (block === BS.doorClosed || block.startsWith("oak_door_closed_"));
}

export function placedWorldBlockForItem(itemId: ItemId): Exclude<WorldChunkBlockType, "air"> | null {
  const block = ITEMS[itemId].placesBlock;
  if (!block) return null;
  if (block === "log") return "wood";
  if (block === "door") return BS.doorClosed;
  if (block === BS.oakFenceGate) return BS.oakFenceGateClosed;
  return block;
}

function inventoriesEqual(
  left: readonly (ItemStack | null)[],
  right: readonly (ItemStack | null)[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((stack, index) => {
    const other = right[index];
    return stack === null
      ? other === null
      : other !== null
        && stack.itemId === other.itemId
        && stack.count === other.count
        && stack.durability === other.durability;
  });
}

function resolveInventoryRevision(
  current: string,
  changed: boolean,
): string | null {
  return changed ? nextWorldBlockRevision(current) : normalizeWorldBlockRevision(current);
}

export function resolveWorldBlockOperation(
  request: WorldBlockOperationRequest,
  state: WorldBlockOperationState,
  bounds: WorldBlockOperationBounds = LAKEBED_WORLD_BLOCK_BOUNDS,
  options: WorldBlockOperationResolutionOptions = {},
): WorldBlockOperationResolution {
  const parsed = parseWorldBlockOperation(request, bounds);
  if (!parsed.ok) return { ok: false, reason: BS.invalidRequest };
  request = parsed.request;
  if (!isWorldBlock(state.currentBlock)
    || !isCanonicalInventory(state.inventory)
    || normalizeWorldBlockRevision(state.inventoryRevision) === null
    || normalizeWorldBlockRevision(state.chunkRevision) === null) {
    return { ok: false, reason: BS.invalidState };
  }
  if (request.expectedChunkRevision !== state.chunkRevision) {
    return { ok: false, reason: "stale_chunk_revision" };
  }
  if (request.expectedBlock !== state.currentBlock) {
    return { ok: false, reason: "block_mismatch" };
  }
  const chunkRevision = nextWorldBlockRevision(state.chunkRevision);
  if (chunkRevision === null) return { ok: false, reason: "revision_overflow" };

  if (request.kind === "toggle") {
    const nextBlock = toggledWorldBlock(request.expectedBlock);
    return {
      ok: true,
      effect: {
        kind: "toggle",
        previousBlock: request.expectedBlock,
        nextBlock,
        inventory: cloneInventory(state.inventory),
        inventoryRevision: state.inventoryRevision,
        chunkRevision,
        inventoryChanged: false,
        drop: null,
        consumed: null,
        toolUse: null,
      },
    };
  }

  if (request.expectedInventoryRevision !== state.inventoryRevision) {
    return { ok: false, reason: "stale_inventory_revision" };
  }
  const selected = state.inventory[request.selectedHotbar] ?? null;
  const selectedItemId = selected?.itemId ?? null;
  if (selectedItemId !== request.expectedHeldItem) {
    return { ok: false, reason: "held_item_mismatch" };
  }

  if (request.kind === "place") {
    if (!selected || !request.expectedHeldItem) return { ok: false, reason: "not_placeable" };
    const placedBlock = placedWorldBlockForItem(request.expectedHeldItem);
    if (!placedBlock) return { ok: false, reason: "not_placeable" };
    if (placedBlock !== request.placedBlock && !isPlacedVariant(request.expectedHeldItem, request.placedBlock)) {
      return { ok: false, reason: "placed_block_mismatch" };
    }
    if (request.expectedHeldItem === "water_bucket" || request.expectedHeldItem === "lava_bucket") {
      const fluid = request.expectedHeldItem === "water_bucket" ? "water" : "lava";
      if (request.placedBlock !== fluid) return { ok: false, reason: "placed_block_mismatch" };
      const exchanged = exchangeSelectedItem(state.inventory, request.selectedHotbar, request.expectedHeldItem, "bucket");
      if (!exchanged.ok) return { ok: false, reason: "inventory_full" };
      const inventoryRevision = nextWorldBlockRevision(state.inventoryRevision);
      if (inventoryRevision === null) return { ok: false, reason: "revision_overflow" };
      return { ok: true, effect: { kind: "place", previousBlock: request.expectedBlock, nextBlock: fluid,
        inventory: exchanged.inventory, inventoryRevision, chunkRevision, inventoryChanged: true,
        drop: null, consumed: request.expectedHeldItem, toolUse: null } };
    }
    const inventory = cloneInventory(state.inventory);
    const placedStack = inventory[request.selectedHotbar];
    if (!placedStack) return { ok: false, reason: "held_item_mismatch" };
    if (placedStack.count <= 1) inventory[request.selectedHotbar] = null;
    else placedStack.count -= 1;
    const inventoryRevision = nextWorldBlockRevision(state.inventoryRevision);
    if (inventoryRevision === null) return { ok: false, reason: "revision_overflow" };
    return {
      ok: true,
      effect: {
        kind: "place",
        previousBlock: request.expectedBlock,
        nextBlock: request.placedBlock,
        inventory,
        inventoryRevision,
        chunkRevision,
        inventoryChanged: true,
        drop: null,
        consumed: request.expectedHeldItem,
        toolUse: null,
      },
    };
  }

  if (request.expectedHeldItem === "bucket" && (request.expectedBlock === "water" || request.expectedBlock === "lava")) {
    const filled = request.expectedBlock === "water" ? "water_bucket" : "lava_bucket";
    const exchanged = exchangeSelectedItem(state.inventory, request.selectedHotbar, "bucket", filled);
    if (!exchanged.ok) return { ok: false, reason: "inventory_full" };
    const inventoryRevision = nextWorldBlockRevision(state.inventoryRevision);
    if (inventoryRevision === null) return { ok: false, reason: "revision_overflow" };
    return { ok: true, effect: { kind: "mine", previousBlock: request.expectedBlock, nextBlock: "air",
      inventory: exchanged.inventory, inventoryRevision, chunkRevision, inventoryChanged: true,
      drop: null, consumed: null, toolUse: null } };
  }
  const gameBlock = gameBlockForWorldBlock(request.expectedBlock);
  if (!gameBlock) return { ok: false, reason: BS.invalidState };
  // Shears are a durable utility, not an axe-shaped tool. Spend their one
  // durability only inside this confirmed mining resolution; every rejected
  // operation returns before the immutable result can be persisted.
  const toolUse = request.expectedHeldItem === "shears" && gameBlock === "leaves"
    ? applyConfirmedDurableItemUse(
      state.inventory,
      request.selectedHotbar,
      request.expectedHeldItem,
    )
    : applyConfirmedToolUse(
      state.inventory,
      request.selectedHotbar,
      "mine",
      request.expectedHeldItem,
    );
  const drop = getDeterministicMiningDrop(gameBlock, request.expectedHeldItem, request.x, request.y, request.z);
  const added = drop && options.miningDropDestination !== "world"
    ? addItem(toolUse.inventory, drop.itemId, drop.count)
    : { inventory: toolUse.inventory, remainder: 0 };
  if (added.remainder > 0) return { ok: false, reason: "inventory_full" };
  const inventoryChanged = !inventoriesEqual(state.inventory, added.inventory);
  const inventoryRevision = resolveInventoryRevision(state.inventoryRevision, inventoryChanged);
  if (inventoryRevision === null) return { ok: false, reason: "revision_overflow" };
  return {
    ok: true,
    effect: {
      kind: "mine",
      previousBlock: request.expectedBlock,
      nextBlock: "air",
      inventory: added.inventory,
      inventoryRevision,
      chunkRevision,
      inventoryChanged,
      drop,
      consumed: null,
      toolUse,
    },
  };
}
