import {
  HOTBAR_SIZE,
  ITEMS,
  MAX_HEALTH,
  applyConfirmedArmorDamage,
  equippedArmorProtection,
  type ArmorDamageResult,
  type Equipment,
  type ItemId,
} from "./game.ts";
import { PLAYER_INTERACTION_EYE_HEIGHTS } from "./playerPosture.ts";
import {
  MAX_OPERATION_ID_LENGTH,
  MIN_OPERATION_ID_LENGTH,
  type CanonicalPlayerState,
} from "./chestTransfers.ts";
import * as BS from "./bundleStrings.ts";

export const PLAYER_MELEE_REACH = 4.5;
export const PLAYER_ATTACK_COOLDOWN_MS = 500;
/** Matches the sparse authority lease; attackers explicitly refresh before combat. */
export const PLAYER_COMBAT_PRESENCE_FRESH_MS = 90_000;
export const PLAYER_RESPAWN_DELAY_MS = 2_000;
export const MAX_PLAYER_COMBAT_QUERY_IDS = 128;
export const MAX_PLAYER_COMBAT_RECEIPTS_PER_USER = 64;
export const PLAYER_COMBAT_RECEIPT_TTL_MS = 15 * 60 * 1_000;
export const PLAYER_COMBAT_RECEIPT_PRUNE_LIMIT = 8;
export const MAX_PLAYER_COMBAT_REQUEST_LENGTH = 512;

export type CombatPose = {
  userId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  heartbeatAt: number;
  online: boolean;
};

export type StoredCombatPresence = {
  userId?: unknown;
  x?: unknown;
  y?: unknown;
  z?: unknown;
  yaw?: unknown;
  pitch?: unknown;
  heartbeatAt?: unknown;
  online?: unknown;
};

export type PlayerCombatState = {
  userId: string;
  health: number;
  maxHealth: typeof MAX_HEALTH;
  revision: number;
  deadUntil: number;
  lastAttackAt: number;
  lastAttackerId: string;
};

export type StoredPlayerCombatState = {
  userId: string;
  health: string;
  revision: string;
  deadUntil: string;
  lastAttackAt: string;
  lastAttackerId: string;
};

export type PlayerAttackRequest = {
  operationId: string;
  targetUserId: string;
  selectedHotbar: number;
  weaponItemId: ItemId | "";
};

export type ValidatedPlayerAttackRequest = PlayerAttackRequest & { fingerprint: string };

export type PlayerAttackRequestIssue =
  | "too_large"
  | "invalid_json"
  | "invalid_shape"
  | "invalid_operation_id"
  | "invalid_target"
  | "invalid_selected_hotbar"
  | "invalid_weapon";

export type PlayerAttackFailureReason =
  | "self_target"
  | "active_attacker_presence_required"
  | "active_target_presence_required"
  | "out_of_reach"
  | "not_aimed"
  | "attacker_dead"
  | "target_dead"
  | "cooldown"
  | "weapon_mismatch"
  | "attacker_state_invalid"
  | "target_state_invalid";

export type PlayerAttackResolution =
  | {
      ok: true;
      killed: boolean;
      weaponItemId: ItemId | null;
      baseDamage: number;
      damage: number;
      armorProtection: number;
      armorDamaged: ArmorDamageResult["damaged"];
      brokenArmor: ArmorDamageResult["broken"];
      targetEquipment: Equipment;
      attackerState: PlayerCombatState;
      targetState: PlayerCombatState;
      attackerRow: StoredPlayerCombatState;
      targetRow: StoredPlayerCombatState;
    }
  | {
      ok: false;
      reason: PlayerAttackFailureReason;
      attackerState?: PlayerCombatState;
      targetState?: PlayerCombatState;
      retryAfterMs?: number;
    };

export type PlayerCombatReceiptLike = {
  id: string;
  operationId: string;
  fingerprint: string;
  receiptCreatedAt: string;
};

const REQUEST_KEYS = [BS.operationId, "targetUserId", BS.selectedHotbar, "weaponItemId"] as const;

function hasExactKeys(record: Record<string, unknown>): boolean {
  const keys = Object.keys(record);
  return keys.length === REQUEST_KEYS.length && keys.every((key) => REQUEST_KEYS.includes(key as typeof REQUEST_KEYS[number]));
}

