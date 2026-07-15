import { ITEMS, type ItemId, type ItemStack } from "./game.ts";

export const CHEST_SLOT_COUNT = 27;
export const MAX_CHEST_JSON_LENGTH = 8_192;
export const MAX_CHEST_TOKEN_LENGTH = 128;

export type ChestInventory = Array<ItemStack | null>;
export type ChestCoordinateValidation =
  | { ok: true; coordKey: string; x: number; y: number; z: number }
  | { ok: false; reason: "invalid_coordinate" };
export type ChestInventoryIssue = "too_large" | "invalid_json" | "invalid_shape" | "too_many_slots" | "invalid_slot";
export type ChestInventoryValidation =
  | { ok: true; inventory: ChestInventory; inventoryJson: string }
  | { ok: false; reason: ChestInventoryIssue };
export type ChestWriteDecision = "create" | "update" | "conflict";
export type PersistedChest = {
  id: string;
  coordKey: string;
  inventoryJson: string;
  lastActorId: string;
  createdAt: string;
  updatedAt: string;
};
export type ChestAtResult = { ok: true; chest: PersistedChest | null } | { ok: false; reason: "invalid_coordinate" };
export type SaveChestResult =
  | { ok: true; chest: PersistedChest }
  | { ok: false; reason: "authentication_required" | "invalid_coordinate" | "invalid_token" }
  | { ok: false; reason: "invalid_inventory"; detail: ChestInventoryIssue }
  | { ok: false; reason: "conflict"; chest: PersistedChest | null };

export function validateChestCoordinate(rawCoordKey: string): ChestCoordinateValidation {
  const parts = rawCoordKey.trim().split(":");
  if (parts.length !== 3 || parts.some((part) => !/^-?\d{1,3}$/.test(part))) {
    return { ok: false, reason: "invalid_coordinate" };
  }
  const [x, y, z] = parts.map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)
    || x < -64 || x > 64 || y < -4 || y > 64 || z < -64 || z > 64) {
    return { ok: false, reason: "invalid_coordinate" };
  }
  return { ok: true, coordKey: `${x}:${y}:${z}`, x, y, z };
}

function isItemId(value: unknown): value is ItemId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ITEMS, value);
}

export function validateChestInventoryJson(rawInventoryJson: string): ChestInventoryValidation {
  if (rawInventoryJson.length > MAX_CHEST_JSON_LENGTH) return { ok: false, reason: "too_large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInventoryJson);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "invalid_shape" };
  if (parsed.length > CHEST_SLOT_COUNT) return { ok: false, reason: "too_many_slots" };

  const inventory: ChestInventory = new Array(CHEST_SLOT_COUNT).fill(null);
  for (let index = 0; index < parsed.length; index += 1) {
    const slot = parsed[index] as unknown;
    if (slot === null) continue;
    if (typeof slot !== "object" || Array.isArray(slot)) return { ok: false, reason: "invalid_slot" };
    const record = slot as Record<string, unknown>;
    const keys = Object.keys(record);
    if (!keys.every((key) => key === "itemId" || key === "count" || key === "durability")
      || !keys.includes("itemId") || !keys.includes("count")
      || !isItemId(record.itemId) || typeof record.count !== "number"
      || !Number.isInteger(record.count) || record.count < 1
      || record.count > ITEMS[record.itemId].maxStack) {
      return { ok: false, reason: "invalid_slot" };
    }
    const tool = ITEMS[record.itemId].tool;
    if (!tool) {
      if (record.durability !== undefined) return { ok: false, reason: "invalid_slot" };
      inventory[index] = { itemId: record.itemId, count: record.count };
      continue;
    }
    const durability = record.durability === undefined ? tool.maxDurability : record.durability;
    if (record.count !== 1 || typeof durability !== "number" || !Number.isInteger(durability)
      || durability < 1 || durability > tool.maxDurability) return { ok: false, reason: "invalid_slot" };
    inventory[index] = { itemId: record.itemId, count: 1, durability };
  }
  const inventoryJson = JSON.stringify(inventory);
  return inventoryJson.length <= MAX_CHEST_JSON_LENGTH
    ? { ok: true, inventory, inventoryJson }
    : { ok: false, reason: "too_large" };
}

export function normalizeChestToken(rawToken: string): string | null {
  const token = rawToken.trim();
  return token.length <= MAX_CHEST_TOKEN_LENGTH ? token : null;
}

/** Empty expected token creates; an exact row token updates; every other state conflicts. */
export function decideChestWrite(existingUpdatedAt: string | null, expectedUpdatedAt: string): ChestWriteDecision {
  if (existingUpdatedAt === null) return expectedUpdatedAt === "" ? "create" : "conflict";
  return existingUpdatedAt === expectedUpdatedAt ? "update" : "conflict";
}
