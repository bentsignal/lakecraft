import {
  INVENTORY_SIZE,
  ITEMS,
  maxItemDurability,
  type Inventory,
  type ItemId,
  type ItemStack,
} from "./game.ts";
import { normalizeChestToken } from "./chests.ts";
import {
  validatePlayerStateJson,
  type CanonicalPlayerState,
} from "./chestTransfers.ts";
import * as BS from "./bundleStrings.ts";

export const DROPPED_ITEM_TTL_MS = 5 * 60 * 1_000;
export const DROPPED_ITEM_OWNER_PICKUP_DELAY_MS = 500;
export const DROPPED_ITEM_PICKUP_RADIUS = 2;
export const DROPPED_ITEM_CHUNK_SIZE = 16;
export const MAX_DROPPED_ITEM_REQUEST_LENGTH = 8_191;
export const MAX_DROPPED_ITEM_JSON_LENGTH = 512;
export const MIN_DROPPED_ITEM_OPERATION_ID_LENGTH = 16;
export const MAX_DROPPED_ITEM_OPERATION_ID_LENGTH = 64;
export const MAX_DROPPED_ITEMS_PER_OWNER = 64;
export const MAX_VISIBLE_DROPPED_ITEM_CHUNKS = 49;
export const MAX_VISIBLE_DROPPED_ITEMS = 256;
export const MAX_VISIBLE_DROPPED_ITEMS_PER_CHUNK = 32;

const MIN_WORLD_XZ = -1_000_000;
const MAX_WORLD_XZ = 1_000_000;
const MIN_WORLD_Y = -64;
const MAX_WORLD_Y = 512;
const DROP_ID_PATTERN = /^di_[a-z0-9]{14}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type DroppedItemPosition = { x: number; y: number; z: number };
export type VisibleDroppedItemChunkKeysValidation =
  | { ok: true; chunkKeys: string[] }
  | { ok: false; reason: "invalid_chunk_keys" | "too_many_chunks" };

export type PersistedDroppedItem = {
  id?: string;
  dropId: string;
  chunkKey: string;
  ownerUserId: string;
  sourceUserId: string;
  itemJson: string;
  x: string;
  y: string;
  z: string;
  droppedAt: string;
  ownerPickupAt: string;
  expiresAt: string;
  createdAt?: string;
  updatedAt?: string;
};

/** Client/renderer-safe dropped item. All numeric strings have already been bounded. */
export type NormalizedDroppedItem = {
  dropId: string;
  chunkKey: string;
  ownerUserId: string;
  sourceUserId: string;
  item: ItemStack;
  x: number;
  y: number;
  z: number;
  droppedAt: number;
  ownerPickupAt: number;
  expiresAt: number;
};

export type DropItemRequest = {
  operationId: string;
  sourceSlot: number;
  count: number;
  expectedInventoryUpdatedAt: string;
  playerStateJson: string;
};

export type PickupDroppedItemRequest = {
  operationId: string;
  dropId: string;
  expectedInventoryUpdatedAt: string;
  playerStateJson: string;
};

export type ValidatedDropItemRequest = DropItemRequest & {
  playerState: CanonicalPlayerState;
  canonicalPlayerStateJson: string;
  fingerprint: string;
};

export type ValidatedPickupDroppedItemRequest = PickupDroppedItemRequest & {
  playerState: CanonicalPlayerState;
  canonicalPlayerStateJson: string;
  fingerprint: string;
};

export type DroppedItemRequestIssue =
  | "too_large"
  | "invalid_json"
  | "invalid_shape"
  | "invalid_operation_id"
  | "invalid_source_slot"
  | "invalid_count"
  | "invalid_drop_id"
  | "invalid_token"
  | "invalid_player_state";

export type DropItemRequestValidation =
  | { ok: true; request: ValidatedDropItemRequest }
  | { ok: false; reason: DroppedItemRequestIssue };

export type PickupDroppedItemRequestValidation =
  | { ok: true; request: ValidatedPickupDroppedItemRequest }
  | { ok: false; reason: DroppedItemRequestIssue };

export type DropInventoryApplyResult =
  | { ok: true; inventory: Inventory; dropped: ItemStack }
  | { ok: false; reason: "empty_source" | "conservation_failure" };