function validUserId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function playerAttackFingerprint(request: PlayerAttackRequest): string {
  return JSON.stringify([
    request.operationId,
    request.targetUserId,
    request.selectedHotbar,
    request.weaponItemId,
  ]);
}

export function validatePlayerAttackRequestJson(rawJson: string):
  | { ok: true; request: ValidatedPlayerAttackRequest }
  | { ok: false; reason: PlayerAttackRequestIssue } {
  if (typeof rawJson !== "string" || rawJson.length > MAX_PLAYER_COMBAT_REQUEST_LENGTH) {
    return { ok: false, reason: "too_large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: BS.invalidShape };
  const record = parsed as Record<string, unknown>;
  if (!hasExactKeys(record)) return { ok: false, reason: BS.invalidShape };
  if (typeof record.operationId !== "string"
    || record.operationId.length < MIN_OPERATION_ID_LENGTH
    || record.operationId.length > MAX_OPERATION_ID_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(record.operationId)) return { ok: false, reason: BS.invalidOperationId };
  if (!validUserId(record.targetUserId)) return { ok: false, reason: "invalid_target" };
  if (typeof record.selectedHotbar !== "number" || !Number.isInteger(record.selectedHotbar)
    || record.selectedHotbar < 0 || record.selectedHotbar >= HOTBAR_SIZE) {
    return { ok: false, reason: "invalid_selected_hotbar" };
  }
  if (typeof record.weaponItemId !== "string"
    || (record.weaponItemId !== "" && !Object.prototype.hasOwnProperty.call(ITEMS, record.weaponItemId))) {
    return { ok: false, reason: "invalid_weapon" };
  }
  const request: PlayerAttackRequest = {
    operationId: record.operationId,
    targetUserId: record.targetUserId,
    selectedHotbar: record.selectedHotbar,
    weaponItemId: record.weaponItemId as ItemId | "",
  };
  return { ok: true, request: { ...request, fingerprint: playerAttackFingerprint(request) } };
}

function finiteStoredInteger(value: string, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function defaultPlayerCombatState(userId: string): PlayerCombatState {
  return {
    userId,
    health: MAX_HEALTH,
    maxHealth: MAX_HEALTH,
    revision: 0,
    deadUntil: 0,
    lastAttackAt: 0,
    lastAttackerId: "",
  };
}

/** Reads canonical combat state. Respawn is exclusively a revisioned server mutation. */
export function materializePlayerCombatState(
  stored: StoredPlayerCombatState | null | undefined,
  userId: string,
  _serverNow: number,
): PlayerCombatState {
  const fallback = defaultPlayerCombatState(userId);
  if (!stored || stored.userId !== userId) return fallback;
  const health = finiteStoredInteger(stored.health, 0, MAX_HEALTH, MAX_HEALTH);
  const revision = finiteStoredInteger(stored.revision, 0, Number.MAX_SAFE_INTEGER, 0);
  const deadUntil = finiteStoredInteger(stored.deadUntil, 0, Number.MAX_SAFE_INTEGER, 0);
  const lastAttackAt = finiteStoredInteger(stored.lastAttackAt, 0, Number.MAX_SAFE_INTEGER, 0);
  return {
    userId,
    health,
    maxHealth: MAX_HEALTH,
    revision,
    deadUntil: health === 0 ? deadUntil : 0,
    lastAttackAt,
    lastAttackerId: stored.lastAttackerId.slice(0, 128),
  };
}

export function storedPlayerCombatRow(state: PlayerCombatState): StoredPlayerCombatState {
  return {
    userId: state.userId,
    health: String(state.health),
    revision: String(state.revision),
    deadUntil: String(state.deadUntil),
    lastAttackAt: String(state.lastAttackAt),
    lastAttackerId: state.lastAttackerId,
  };
}

function parsedField(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 32
    || !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function authoritativeCombatPose(
  stored: StoredCombatPresence | null | undefined,
  expectedUserId: string,
  serverNow: number,
): CombatPose | null {
  if (!stored || stored.userId !== expectedUserId || stored.online !== true) return null;
  const x = parsedField(stored.x);
  const y = parsedField(stored.y);
  const z = parsedField(stored.z);
  const yaw = parsedField(stored.yaw);
  const pitch = parsedField(stored.pitch);
  const heartbeatAt = typeof stored.heartbeatAt === "string" && /^\d{1,16}$/.test(stored.heartbeatAt)
    ? Number(stored.heartbeatAt)
    : Number.NaN;
  if ([x, y, z, yaw, pitch, heartbeatAt].some((value) => value === null || !Number.isFinite(value))) return null;
  if (serverNow - heartbeatAt < 0 || serverNow - heartbeatAt > PLAYER_COMBAT_PRESENCE_FRESH_MS) return null;
  return { userId: expectedUserId, x: x!, y: y!, z: z!, yaw: yaw!, pitch: pitch!, heartbeatAt, online: true };
}

/**
 * Uses the server-stored view ray against three points along the target's
 * standing capsule. This tolerates 5 Hz pose latency while rejecting attacks
 * behind the attacker or outside survival reach.
 */
export function validatePlayerMeleeSpatialAuthority(
  attacker: CombatPose,
  target: CombatPose,
): { ok: true } | { ok: false; reason: "out_of_reach" | "not_aimed" } {
  const cosPitch = Math.cos(attacker.pitch);
  const direction = [
    Math.sin(attacker.yaw) * cosPitch,
    Math.sin(attacker.pitch),
    -Math.cos(attacker.yaw) * cosPitch,
  ] as const;
  const horizontalDistance = Math.hypot(target.x - attacker.x, target.z - attacker.z);
  if (horizontalDistance > PLAYER_MELEE_REACH + 0.4 || Math.abs(target.y - attacker.y) > 3) {
    return { ok: false, reason: BS.outOfReach };
  }
  let closestProjection = Number.POSITIVE_INFINITY;
  let closestRayDistance = Number.POSITIVE_INFINITY;
  for (const eyeHeight of PLAYER_INTERACTION_EYE_HEIGHTS) {
    for (const targetHeight of [0.25, 0.9, 1.55]) {
      const dx = target.x - attacker.x;
      const dy = target.y + targetHeight - (attacker.y + eyeHeight);
      const dz = target.z - attacker.z;
      const projection = dx * direction[0] + dy * direction[1] + dz * direction[2];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      const rayDistance = Math.sqrt(Math.max(0, distanceSquared - projection * projection));
      if (projection >= 0 && rayDistance < closestRayDistance) {
        closestProjection = projection;
        closestRayDistance = rayDistance;
      }
    }
  }
  if (closestProjection > PLAYER_MELEE_REACH) return { ok: false, reason: BS.outOfReach };
  return closestRayDistance <= 0.72 ? { ok: true } : { ok: false, reason: "not_aimed" };
}

export function authoritativeWeapon(
  state: CanonicalPlayerState,
  selectedHotbarClaim: number,
  weaponItemIdClaim: ItemId | "",
): { ok: true; itemId: ItemId | null; damage: number } | { ok: false; reason: "weapon_mismatch" } {
  const selected = state.inventory[state.selectedHotbar] ?? null;
  const itemId = selected?.itemId ?? null;
  if (selectedHotbarClaim !== state.selectedHotbar || weaponItemIdClaim !== (itemId ?? "")) {
    return { ok: false, reason: "weapon_mismatch" };
  }
  return { ok: true, itemId, damage: itemId ? ITEMS[itemId].tool?.attackDamage ?? 1 : 1 };
}

export function mitigatedPlayerDamage(baseDamage: number, armorProtection: number): number {
  const safeBase = Number.isInteger(baseDamage) ? Math.max(1, Math.min(20, baseDamage)) : 1;
  const safeProtection = Number.isInteger(armorProtection) ? Math.max(0, Math.min(20, armorProtection)) : 0;
  return Math.max(1, Math.ceil(safeBase * (1 - safeProtection * 0.04)));
}

export function resolvePlayerAttack(input: {
  request: ValidatedPlayerAttackRequest;
  attackerId: string;
  attackerStored?: StoredPlayerCombatState | null;
  targetStored?: StoredPlayerCombatState | null;
  attackerPresence: CombatPose | null;
  targetPresence: CombatPose | null;
  attackerPlayerState: CanonicalPlayerState;
  targetPlayerState: CanonicalPlayerState;
  serverNow: number;
}): PlayerAttackResolution {
  if (input.attackerId === input.request.targetUserId) return { ok: false, reason: "self_target" };
  if (!input.attackerPresence) return { ok: false, reason: "active_attacker_presence_required" };
  if (!input.targetPresence) return { ok: false, reason: "active_target_presence_required" };
  const attackerState = materializePlayerCombatState(input.attackerStored, input.attackerId, input.serverNow);
  const targetState = materializePlayerCombatState(input.targetStored, input.request.targetUserId, input.serverNow);
  if (attackerState.health === 0) {
    return { ok: false, reason: "attacker_dead", attackerState, retryAfterMs: attackerState.deadUntil - input.serverNow };
  }
  if (targetState.health === 0) {
    return { ok: false, reason: "target_dead", targetState, retryAfterMs: targetState.deadUntil - input.serverNow };
  }
  const elapsed = input.serverNow - attackerState.lastAttackAt;
  if (attackerState.lastAttackAt > 0 && elapsed < PLAYER_ATTACK_COOLDOWN_MS) {
    return {
      ok: false,
      reason: "cooldown",
      attackerState,
      targetState,
      retryAfterMs: PLAYER_ATTACK_COOLDOWN_MS - Math.max(0, elapsed),
    };
  }
  const spatial = validatePlayerMeleeSpatialAuthority(input.attackerPresence, input.targetPresence);
  if (!spatial.ok) return { ...spatial, attackerState, targetState };
  const weapon = authoritativeWeapon(
    input.attackerPlayerState,
    input.request.selectedHotbar,
    input.request.weaponItemId,
  );
  if (!weapon.ok) return { ...weapon, attackerState, targetState };
  const armorProtection = equippedArmorProtection(input.targetPlayerState.equipment);
  const damage = mitigatedPlayerDamage(weapon.damage, armorProtection);
  const armorDamage = applyConfirmedArmorDamage(input.targetPlayerState.equipment);
  const health = Math.max(0, targetState.health - damage);
  const killed = health === 0;
  const nextAttacker: PlayerCombatState = { ...attackerState, lastAttackAt: input.serverNow };
  const nextTarget: PlayerCombatState = {
    ...targetState,
    health,
    revision: targetState.revision + 1,
    deadUntil: killed ? input.serverNow + PLAYER_RESPAWN_DELAY_MS : 0,
    lastAttackerId: input.attackerId.slice(0, 128),
  };
  return {
    ok: true,
    killed,
    weaponItemId: weapon.itemId,
    baseDamage: weapon.damage,
    damage,
    armorProtection,
    armorDamaged: armorDamage.damaged,
    brokenArmor: armorDamage.broken,
    targetEquipment: armorDamage.equipment,
    attackerState: nextAttacker,
    targetState: nextTarget,
    attackerRow: storedPlayerCombatRow(nextAttacker),
    targetRow: storedPlayerCombatRow(nextTarget),
  };
}

export function validatePlayerCombatUserIds(rawUserIds: unknown):
  | { ok: true; userIds: string[] }
  | { ok: false; reason: "invalid_user_ids" } {
  if (!Array.isArray(rawUserIds) || rawUserIds.length > MAX_PLAYER_COMBAT_QUERY_IDS) {
    return { ok: false, reason: "invalid_user_ids" };
  }
  const unique = new Set<string>();
  for (const userId of rawUserIds) {
    if (!validUserId(userId)) return { ok: false, reason: "invalid_user_ids" };
    unique.add(userId);
  }
  return { ok: true, userIds: [...unique].sort() };
}

export function decidePlayerCombatReplay(
  existingFingerprint: string | null,
  requestFingerprint: string,
): "new" | "replay" | "operation_id_reused" {
  if (existingFingerprint === null) return "new";
  return existingFingerprint === requestFingerprint ? "replay" : BS.operationIdReused;
}

/** Newest-first bounded retention that always keeps the just-committed receipt. */
export function selectPlayerCombatReceiptOverflow(
  newestFirstRows: readonly PlayerCombatReceiptLike[],
  committedReceiptId: string,
): string[] {
  const retained = new Set<string>([committedReceiptId]);
  for (const row of newestFirstRows) {
    if (retained.size >= MAX_PLAYER_COMBAT_RECEIPTS_PER_USER) break;
    retained.add(row.id);
  }
  return newestFirstRows.filter((row) => !retained.has(row.id)).map((row) => row.id);
}
