import type { BlockType } from "./protocol.ts";

export const TNT_FUSE_MS = 4_000;
export const TNT_MAX_ACTIVE_FUSES = 32;
/** Every eligible claimer also subscribes to the fuse's 7x7 visible chunk window. */
export const TNT_CLAIM_RANGE = 48;
export const TNT_IGNITION_REACH = 6;
export const TNT_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;
export const TNT_MAX_RECEIPTS = 256;
export const FLINT_AND_STEEL_ITEM_ID = "flint_and_steel";
export const FLINT_AND_STEEL_MAX_DURABILITY = 64;

export type TntIgnitionRequest = {
  operationId: string;
  x: number;
  y: number;
  z: number;
  blockInstanceToken: string;
};

export type TntExplosionRequest = { eventId: string; ignitionId: string };

export type TntFuse = {
  eventId: string;
  ignitionId: string;
  coordKey: string;
  x: number;
  y: number;
  z: number;
  blockInstanceToken: string;
  igniterUserId: string;
  ignitedAt: number;
  dueAt: number;
};

export type FlintAndSteelStack = {
  itemId: string;
  count: number;
  durability?: number;
};

export type FlintAndSteelUseResult =
  | { ok: false; reason: "flint_and_steel_required" | "invalid_durability" }
  | { ok: true; nextStack: FlintAndSteelStack | null; broke: boolean; remainingDurability: number };

const OPERATION_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,160}:\d{1,16}$/;
const EVENT_PATTERN = /^tnt_[0-9a-z]{1,16}_[0-9a-z]{1,16}$/;