export type PickupInventoryApplyResult =
  | { ok: true; inventory: Inventory; picked: ItemStack; remaining: ItemStack | null }
  | { ok: false; reason: "expired" | "owner_pickup_delay" | "too_far" | "no_capacity" | "conservation_failure" };

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], required = allowed): boolean {
  const keys = Object.keys(record);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => keys.includes(key));
}

function isItemId(value: unknown): value is ItemId {
  return BS.isString(value) && Object.prototype.hasOwnProperty.call(ITEMS, value);
}

function stackDurability(stack: ItemStack): number | undefined {
  const durability = (stack as ItemStack & { durability?: unknown }).durability;
  return typeof durability === "number" ? durability : undefined;
}

function exactStack(itemId: ItemId, count: number, durability?: number): ItemStack {
  return (durability === undefined ? { itemId, count } : { itemId, count, durability }) as ItemStack;
}

function cloneStack(stack: ItemStack, count = stack.count): ItemStack {
  return exactStack(stack.itemId, count, stackDurability(stack));
}

function cloneExactInventory(inventory: readonly (ItemStack | null)[]): Inventory {
  return inventory.map((stack) => stack ? cloneStack(stack) : null);
}

/** Strict server-bound validation; unknown fields and non-durable metadata are rejected. */
export function validateDroppedItemStack(value: unknown): ItemStack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, ["itemId", "count", BS.durability], ["itemId", "count"])) return null;
  if (!isItemId(record.itemId) || typeof record.count !== "number" || !Number.isInteger(record.count)
    || record.count < 1 || record.count > ITEMS[record.itemId].maxStack) return null;
  const limit = maxItemDurability(record.itemId);
  if (limit === null) {
    if (record.durability !== undefined) return null;
    return exactStack(record.itemId, record.count);
  }
  if (record.count !== 1) return null;
  // Old saved tools and armor did not always carry durability; canonicalize
  // omitted legacy values as unused.
  const durability = record.durability === undefined ? limit : record.durability;
  if (typeof durability !== "number" || !Number.isInteger(durability) || durability < 1 || durability > limit) return null;
  return exactStack(record.itemId, 1, durability);
}

