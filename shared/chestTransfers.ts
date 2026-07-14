import {
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  ITEMS,
  MAX_HUNGER,
  addItem,
  cloneInventory,
  createEmptyEquipment,
  type ArmorSlot,
  type Equipment,
  type Inventory,
  type ItemId,
  type PlayerRespawnPoint,
} from "./game.ts";
import {
  CHEST_SLOT_COUNT,
  type ChestInventory,
  type PersistedChest,
  normalizeChestToken,
  validateChestCoordinate,
} from "./chests.ts";

export const MAX_CHEST_TRANSFER_REQUEST_LENGTH = 8_191;
export const MAX_PLAYER_STATE_JSON_LENGTH = 7_000;
export const MIN_OPERATION_ID_LENGTH = 16;
export const MAX_OPERATION_ID_LENGTH = 64;
export const PLAYER_STATE_VERSION = 2;

export type ChestTransferDirection = "to_chest" | "from_chest";
export type ChestTransferConflict = "inventory" | "chest" | "both";
export type ChestTransferCasDecision = "apply" | "inventory_conflict" | "chest_conflict" | "both_conflict";
export type ChestTransferReplayDecision = "new" | "replay" | "operation_id_reused";

export interface CanonicalPlayerState {
  version: typeof PLAYER_STATE_VERSION;
  inventory: Inventory;
  selectedHotbar: number;
  equipment: Equipment;
  respawnPoint: PlayerRespawnPoint | null;
  hunger: number;
}

export interface ChestTransferRequest {
  operationId: string;
  coordKey: string;
  direction: ChestTransferDirection;
  sourceSlot: number;
  count: number;
  expectedChestUpdatedAt: string;
  expectedInventoryUpdatedAt: string;
  playerStateJson: string;
}

export interface ValidatedChestTransferRequest extends ChestTransferRequest {
  playerState: CanonicalPlayerState;
  canonicalPlayerStateJson: string;
  fingerprint: string;
}

export type PlayerStateValidationIssue =
  | "too_large"
  | "invalid_json"
  | "invalid_shape"
  | "invalid_version"
  | "invalid_inventory"
  | "invalid_selected_hotbar"
  | "invalid_equipment"
  | "invalid_respawn_point"
  | "invalid_hunger";

export type PlayerStateValidation =
  | { ok: true; state: CanonicalPlayerState; playerStateJson: string }
  | { ok: false; reason: PlayerStateValidationIssue };

export type ChestTransferRequestIssue =
  | "too_large"
  | "invalid_json"
  | "invalid_shape"
  | "invalid_operation_id"
  | "invalid_coordinate"
  | "invalid_direction"
  | "invalid_source_slot"
  | "invalid_count"
  | "invalid_token"
  | "invalid_player_state";

export type ChestTransferRequestValidation =
  | { ok: true; request: ValidatedChestTransferRequest }
  | { ok: false; reason: ChestTransferRequestIssue; playerStateIssue?: PlayerStateValidationIssue };

export interface PersistedInventoryState {
  id: string;
  userId: string;
  inventoryJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChestTransferReceiptLike {
  operationId: string;
  fingerprint: string;
}

export type ChestTransferResult =
  | {
      ok: true;
      replayed: boolean;
      moved: { itemId: ItemId; count: number };
      player: PersistedInventoryState;
      chest: PersistedChest;
    }
  | {
      ok: false;
      reason: "conflict";
      conflict: ChestTransferConflict;
      player: PersistedInventoryState | null;
      chest: PersistedChest | null;
    }
  | {
      ok: false;
      reason:
        | "authentication_required"
        | "invalid_request"
        | "operation_id_reused"
        | "chest_required"
        | "empty_source"
        | "no_capacity"
        | "conservation_failure";
      detail?: ChestTransferRequestIssue | PlayerStateValidationIssue;
    };

export type ChestTransferApplyResult =
  | {
      ok: true;
      playerInventory: Inventory;
      chestInventory: ChestInventory;
      moved: { itemId: ItemId; count: number };
    }
  | { ok: false; reason: "empty_source" | "no_capacity" | "conservation_failure" };

const PLAYER_STATE_KEYS = ["version", "inventory", "selectedHotbar", "equipment", "respawnPoint", "hunger"] as const;
const REQUEST_KEYS = [
  "operationId",
  "coordKey",
  "direction",
  "sourceSlot",
  "count",
  "expectedChestUpdatedAt",
  "expectedInventoryUpdatedAt",
  "playerStateJson",
] as const;
const ARMOR_SLOTS: readonly ArmorSlot[] = ["head", "chest", "legs", "feet"];

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): boolean {
  const keys = Object.keys(record);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => keys.includes(key));
}

