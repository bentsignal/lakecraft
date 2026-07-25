import {
  MAX_DROPPED_ITEMS_PER_OWNER,
  createPersistedDroppedItem,
  isDroppedItemId,
  normalizeDroppedItemRow,
  validateDroppedItemStack,
  validateDroppedItemPosition,
  type DroppedItemPosition,
  type PersistedDroppedItem,
} from "../shared/droppedItems.ts";
import { validatePlayerStateJson } from "../shared/chestTransfers.ts";
import type { ItemStack } from "../shared/game.ts";
import * as BS from "../shared/bundleStrings.ts";

export const DROPPED_ITEM_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_DROPPED_ITEM_RECEIPTS_PER_USER = 32;
export const DROPPED_ITEM_RECEIPT_PRUNE_LIMIT = 8;
export const DROPPED_ITEM_EXPIRY_PRUNE_LIMIT = 16;
export const DROPPED_ITEM_PRESENCE_FRESH_MS = 10_000;

export type DroppedItemReplayDecision = "new" | "replay" | "operation_id_reused";
export type InventoryCasDecision = "apply" | "conflict";
export type DroppedItemStoredPlayerStateDecision = "match" | "mismatch" | "invalid";

export type DroppedItemReceiptResult = {
  ok: true;
  replayed: boolean;
  operation: "drop" | "pickup";
  dropId: string;
  moved: ItemStack;
  inventory: Record<string, unknown>;
  droppedItem: Record<string, unknown> | null;
};

/** Position is sourced from server-stored presence, never from a client mutation payload. */
export function authoritativeDroppedItemPosition(
  presence: Record<string, unknown> | null,
  userId: string,
  now: number,
): DroppedItemPosition | null {
  if (!presence || presence.userId !== userId || presence.online !== true) return null;
  const heartbeatAt = typeof presence.heartbeatAt === "string" && /^\d{1,16}$/.test(presence.heartbeatAt)
    ? Number(presence.heartbeatAt)
    : NaN;
  if (!Number.isSafeInteger(heartbeatAt) || heartbeatAt > now + 1_000 || now - heartbeatAt > DROPPED_ITEM_PRESENCE_FRESH_MS) return null;
  return validateDroppedItemPosition({ x: Number(presence.x), y: Number(presence.y), z: Number(presence.z) });
}

/** Drops spawn at torso height with a small forward offset supplied from validated server presence. */
export function buildDroppedItemRow(
  userId: string,
  operationId: string,
  item: Parameters<typeof createPersistedDroppedItem>[2],
  position: DroppedItemPosition,
  yaw: number,
  now: number,
): PersistedDroppedItem | null {
  if (!Number.isFinite(yaw) || Math.abs(yaw) > 100_000) return null;
  const spawn = {
    x: position.x - Math.sin(yaw) * 0.8,
    y: position.y + 1.1,
    z: position.z - Math.cos(yaw) * 0.8,
  };
  return createPersistedDroppedItem(userId, operationId, item, spawn, now);
}

export function decideDroppedItemReplay(existingFingerprint: string | null, requestFingerprint: string): DroppedItemReplayDecision {
  if (existingFingerprint === null) return "new";
  return existingFingerprint === requestFingerprint ? "replay" : BS.operationIdReused;
}

export function decideDroppedItemInventoryCas(currentUpdatedAt: string | null, expectedUpdatedAt: string): InventoryCasDecision {
  return (currentUpdatedAt ?? "") === expectedUpdatedAt ? "apply" : "conflict";
}

/** A matching CAS token alone cannot authorize a client-fabricated inventory. */
export function compareDroppedItemStoredPlayerState(
  storedPlayerStateJson: string,
  submittedCanonicalPlayerStateJson: string,
): DroppedItemStoredPlayerStateDecision {
  const stored = validatePlayerStateJson(storedPlayerStateJson);
  if (!stored.ok) return "invalid";
  return stored.playerStateJson === submittedCanonicalPlayerStateJson ? "match" : "mismatch";
}

export function encodeDroppedItemReceipt(result: DroppedItemReceiptResult): string {
  return JSON.stringify(result);
}

export function decodeDroppedItemReceipt(rawResultJson: string): DroppedItemReceiptResult | null {
  try {
    const parsed: unknown = JSON.parse(rawResultJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const result = parsed as Record<string, unknown>;
    if (result.ok !== true || result.replayed !== false || (result.operation !== "drop" && result.operation !== "pickup")
      || !isDroppedItemId(result.dropId) || !validateDroppedItemStack(result.moved)
      || !result.inventory || typeof result.inventory !== "object"
      || Array.isArray(result.inventory) || (result.droppedItem !== null
        && (!result.droppedItem || typeof result.droppedItem !== "object" || Array.isArray(result.droppedItem)))) return null;
    return { ...(result as DroppedItemReceiptResult), replayed: true };
  } catch {
    return null;
  }
}

/** Newest-first bounded pruning while retaining the receipt just committed. */
export function selectDroppedItemReceiptOverflow(
  newestFirstRows: readonly { id: string }[],
  committedReceiptId: string,
): string[] {
  const retained = new Set<string>([committedReceiptId]);
  for (const row of newestFirstRows) {
    if (retained.size >= MAX_DROPPED_ITEM_RECEIPTS_PER_USER) break;
    retained.add(row.id);
  }
  return newestFirstRows
    .filter((row) => !retained.has(row.id))
    .slice(0, DROPPED_ITEM_RECEIPT_PRUNE_LIMIT)
    .map((row) => row.id);
}

export function canCreateDroppedItem(activeOwnedItemCount: number): boolean {
  return Number.isInteger(activeOwnedItemCount) && activeOwnedItemCount >= 0
    && activeOwnedItemCount < MAX_DROPPED_ITEMS_PER_OWNER;
}

/** For a mutation's bounded cleanup pass; rows are already oldest/expiry-first. */
export function selectExpiredDroppedItemIds(
  rows: readonly (Record<string, unknown> & { id: string })[],
  now: number,
): string[] {
  return rows
    .filter((row) => {
      const normalized = normalizeDroppedItemRow(row, now, true);
      return !normalized || normalized.expiresAt <= now;
    })
    .slice(0, DROPPED_ITEM_EXPIRY_PRUNE_LIMIT)
    .map((row) => row.id);
}

export function droppedItemExpiryCutoff(now: number): string {
  return String(now);
}