export function validateDroppedItemStackJson(rawItemJson: string): { ok: true; item: ItemStack; itemJson: string } | { ok: false } {
  if (rawItemJson.length > MAX_DROPPED_ITEM_JSON_LENGTH) return { ok: false };
  try {
    const item = validateDroppedItemStack(JSON.parse(rawItemJson) as unknown);
    return item ? { ok: true, item, itemJson: JSON.stringify(item) } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function validateDroppedItemPosition(value: unknown): DroppedItemPosition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { x, y, z } = value as Partial<Record<keyof DroppedItemPosition, unknown>>;
  if (typeof x !== "number" || !Number.isFinite(x) || x < MIN_WORLD_XZ || x > MAX_WORLD_XZ
    || typeof y !== "number" || !Number.isFinite(y) || y < MIN_WORLD_Y || y > MAX_WORLD_Y
    || typeof z !== "number" || !Number.isFinite(z) || z < MIN_WORLD_XZ || z > MAX_WORLD_XZ) return null;
  return { x, y, z };
}

export function droppedItemChunkKey(x: number, z: number): string | null {
  const position = validateDroppedItemPosition({ x, y: 0, z });
  return position ? `${Math.floor(position.x / DROPPED_ITEM_CHUNK_SIZE)}:${Math.floor(position.z / DROPPED_ITEM_CHUNK_SIZE)}` : null;
}

export function validateVisibleDroppedItemChunkKeys(value: unknown): VisibleDroppedItemChunkKeysValidation {
  if (!Array.isArray(value)) return { ok: false, reason: BS.invalidChunkKeys };
  if (value.length > MAX_VISIBLE_DROPPED_ITEM_CHUNKS) return { ok: false, reason: "too_many_chunks" };
  const minimumChunk = Math.floor(MIN_WORLD_XZ / DROPPED_ITEM_CHUNK_SIZE);
  const maximumChunk = Math.floor(MAX_WORLD_XZ / DROPPED_ITEM_CHUNK_SIZE);
  const chunks = new Set<string>();
  for (const raw of value) {
    if (!BS.isString(raw)) return { ok: false, reason: BS.invalidChunkKeys };
    const match = /^(-?\d{1,5}):(-?\d{1,5})$/.exec(raw.trim());
    if (!match) return { ok: false, reason: BS.invalidChunkKeys };
    const chunkX = Number(match[1]);
    const chunkZ = Number(match[2]);
    if (chunkX < minimumChunk || chunkX > maximumChunk || chunkZ < minimumChunk || chunkZ > maximumChunk) {
      return { ok: false, reason: BS.invalidChunkKeys };
    }
    chunks.add(`${chunkX}:${chunkZ}`);
  }
  return {
    ok: true,
    chunkKeys: [...chunks].sort((left, right) => {
      const [leftX, leftZ] = left.split(":").map(Number);
      const [rightX, rightZ] = right.split(":").map(Number);
      return leftX - rightX || leftZ - rightZ;
    }),
  };
}

/** Stable compact identifier. The server still rejects an occupied id from a different operation. */
export function createDroppedItemId(userId: string, operationId: string): string {
  const input = `${userId}\u0000${operationId}`;
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `di_${left.toString(36).padStart(7, "0")}${right.toString(36).padStart(7, "0")}`;
}

export function isDroppedItemId(value: unknown): value is string {
  return BS.isString(value) && DROP_ID_PATTERN.test(value);
}

function finiteTimestamp(value: unknown): number | null {
  if (!BS.isString(value) || !/^\d{1,16}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Rejects corrupt/forged database rows and optionally hides expired rows from renderers. */
export function normalizeDroppedItemRow(value: unknown, now = Date.now(), includeExpired = false): NormalizedDroppedItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isDroppedItemId(row.dropId) || !BS.isString(row.ownerUserId) || !row.ownerUserId
    || !BS.isString(row.sourceUserId) || !row.sourceUserId || !BS.isString(row.itemJson)) return null;
  const item = validateDroppedItemStackJson(row.itemJson);
  const numericField = (field: unknown): number => BS.isString(field) && String(Number(field)) === field ? Number(field) : NaN;
  const position = validateDroppedItemPosition({ x: numericField(row.x), y: numericField(row.y), z: numericField(row.z) });
  const droppedAt = finiteTimestamp(row.droppedAt);
  const ownerPickupAt = finiteTimestamp(row.ownerPickupAt);
  const expiresAt = finiteTimestamp(row.expiresAt);
  if (!item.ok || !position || droppedAt === null || ownerPickupAt === null || expiresAt === null
    || ownerPickupAt !== droppedAt + DROPPED_ITEM_OWNER_PICKUP_DELAY_MS
    || expiresAt !== droppedAt + DROPPED_ITEM_TTL_MS
    || (!includeExpired && now >= expiresAt)) return null;
  const chunkKey = droppedItemChunkKey(position.x, position.z);
  if (!chunkKey || row.chunkKey !== chunkKey) return null;
  return {
    dropId: row.dropId,
    chunkKey,
    ownerUserId: row.ownerUserId,
    sourceUserId: row.sourceUserId,
    item: item.item,
    ...position,
    droppedAt,
    ownerPickupAt,
    expiresAt,
  };
}

export function createPersistedDroppedItem(
  userId: string,
  operationId: string,
  item: ItemStack,
  rawPosition: DroppedItemPosition,
  now: number,
): PersistedDroppedItem | null {
  const position = validateDroppedItemPosition(rawPosition);
  const validItem = validateDroppedItemStack(item);
  const chunkKey = position && droppedItemChunkKey(position.x, position.z);
  if (!userId || userId.length > 256 || !validateOperationId(operationId)
    || !validItem || !position || !chunkKey || !Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(now + DROPPED_ITEM_TTL_MS)) return null;
  return {
    dropId: createDroppedItemId(userId, operationId),
    chunkKey,
    ownerUserId: userId,
    sourceUserId: userId,
    itemJson: JSON.stringify(validItem),
    x: String(position.x),
    y: String(position.y),
    z: String(position.z),
    droppedAt: String(now),
    ownerPickupAt: String(now + DROPPED_ITEM_OWNER_PICKUP_DELAY_MS),
    expiresAt: String(now + DROPPED_ITEM_TTL_MS),
  };
}

function validateOperationId(value: unknown): value is string {
  return BS.isString(value)
    && value.length >= MIN_DROPPED_ITEM_OPERATION_ID_LENGTH
    && value.length <= MAX_DROPPED_ITEM_OPERATION_ID_LENGTH
    && OPERATION_ID_PATTERN.test(value);
}

function parseRequest(rawJson: string): Record<string, unknown> | DroppedItemRequestIssue {
  if (rawJson.length > MAX_DROPPED_ITEM_REQUEST_LENGTH) return "too_large";
  try {
    const parsed: unknown = JSON.parse(rawJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : BS.invalidShape;
  } catch {
    return "invalid_json";
  }
}

function canonicalPlayerState(raw: unknown): { state: CanonicalPlayerState; json: string } | null {
  if (!BS.isString(raw)) return null;
  const validated = validatePlayerStateJson(raw);
  return validated.ok ? { state: validated.state, json: validated.playerStateJson } : null;
}

export function droppedItemOperationFingerprint(
  operation: "drop" | "pickup",
  request: DropItemRequest | PickupDroppedItemRequest,
  canonicalPlayerStateJson: string,
): string {
  return operation === "drop"
    ? JSON.stringify([operation, request.operationId, (request as DropItemRequest).sourceSlot,
      (request as DropItemRequest).count, request.expectedInventoryUpdatedAt, canonicalPlayerStateJson])
    : JSON.stringify([operation, request.operationId, (request as PickupDroppedItemRequest).dropId,
      request.expectedInventoryUpdatedAt, canonicalPlayerStateJson]);
}

export function validateDropItemRequestJson(rawJson: string): DropItemRequestValidation {
  const parsed = parseRequest(rawJson);
  if (BS.isString(parsed)) return { ok: false, reason: parsed };
  const keys = [BS.operationId, BS.sourceSlot, "count", BS.expectedInventoryUpdatedAt, BS.playerStateJson] as const;
  if (!hasOnlyKeys(parsed, keys)) return { ok: false, reason: BS.invalidShape };
  if (!validateOperationId(parsed.operationId)) return { ok: false, reason: BS.invalidOperationId };
  if (typeof parsed.sourceSlot !== "number" || !Number.isInteger(parsed.sourceSlot)
    || parsed.sourceSlot < 0 || parsed.sourceSlot >= INVENTORY_SIZE) return { ok: false, reason: "invalid_source_slot" };
  if (typeof parsed.count !== "number" || !Number.isInteger(parsed.count)
    || parsed.count < 1 || parsed.count > 64) return { ok: false, reason: "invalid_count" };
  if (!BS.isString(parsed.expectedInventoryUpdatedAt)) return { ok: false, reason: "invalid_token" };
  const expectedInventoryUpdatedAt = normalizeChestToken(parsed.expectedInventoryUpdatedAt);
  if (expectedInventoryUpdatedAt === null) return { ok: false, reason: "invalid_token" };
  const playerState = canonicalPlayerState(parsed.playerStateJson);
  if (!playerState) return { ok: false, reason: BS.invalidPlayerState };
  const request: DropItemRequest = {
    operationId: parsed.operationId,
    sourceSlot: parsed.sourceSlot,
    count: parsed.count,
    expectedInventoryUpdatedAt,
    playerStateJson: parsed.playerStateJson as string,
  };
  return { ok: true, request: {
    ...request,
    playerState: playerState.state,
    canonicalPlayerStateJson: playerState.json,
    fingerprint: droppedItemOperationFingerprint("drop", request, playerState.json),
  } };
}

export function validatePickupDroppedItemRequestJson(rawJson: string): PickupDroppedItemRequestValidation {
  const parsed = parseRequest(rawJson);
  if (BS.isString(parsed)) return { ok: false, reason: parsed };
  const keys = [BS.operationId, "dropId", BS.expectedInventoryUpdatedAt, BS.playerStateJson] as const;
  if (!hasOnlyKeys(parsed, keys)) return { ok: false, reason: BS.invalidShape };
  if (!validateOperationId(parsed.operationId)) return { ok: false, reason: BS.invalidOperationId };
  if (!isDroppedItemId(parsed.dropId)) return { ok: false, reason: "invalid_drop_id" };
  if (!BS.isString(parsed.expectedInventoryUpdatedAt)) return { ok: false, reason: "invalid_token" };
  const expectedInventoryUpdatedAt = normalizeChestToken(parsed.expectedInventoryUpdatedAt);
  if (expectedInventoryUpdatedAt === null) return { ok: false, reason: "invalid_token" };
  const playerState = canonicalPlayerState(parsed.playerStateJson);
  if (!playerState) return { ok: false, reason: BS.invalidPlayerState };
  const request: PickupDroppedItemRequest = {
    operationId: parsed.operationId,
    dropId: parsed.dropId,
    expectedInventoryUpdatedAt,
    playerStateJson: parsed.playerStateJson as string,
  };
  return { ok: true, request: {
    ...request,
    playerState: playerState.state,
    canonicalPlayerStateJson: playerState.json,
    fingerprint: droppedItemOperationFingerprint("pickup", request, playerState.json),
  } };
}

function stackIdentity(stack: ItemStack): string {
  return `${stack.itemId}:${stackDurability(stack) ?? ""}`;
}

function inventoryTotals(inventory: readonly (ItemStack | null)[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const stack of inventory) if (stack) totals.set(stackIdentity(stack), (totals.get(stackIdentity(stack)) ?? 0) + stack.count);
  return totals;
}

function totalsEqual(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, count] of left) if (right.get(key) !== count) return false;
  return true;
}

