import { INVENTORY_SIZE, ITEMS } from "../shared/game.ts";
import {
  validateFurnaceCoordinate,
  type FurnaceTransferAction,
} from "../shared/furnaces.ts";
import * as BS from "../shared/bundleStrings.ts";

export const MAX_FURNACE_TRANSFER_RECEIPTS_PER_USER = 16;
export const FURNACE_RECEIPT_OVERFLOW_PRUNE_LIMIT = 8;
export const FURNACE_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;

const MAX_FURNACE_REQUEST_BYTES = 2_048;
const MAX_FURNACE_RECEIPT_BYTES = 32_768;

export interface FurnaceTransferRequest {
  operationId: string;
  coordKey: string;
  action: FurnaceTransferAction;
  expectedInventoryUpdatedAt: string;
  expectedFurnaceRevision: string;
  expectedBlockInstanceToken: string;
  fingerprint: string;
}

export type FurnaceTransferCasState = {
  inventoryUpdatedAt: string;
  furnaceRevision: string;
  blockInstanceToken: string;
};

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function token(value: unknown): string | null {
  return BS.isString(value) && value.length <= 128 ? value : null;
}

function revision(value: unknown): string | null {
  return BS.isString(value) && /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value))
    ? String(Number(value))
    : null;
}

function blockInstanceToken(value: unknown): string | null {
  return BS.isString(value) && value.length >= 3 && value.length <= 256
    && /^[A-Za-z0-9_:.+-]+$/.test(value)
    ? value
    : null;
}

function transferAction(value: unknown): FurnaceTransferAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "deposit_input" || record.kind === "deposit_fuel") {
    if (!exactKeys(record, ["kind", "inventorySlot", "count"])
      || !Number.isInteger(record.inventorySlot) || Number(record.inventorySlot) < 0
      || Number(record.inventorySlot) >= INVENTORY_SIZE
      || !Number.isInteger(record.count) || Number(record.count) < 1 || Number(record.count) > 64) return null;
    return {
      kind: record.kind,
      inventorySlot: Number(record.inventorySlot),
      count: Number(record.count),
    };
  }
  if (record.kind === "take_input" || record.kind === "take_fuel" || record.kind === "take_output") {
    if (!exactKeys(record, ["kind", "count"])
      || !Number.isInteger(record.count) || Number(record.count) < 1 || Number(record.count) > 64) return null;
    return { kind: record.kind, count: Number(record.count) };
  }
  return null;
}

export function validateFurnaceTransferRequestJson(rawJson: string): FurnaceTransferRequest | null {
  if (!BS.isString(rawJson) || rawJson.length > MAX_FURNACE_REQUEST_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!exactKeys(record, [
    BS.operationId,
    BS.coordKey,
    "action",
    BS.expectedInventoryUpdatedAt,
    "expectedFurnaceRevision",
    "expectedBlockInstanceToken",
  ]) || !BS.isString(record.operationId) || !/^[A-Za-z0-9_-]{16,64}$/.test(record.operationId)) return null;
  const coordinate = BS.isString(record.coordKey) ? validateFurnaceCoordinate(record.coordKey) : null;
  const action = transferAction(record.action);
  const expectedInventoryUpdatedAt = token(record.expectedInventoryUpdatedAt);
  const expectedFurnaceRevision = revision(record.expectedFurnaceRevision);
  const expectedBlockInstanceToken = blockInstanceToken(record.expectedBlockInstanceToken);
  if (!coordinate?.ok || !action || expectedInventoryUpdatedAt === null
    || expectedFurnaceRevision === null || expectedBlockInstanceToken === null) return null;
  const semantic = [1, coordinate.coordKey, expectedBlockInstanceToken, action];
  return {
    operationId: record.operationId,
    coordKey: coordinate.coordKey,
    action,
    expectedInventoryUpdatedAt,
    expectedFurnaceRevision,
    expectedBlockInstanceToken,
    fingerprint: JSON.stringify(semantic),
  };
}

/** All three tokens must still identify the exact player and placed furnace instance. */
export function decideFurnaceTransferCas(
  current: FurnaceTransferCasState,
  expected: FurnaceTransferCasState,
): "apply" | "conflict" {
  return current.inventoryUpdatedAt === expected.inventoryUpdatedAt
    && current.furnaceRevision === expected.furnaceRevision
    && current.blockInstanceToken === expected.blockInstanceToken
    ? "apply"
    : "conflict";
}

export function decideFurnaceReceiptReplay(
  storedFingerprint: string | null,
  requestFingerprint: string,
): "new" | "replay" | "operation_id_reused" {
  if (storedFingerprint === null) return "new";
  return storedFingerprint === requestFingerprint ? "replay" : BS.operationIdReused;
}

export function encodeFurnaceReceipt(result: Record<string, unknown>): string {
  return JSON.stringify(result);
}

export function decodeFurnaceReceipt(rawJson: string): Record<string, unknown> | null {
  if (!BS.isString(rawJson) || rawJson.length > MAX_FURNACE_RECEIPT_BYTES) return null;
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (!parsed || parsed.ok !== true || parsed.replayed !== false
      || !parsed.moved || typeof parsed.moved !== "object" || Array.isArray(parsed.moved)) return null;
    const moved = parsed.moved as Record<string, unknown>;
    if ((moved.direction !== "to_furnace" && moved.direction !== "to_player")
      || !BS.isString(moved.itemId) || !(moved.itemId in ITEMS)
      || !Number.isInteger(moved.count) || Number(moved.count) < 1 || Number(moved.count) > 64) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function selectFurnaceReceiptOverflow(
  newestRows: readonly { id: string }[],
  committedReceiptId: string,
): string[] {
  const kept = new Set<string>([committedReceiptId]);
  for (const row of newestRows) {
    if (kept.size >= MAX_FURNACE_TRANSFER_RECEIPTS_PER_USER) break;
    kept.add(row.id);
  }
  return newestRows
    .filter((row) => !kept.has(row.id))
    .slice(0, FURNACE_RECEIPT_OVERFLOW_PRUNE_LIMIT)
    .map((row) => row.id);
}
