import {
  PRESENCE_MAX_HORIZONTAL_SPEED,
  PRESENCE_MAX_VERTICAL_SPEED,
} from "../shared/presenceMotion.ts";
import { PLAYER_INTERACTION_EYE_HEIGHTS } from "../shared/playerPosture.ts";
import type {
  ResolvedWorldBlockOperation,
  WorldBlockOperationRequest,
} from "../shared/worldBlockOperations.ts";

export const MAX_WORLD_BLOCK_OPERATION_RECEIPTS_PER_USER = 64;
export const WORLD_BLOCK_OPERATION_RECEIPT_PRUNE_LIMIT = 8;
export const WORLD_BLOCK_OPERATION_RECEIPT_TTL_MS = 15 * 60 * 1_000;
export const WORLD_BLOCK_ACTION_PRESENCE_FRESH_MS = 90_000;
export const WORLD_BLOCK_ACTION_REACH = 6;

const WORLD_BLOCK_ACTION_POSITION_SLACK = 2;
const MAX_RECEIPT_RESULT_BYTES = 32_768;

export type WorldBlockActionPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type WorldBlockOperationReceiptResult = {
  ok: true;
  replayed: boolean;
  operationId: string;
  kind: WorldBlockOperationRequest["kind"];
  x: number;
  y: number;
  z: number;
  previousBlock: ResolvedWorldBlockOperation["previousBlock"];
  nextBlock: ResolvedWorldBlockOperation["nextBlock"];
  inventoryRevision: string;
  chunkKey: string;
  chunkRevision: string;
  inventoryChanged: boolean;
  drop: ResolvedWorldBlockOperation["drop"];
  consumed: ResolvedWorldBlockOperation["consumed"];
  toolUse: null | {
    used: boolean;
    broke: boolean;
    itemId: string | null;
    remainingDurability: number | null;
  };
};

export type StoredWorldBlockPresence = {
  userId?: unknown;
  x?: unknown;
  y?: unknown;
  z?: unknown;
  heartbeatAt?: unknown;
  online?: unknown;
};

export type WorldBlockPoseAuthorityResult =
  | { ok: true; elapsedMs: number }
  | { ok: false; reason: "active_presence_required" | "implausible_pose" | "out_of_reach" };

function parsedStoredNumber(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 32
    || !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Bind the separately validated action pose to the operation idempotency key. */
export function worldBlockOperationPoseFingerprint(
  operationFingerprint: string,
  pose: WorldBlockActionPose,
): string {
  return JSON.stringify([1, operationFingerprint, pose.x, pose.y, pose.z, pose.yaw, pose.pitch]);
}

/**
 * Admit an action pose only when it could have travelled from the most recent
 * Lakebed presence lease, then enforce survival-style reach from the new eye.
 */
export function validateWorldBlockActionPose(
  stored: StoredWorldBlockPresence | null | undefined,
  expectedUserId: string,
  pose: WorldBlockActionPose,
  target: { x: number; y: number; z: number },
  serverNow: number,
): WorldBlockPoseAuthorityResult {
  if (!stored || stored.userId !== expectedUserId || stored.online !== true) {
    return { ok: false, reason: "active_presence_required" };
  }
  const x = parsedStoredNumber(stored.x);
  const y = parsedStoredNumber(stored.y);
  const z = parsedStoredNumber(stored.z);
  const heartbeatAt = typeof stored.heartbeatAt === "string" && /^\d{1,16}$/.test(stored.heartbeatAt)
    ? Number(stored.heartbeatAt)
    : Number.NaN;
  if (x === null || y === null || z === null || !Number.isFinite(heartbeatAt)) {
    return { ok: false, reason: "active_presence_required" };
  }
  const elapsedMs = serverNow - heartbeatAt;
  if (elapsedMs < 0 || elapsedMs > WORLD_BLOCK_ACTION_PRESENCE_FRESH_MS) {
    return { ok: false, reason: "active_presence_required" };
  }
  const elapsedSeconds = elapsedMs / 1_000;
  const horizontalAllowance = WORLD_BLOCK_ACTION_POSITION_SLACK
    + PRESENCE_MAX_HORIZONTAL_SPEED * elapsedSeconds;
  const verticalAllowance = WORLD_BLOCK_ACTION_POSITION_SLACK
    + PRESENCE_MAX_VERTICAL_SPEED * elapsedSeconds;
  if (Math.hypot(pose.x - x, pose.z - z) > horizontalAllowance
    || Math.abs(pose.y - y) > verticalAllowance) {
    return { ok: false, reason: "implausible_pose" };
  }
  const targetDistance = Math.min(...PLAYER_INTERACTION_EYE_HEIGHTS.map((eyeHeight) => Math.hypot(
    target.x + 0.5 - pose.x,
    target.y + 0.5 - (pose.y + eyeHeight),
    target.z + 0.5 - pose.z,
  )));
  return targetDistance <= WORLD_BLOCK_ACTION_REACH
    ? { ok: true, elapsedMs }
    : { ok: false, reason: "out_of_reach" };
}

export function encodeWorldBlockOperationReceipt(result: WorldBlockOperationReceiptResult): string {
  return JSON.stringify(result);
}

export function decodeWorldBlockOperationReceipt(raw: string): WorldBlockOperationReceiptResult | null {
  if (typeof raw !== "string" || raw.length > MAX_RECEIPT_RESULT_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorldBlockOperationReceiptResult>;
    if (!parsed || parsed.ok !== true || parsed.replayed !== false
      || typeof parsed.operationId !== "string"
      || (parsed.kind !== "mine" && parsed.kind !== "place" && parsed.kind !== "toggle")
      || !Number.isSafeInteger(parsed.x) || !Number.isSafeInteger(parsed.y) || !Number.isSafeInteger(parsed.z)
      || typeof parsed.previousBlock !== "string" || typeof parsed.nextBlock !== "string"
      || typeof parsed.inventoryRevision !== "string" || typeof parsed.chunkKey !== "string"
      || typeof parsed.chunkRevision !== "string" || typeof parsed.inventoryChanged !== "boolean") return null;
    return { ...parsed, replayed: true } as WorldBlockOperationReceiptResult;
  } catch {
    return null;
  }
}

export function selectWorldBlockOperationReceiptOverflow(
  newestRows: readonly { id: string }[],
  committedReceiptId: string,
): string[] {
  const kept = new Set(
    newestRows.slice(0, MAX_WORLD_BLOCK_OPERATION_RECEIPTS_PER_USER).map((row) => row.id),
  );
  kept.add(committedReceiptId);
  return newestRows
    .filter((row) => row.id !== committedReceiptId && !kept.has(row.id))
    .slice(0, WORLD_BLOCK_OPERATION_RECEIPT_PRUNE_LIMIT)
    .map((row) => row.id);
}