export function applyDropItemToInventory(request: Pick<ValidatedDropItemRequest, "sourceSlot" | "count" | "playerState">): DropInventoryApplyResult {
  const inventory = cloneExactInventory(request.playerState.inventory);
  const before = inventoryTotals(request.playerState.inventory);
  const source = inventory[request.sourceSlot];
  if (!source) return { ok: false, reason: BS.emptySource };
  const droppedCount = Math.min(request.count, source.count);
  const dropped = cloneStack(source, droppedCount);
  if (droppedCount === source.count) inventory[request.sourceSlot] = null;
  else inventory[request.sourceSlot] = cloneStack(source, source.count - droppedCount);
  const after = inventoryTotals(inventory);
  after.set(stackIdentity(dropped), (after.get(stackIdentity(dropped)) ?? 0) + dropped.count);
  return totalsEqual(before, after)
    ? { ok: true, inventory, dropped }
    : { ok: false, reason: BS.conservationFailure };
}

function addExactStack(inventory: readonly (ItemStack | null)[], item: ItemStack): { inventory: Inventory; remainder: number } {
  const next = cloneExactInventory(inventory);
  let remainder = item.count;
  const maxStack = ITEMS[item.itemId].maxStack;
  for (const stack of next) {
    if (!stack || remainder <= 0 || stackIdentity(stack) !== stackIdentity(item) || stack.count >= maxStack) continue;
    const added = Math.min(maxStack - stack.count, remainder);
    stack.count += added;
    remainder -= added;
  }
  for (let index = 0; index < next.length && remainder > 0; index += 1) {
    if (next[index]) continue;
    const added = Math.min(maxStack, remainder);
    next[index] = cloneStack(item, added);
    remainder -= added;
  }
  return { inventory: next, remainder };
}