function strictInventory(value: unknown, size: number): Inventory | null {
  if (!Array.isArray(value) || value.length > size) return null;
  const output: Inventory = new Array(size).fill(null);
  for (let index = 0; index < value.length; index += 1) {
    const slot = value[index] as unknown;
    if (slot === null) continue;
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) return null;
    const record = slot as Record<string, unknown>;
    if (!hasOnlyKeys(record, ["itemId", "count"], ["itemId", "count"])) return null;
    if (typeof record.itemId !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, record.itemId)) return null;
    const itemId = record.itemId as ItemId;
    if (typeof record.count !== "number" || !Number.isInteger(record.count)
      || record.count < 1 || record.count > ITEMS[itemId].maxStack) return null;
    output[index] = { itemId, count: record.count };
  }
  return output;
}

function strictEquipment(value: unknown): Equipment | null {
  if (value === undefined) return createEmptyEquipment();
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, ARMOR_SLOTS, ARMOR_SLOTS)) return null;
  const output = createEmptyEquipment();
  for (const slot of ARMOR_SLOTS) {
    const itemId = record[slot];
    if (itemId === null) continue;
    if (typeof itemId !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, itemId)) return null;
    const item = ITEMS[itemId as ItemId];
    if (!item.armor || item.armor.slot !== slot) return null;
    output[slot] = itemId as NonNullable<Equipment[ArmorSlot]>;
  }
  return output;
}

function strictRespawnPoint(value: unknown): PlayerRespawnPoint | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, ["x", "y", "z", "yaw", "pitch"], ["x", "y", "z", "yaw", "pitch"])) return undefined;
  const { x, y, z, yaw, pitch } = record;
  if (typeof x !== "number" || !Number.isFinite(x) || x < -64 || x > 64
    || typeof y !== "number" || !Number.isFinite(y) || y < -4 || y > 96
    || typeof z !== "number" || !Number.isFinite(z) || z < -64 || z > 64
    || typeof yaw !== "number" || !Number.isFinite(yaw) || yaw < -100_000 || yaw > 100_000
    || typeof pitch !== "number" || !Number.isFinite(pitch) || pitch < -1.52 || pitch > 1.52) return undefined;
  return { x, y, z, yaw, pitch };
}