function parsedRecord(rawJson: string): Record<string, unknown> | null {
  if (typeof rawJson !== "string" || rawJson.length > 1_024) return null;
  try {
    const value = JSON.parse(rawJson);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function coordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function validateTntIgnitionRequestJson(rawJson: string): TntIgnitionRequest | null {
  const value = parsedRecord(rawJson);
  if (!value || !exactKeys(value, ["operationId", "x", "y", "z", "blockInstanceToken"])
    || typeof value.operationId !== "string" || !OPERATION_PATTERN.test(value.operationId)
    || !coordinate(value.x, -1_000_000, 1_000_000)
    || !coordinate(value.y, -24, 128)
    || !coordinate(value.z, -1_000_000, 1_000_000)
    || typeof value.blockInstanceToken !== "string" || !TOKEN_PATTERN.test(value.blockInstanceToken)) return null;
  return {
    operationId: value.operationId,
    x: value.x,
    y: value.y,
    z: value.z,
    blockInstanceToken: value.blockInstanceToken,
  };
}

export function tntIgnitionFingerprint(request: Readonly<TntIgnitionRequest>): string {
  return JSON.stringify([request.operationId, request.x, request.y, request.z, request.blockInstanceToken]);
}

export function authorizeTntIgnition(
  request: Readonly<TntIgnitionRequest>,
  authority: Readonly<{
    currentBlock: BlockType;
    blockInstanceToken: string;
    withinReach: boolean;
    heldItem: string | null;
    activeFuseAtCoordinate: boolean;
  }>,
): { ok: true } | { ok: false; reason: string } {
  if (!authority.withinReach) return { ok: false, reason: "out_of_reach" };
  if (authority.heldItem !== FLINT_AND_STEEL_ITEM_ID) return { ok: false, reason: "flint_and_steel_required" };
  if (authority.activeFuseAtCoordinate) return { ok: false, reason: "already_primed" };
  if (authority.currentBlock !== "tnt") return { ok: false, reason: "tnt_required" };
  if (authority.blockInstanceToken !== request.blockInstanceToken) return { ok: false, reason: "block_replaced" };
  return { ok: true };
}

/**
 * Spends one use only after a fresh ignition has been authorized. Replays must
 * return their receipt before calling this helper, so one operation can never
 * spend durability twice.
 */
export function spendFlintAndSteelIgnitionDurability(
  stack: Readonly<FlintAndSteelStack> | null,
): FlintAndSteelUseResult {
  if (!stack || stack.itemId !== FLINT_AND_STEEL_ITEM_ID || stack.count !== 1) {
    return { ok: false, reason: "flint_and_steel_required" };
  }
  if (!Number.isInteger(stack.durability) || (stack.durability ?? 0) < 1
    || (stack.durability ?? 0) > FLINT_AND_STEEL_MAX_DURABILITY) {
    return { ok: false, reason: "invalid_durability" };
  }
  const remainingDurability = (stack.durability ?? 0) - 1;
  return remainingDurability === 0
    ? { ok: true, nextStack: null, broke: true, remainingDurability }
    : {
      ok: true,
      nextStack: { itemId: FLINT_AND_STEEL_ITEM_ID, count: 1, durability: remainingDurability },
      broke: false,
      remainingDurability,
    };
}

export function createTntFuse(
  request: Readonly<TntIgnitionRequest>,
  igniterUserId: string,
  ignitedAt: number,
): TntFuse | null {
  if (!igniterUserId || igniterUserId.length > 256 || !Number.isSafeInteger(ignitedAt) || ignitedAt < 0
    || !Number.isSafeInteger(ignitedAt + TNT_FUSE_MS)) return null;
  const hash = hashText(`${request.operationId}:${request.blockInstanceToken}`).toString(36);
  return {
    eventId: `tnt_${ignitedAt.toString(36)}_${hash}`,
    ignitionId: request.operationId,
    coordKey: `${request.x}:${request.y}:${request.z}`,
    x: request.x,
    y: request.y,
    z: request.z,
    blockInstanceToken: request.blockInstanceToken,
    igniterUserId,
    ignitedAt,
    dueAt: ignitedAt + TNT_FUSE_MS,
  };
}

export function validateTntExplosionRequestJson(rawJson: string): TntExplosionRequest | null {
  const value = parsedRecord(rawJson);
  if (!value || !exactKeys(value, ["eventId", "ignitionId"])
    || typeof value.eventId !== "string" || !EVENT_PATTERN.test(value.eventId)
    || typeof value.ignitionId !== "string" || !OPERATION_PATTERN.test(value.ignitionId)) return null;
  return { eventId: value.eventId, ignitionId: value.ignitionId };
}

export function tntExplosionFingerprint(request: Readonly<TntExplosionRequest>): string {
  return JSON.stringify([request.eventId, request.ignitionId]);
}

export function authorizeTntExplosion(
  request: Readonly<TntExplosionRequest>,
  fuse: Readonly<TntFuse>,
  serverNow: number,
): { ok: true } | { ok: false; reason: string; retryAfterMs?: number } {
  if (request.eventId !== fuse.eventId || request.ignitionId !== fuse.ignitionId) {
    return { ok: false, reason: "invalid_claim" };
  }
  if (!Number.isSafeInteger(serverNow) || serverNow < fuse.ignitedAt) return { ok: false, reason: "invalid_clock" };
  if (serverNow < fuse.dueAt) return { ok: false, reason: "fuse_active", retryAfterMs: fuse.dueAt - serverNow };
  return { ok: true };
}

export function decideTntReceipt(
  storedFingerprint: string | null,
  fingerprint: string,
): "commit" | "replay" | "operation_id_reused" {
  return storedFingerprint === null ? "commit"
    : storedFingerprint === fingerprint ? "replay" : "operation_id_reused";
}

export function electTntExplosionClaimer(
  fuse: Pick<TntFuse, "x" | "y" | "z">,
  players: readonly Readonly<{ userId: string; x: number; y: number; z: number; active?: boolean }>[],
): string | null {
  const candidates = players.flatMap((player) => {
    const distance = Math.hypot(player.x - (fuse.x + 0.5), player.y - fuse.y, player.z - (fuse.z + 0.5));
    return player.active === false || !player.userId || !Number.isFinite(distance) || distance > TNT_CLAIM_RANGE
      ? [] : [{ userId: player.userId, distance }];
  });
  candidates.sort((left, right) => left.distance - right.distance
    || (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0));
  return candidates[0]?.userId ?? null;
}

export function normalizeStoredTntFuse(row: Readonly<Record<string, unknown>>): TntFuse | null {
  const signedInteger = (value: unknown) => typeof value === "string" && /^-?\d{1,16}$/.test(value) ? Number(value) : Number.NaN;
  const unsignedInteger = (value: unknown) => typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : Number.NaN;
  const x = signedInteger(row.x); const y = signedInteger(row.y); const z = signedInteger(row.z);
  const ignitedAt = unsignedInteger(row.ignitedAt); const dueAt = unsignedInteger(row.dueAt);
  if (typeof row.eventId !== "string" || !EVENT_PATTERN.test(row.eventId)
    || typeof row.ignitionId !== "string" || !OPERATION_PATTERN.test(row.ignitionId)
    || typeof row.coordKey !== "string" || row.coordKey !== `${x}:${y}:${z}`
    || typeof row.blockInstanceToken !== "string" || !TOKEN_PATTERN.test(row.blockInstanceToken)
    || typeof row.igniterUserId !== "string" || !row.igniterUserId
    || !coordinate(x, -1_000_000, 1_000_000) || !coordinate(y, -24, 128) || !coordinate(z, -1_000_000, 1_000_000)
    || !Number.isSafeInteger(ignitedAt) || ignitedAt < 0 || dueAt !== ignitedAt + TNT_FUSE_MS) return null;
  return { eventId: row.eventId, ignitionId: row.ignitionId, coordKey: row.coordKey,
    x, y, z, blockInstanceToken: row.blockInstanceToken, igniterUserId: row.igniterUserId, ignitedAt, dueAt };
}