export function applyPickupDroppedItem(
  playerInventory: readonly (ItemStack | null)[],
  dropped: NormalizedDroppedItem,
  actorUserId: string,
  rawPlayerPosition: DroppedItemPosition,
  now: number,
): PickupInventoryApplyResult {
  if (now >= dropped.expiresAt) return { ok: false, reason: "expired" };
  if (actorUserId === dropped.ownerUserId && now < dropped.ownerPickupAt) return { ok: false, reason: "owner_pickup_delay" };
  const position = validateDroppedItemPosition(rawPlayerPosition);
  if (!position) return { ok: false, reason: "too_far" };
  const distanceSquared = (position.x - dropped.x) ** 2 + (position.y - dropped.y) ** 2 + (position.z - dropped.z) ** 2;
  if (distanceSquared > DROPPED_ITEM_PICKUP_RADIUS ** 2) return { ok: false, reason: "too_far" };
  const before = inventoryTotals(playerInventory);
  const added = addExactStack(playerInventory, dropped.item);
  const pickedCount = dropped.item.count - added.remainder;
  if (pickedCount <= 0) return { ok: false, reason: BS.noCapacity };
  const picked = cloneStack(dropped.item, pickedCount);
  const remaining = added.remainder > 0 ? cloneStack(dropped.item, added.remainder) : null;
  const after = inventoryTotals(added.inventory);
  if (remaining) after.set(stackIdentity(remaining), (after.get(stackIdentity(remaining)) ?? 0) + remaining.count);
  const combinedBefore = new Map(before);
  combinedBefore.set(stackIdentity(dropped.item), (combinedBefore.get(stackIdentity(dropped.item)) ?? 0) + dropped.item.count);
  return totalsEqual(combinedBefore, after)
    ? { ok: true, inventory: added.inventory, picked, remaining }
    : { ok: false, reason: BS.conservationFailure };
}