/** Strictly accepts legacy raw inventories and known player-state envelopes without minting defaults on corruption. */
export function validatePlayerStateJson(rawJson: string): PlayerStateValidation {
  if (rawJson.length > MAX_PLAYER_STATE_JSON_LENGTH) return { ok: false, reason: "too_large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  let inventory: Inventory | null;
  let selectedHotbar = 0;
  let equipment = createEmptyEquipment();
  let respawnPoint: PlayerRespawnPoint | null = null;
  let hunger = MAX_HUNGER;
  if (Array.isArray(parsed)) {
    inventory = strictInventory(parsed, INVENTORY_SIZE);
  } else {
    if (!parsed || typeof parsed !== "object") return { ok: false, reason: "invalid_shape" };
    const record = parsed as Record<string, unknown>;
    if (!hasOnlyKeys(record, PLAYER_STATE_KEYS, ["inventory"])) return { ok: false, reason: "invalid_shape" };
    if (record.version !== undefined && record.version !== 1 && record.version !== PLAYER_STATE_VERSION) {
      return { ok: false, reason: "invalid_version" };
    }
    inventory = strictInventory(record.inventory, INVENTORY_SIZE);
    if (record.selectedHotbar !== undefined) {
      if (typeof record.selectedHotbar !== "number" || !Number.isInteger(record.selectedHotbar)
        || record.selectedHotbar < 0 || record.selectedHotbar >= HOTBAR_SIZE) {
        return { ok: false, reason: "invalid_selected_hotbar" };
      }
      selectedHotbar = record.selectedHotbar;
    }
    const parsedEquipment = strictEquipment(record.equipment);
    if (!parsedEquipment) return { ok: false, reason: "invalid_equipment" };
    equipment = parsedEquipment;
    const parsedRespawnPoint = strictRespawnPoint(record.respawnPoint);
    if (parsedRespawnPoint === undefined) return { ok: false, reason: "invalid_respawn_point" };
    respawnPoint = parsedRespawnPoint;
    if (record.hunger !== undefined) {
      if (typeof record.hunger !== "number" || !Number.isInteger(record.hunger)
        || record.hunger < 0 || record.hunger > MAX_HUNGER) return { ok: false, reason: "invalid_hunger" };
      hunger = record.hunger;
    }
  }
  if (!inventory) return { ok: false, reason: "invalid_inventory" };
  const state: CanonicalPlayerState = {
    version: PLAYER_STATE_VERSION,
    inventory,
    selectedHotbar,
    equipment,
    respawnPoint,
    hunger,
  };
  const playerStateJson = JSON.stringify(state);
  return playerStateJson.length <= MAX_PLAYER_STATE_JSON_LENGTH
    ? { ok: true, state, playerStateJson }
    : { ok: false, reason: "too_large" };
}

export function chestTransferFingerprint(request: ChestTransferRequest, canonicalPlayerStateJson: string): string {
  return JSON.stringify([
    request.operationId,
    request.coordKey,
    request.direction,
    request.sourceSlot,
    request.count,
    request.expectedChestUpdatedAt,
    request.expectedInventoryUpdatedAt,
    canonicalPlayerStateJson,
  ]);
}

export function validateChestTransferRequestJson(rawJson: string): ChestTransferRequestValidation {
  if (rawJson.length > MAX_CHEST_TRANSFER_REQUEST_LENGTH) return { ok: false, reason: "too_large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "invalid_shape" };
  const record = parsed as Record<string, unknown>;
  if (!hasOnlyKeys(record, REQUEST_KEYS, REQUEST_KEYS)) return { ok: false, reason: "invalid_shape" };
  if (typeof record.operationId !== "string"
    || record.operationId.length < MIN_OPERATION_ID_LENGTH
    || record.operationId.length > MAX_OPERATION_ID_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(record.operationId)) return { ok: false, reason: "invalid_operation_id" };
  if (typeof record.coordKey !== "string") return { ok: false, reason: "invalid_coordinate" };
  const coordinate = validateChestCoordinate(record.coordKey);
  if (!coordinate.ok) return { ok: false, reason: "invalid_coordinate" };
  if (record.direction !== "to_chest" && record.direction !== "from_chest") return { ok: false, reason: "invalid_direction" };
  if (typeof record.sourceSlot !== "number" || !Number.isInteger(record.sourceSlot)
    || record.sourceSlot < 0 || record.sourceSlot >= CHEST_SLOT_COUNT) return { ok: false, reason: "invalid_source_slot" };
  if (typeof record.count !== "number" || !Number.isInteger(record.count)
    || record.count < 1 || record.count > 64) return { ok: false, reason: "invalid_count" };
  if (typeof record.expectedChestUpdatedAt !== "string" || typeof record.expectedInventoryUpdatedAt !== "string") {
    return { ok: false, reason: "invalid_token" };
  }
  const expectedChestUpdatedAt = normalizeChestToken(record.expectedChestUpdatedAt);
  const expectedInventoryUpdatedAt = normalizeChestToken(record.expectedInventoryUpdatedAt);
  if (expectedChestUpdatedAt === null || expectedInventoryUpdatedAt === null) return { ok: false, reason: "invalid_token" };
  if (typeof record.playerStateJson !== "string") return { ok: false, reason: "invalid_player_state" };
  const playerState = validatePlayerStateJson(record.playerStateJson);
  if (!playerState.ok) return { ok: false, reason: "invalid_player_state", playerStateIssue: playerState.reason };
  const request: ChestTransferRequest = {
    operationId: record.operationId,
    coordKey: coordinate.coordKey,
    direction: record.direction,
    sourceSlot: record.sourceSlot,
    count: record.count,
    expectedChestUpdatedAt,
    expectedInventoryUpdatedAt,
    playerStateJson: record.playerStateJson,
  };
  return {
    ok: true,
    request: {
      ...request,
      playerState: playerState.state,
      canonicalPlayerStateJson: playerState.playerStateJson,
      fingerprint: chestTransferFingerprint(request, playerState.playerStateJson),
    },
  };
}

function tokenMatches(current: string | null, expected: string): boolean {
  return current === null ? expected === "" : current === expected;
}

export function decideChestTransferCas(
  currentInventoryUpdatedAt: string | null,
  currentChestUpdatedAt: string | null,
  expectedInventoryUpdatedAt: string,
  expectedChestUpdatedAt: string,
): ChestTransferCasDecision {
  const inventoryMatches = tokenMatches(currentInventoryUpdatedAt, expectedInventoryUpdatedAt);
  const chestMatches = tokenMatches(currentChestUpdatedAt, expectedChestUpdatedAt);
  if (inventoryMatches && chestMatches) return "apply";
  if (!inventoryMatches && !chestMatches) return "both_conflict";
  return inventoryMatches ? "chest_conflict" : "inventory_conflict";
}

export function decideChestTransferReplay(
  existingFingerprint: string | null,
  requestFingerprint: string,
): ChestTransferReplayDecision {
  if (existingFingerprint === null) return "new";
  return existingFingerprint === requestFingerprint ? "replay" : "operation_id_reused";
}

function combinedItemTotals(player: readonly (Inventory[number])[], chest: readonly (ChestInventory[number])[]): Map<ItemId, number> {
  const totals = new Map<ItemId, number>();
  for (const stack of [...player, ...chest]) {
    if (stack) totals.set(stack.itemId, (totals.get(stack.itemId) ?? 0) + stack.count);
  }
  return totals;
}

function totalsEqual(left: ReadonlyMap<ItemId, number>, right: ReadonlyMap<ItemId, number>): boolean {
  if (left.size !== right.size) return false;
  for (const [itemId, count] of left) if (right.get(itemId) !== count) return false;
  return true;
}

/** Applies one slot-specific, capacity-bounded move and proves combined item conservation. */
export function applyChestTransfer(
  request: Pick<ChestTransferRequest, "direction" | "sourceSlot" | "count">,
  playerInventory: readonly (Inventory[number])[],
  chestInventory: readonly (ChestInventory[number])[],
): ChestTransferApplyResult {
  const player = cloneInventory(playerInventory);
  const chest = cloneInventory(chestInventory);
  const source = request.direction === "to_chest" ? player : chest;
  const target = request.direction === "to_chest" ? chest : player;
  const sourceStack = source[request.sourceSlot];
  if (!sourceStack) return { ok: false, reason: "empty_source" };
  const requested = Math.min(request.count, sourceStack.count);
  const added = addItem(target, sourceStack.itemId, requested);
  const movedCount = requested - added.remainder;
  if (movedCount <= 0) return { ok: false, reason: "no_capacity" };
  if (movedCount === sourceStack.count) source[request.sourceSlot] = null;
  else source[request.sourceSlot] = { itemId: sourceStack.itemId, count: sourceStack.count - movedCount };
  const nextPlayer = request.direction === "to_chest" ? source : added.inventory;
  const nextChest = request.direction === "to_chest" ? added.inventory : source;
  const before = combinedItemTotals(playerInventory, chestInventory);
  const after = combinedItemTotals(nextPlayer, nextChest);
  if (!totalsEqual(before, after)) return { ok: false, reason: "conservation_failure" };
  return {
    ok: true,
    playerInventory: nextPlayer,
    chestInventory: nextChest,
    moved: { itemId: sourceStack.itemId, count: movedCount },
  };
}
