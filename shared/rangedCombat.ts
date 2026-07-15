import { HOTBAR_SIZE } from "./game.ts";
import {
  PLAYER_RESPAWN_DELAY_MS,
  mitigatedPlayerDamage,
  type CombatPose,
  type PlayerCombatState,
} from "./playerCombat.ts";
import {
  MOB_RESPAWN_MS,
  type MobAuthorityState,
} from "./mobCombat.ts";

export const RANGED_COMBAT_PROTOCOL_VERSION = 1;
export const MAX_RANGED_COMBAT_REQUEST_BYTES = 768;
export const RANGED_MIN_CHARGE_MS = 50;
export const RANGED_FULL_CHARGE_MS = 1_000;
export const RANGED_MAX_CHARGE_MS = 60_000;
export const RANGED_RELEASE_COOLDOWN_MS = 250;
export const RANGED_MAX_RANGE = 64;
export const RANGED_TRAJECTORY_STEP_SECONDS = 1 / 60;
export const RANGED_MAX_FLIGHT_SECONDS = 4;
export const RANGED_GRAVITY = 12;
export const RANGED_MIN_SPEED = 8;
export const RANGED_MAX_SPEED = 30;
export const RANGED_MAX_BOW_DURABILITY = 384;
export const RANGED_MAX_ARROW_COUNT = 36 * 64;
export const MAX_RANGED_COMBAT_RECEIPTS_PER_USER = 64;
export const MAX_RANGED_COMBAT_RECEIPT_BYTES = 8_192;
export const RANGED_COMBAT_RECEIPT_TTL_MS = 15 * 60 * 1_000;
export const RANGED_COMBAT_RECEIPT_PRUNE_LIMIT = 8;

const OPERATION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const REVISION = /^(?:0|[1-9]\d{0,15})$/;

export type RangedTargetKind = "none" | "player" | "mob";

type RangedRequestBase = {
  version: typeof RANGED_COMBAT_PROTOCOL_VERSION;
  operationId: string;
  expectedInventoryRevision: string;
  selectedHotbar: number;
};

export type RangedChargeRequest = RangedRequestBase & { kind: "begin_charge" };
export type RangedCancelRequest = RangedRequestBase & { kind: "cancel_charge"; beginOperationId: string };
export type RangedReleaseRequest = RangedRequestBase & {
  kind: "release";
  targetKind: RangedTargetKind;
  targetId: string;
};
export type RangedCombatRequest = RangedChargeRequest | RangedCancelRequest | RangedReleaseRequest;
export type ValidatedRangedCombatRequest = RangedCombatRequest & { fingerprint: string };

export type RangedCombatRequestIssue =
  | "too_large"
  | "invalid_json"
  | "invalid_shape"
  | "invalid_version"
  | "invalid_operation_id"
  | "invalid_revision"
  | "invalid_selected_hotbar"
  | "invalid_target";

export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

/**
 * A narrow server-derived projection of the canonical inventory. Neither this
 * snapshot nor any of its resource counts are accepted from the wire request.
 */
export type RangedInventoryAuthority = Readonly<{
  revision: string;
  selectedHotbar: number;
  heldBowDurability: number | null;
  arrowCount: number;
}>;

export type RangedChargeAuthority = Readonly<{
  active: boolean;
  startedAt: number;
  lastReleasedAt: number;
  revision: number;
}>;

export type RangedPlayerTarget = Readonly<{
  kind: "player";
  id: string;
  pose: CombatPose;
  combat: PlayerCombatState;
  armorProtection: number;
}>;

export type RangedMobTarget = Readonly<{
  kind: "mob";
  id: string;
  position: Vec3;
  height: number;
  radius: number;
  combat: MobAuthorityState;
}>;

export type RangedAuthorityTarget = RangedPlayerTarget | RangedMobTarget;
export type RangedTargetCombatState = PlayerCombatState | MobAuthorityState;
export type RangedMissReason = "no_target" | "target_unavailable" | "self_target" | "target_dead" | "out_of_range" | "not_aimed" | "occluded";

export type RangedTrajectory = Readonly<{
  origin: Vec3;
  direction: Vec3;
  chargeMs: number;
  power: number;
  speed: number;
  damage: number;
}>;

export type RangedTraceResult =
  | { outcome: "hit"; point: Vec3; elapsedSeconds: number; traveled: number }
  | { outcome: "occluded"; point: Vec3; elapsedSeconds: number; traveled: number; voxel: Readonly<{ x: number; y: number; z: number }> }
  | { outcome: "miss"; point: Vec3; elapsedSeconds: number; traveled: number };

export type RangedReleaseFailureReason =
  | "invalid_request_kind"
  | "invalid_server_time"
  | "active_presence_required"
  | "attacker_dead"
  | "inventory_invalid"
  | "conflict"
  | "weapon_mismatch"
  | "arrows_required"
  | "charge_invalid"
  | "charge_required"
  | "charge_too_short"
  | "charge_expired"
  | "cooldown";

export type RangedReleaseResult =
  | {
      ok: true;
      fired: true;
      landed: boolean;
      missReason?: RangedMissReason;
      inventory: RangedInventoryAuthority;
      charge: RangedChargeAuthority;
      trajectory: RangedTrajectory;
      trace: RangedTraceResult;
      targetKind: RangedTargetKind;
      targetId: string;
      targetCombat?: RangedTargetCombatState;
      killed: boolean;
      bowBroken: boolean;
    }
  | { ok: false; reason: RangedReleaseFailureReason; retryAfterMs?: number };

export type RangedChargeStartResult =
  | { ok: true; charge: RangedChargeAuthority }
  | { ok: false; reason: Exclude<RangedReleaseFailureReason, "charge_required" | "charge_too_short" | "charge_expired">; retryAfterMs?: number };

export type RangedCombatReceiptPayload = Readonly<{
  version: typeof RANGED_COMBAT_PROTOCOL_VERSION;
  fingerprint: string;
  result: Extract<RangedReleaseResult, { ok: true }>;
}>;

export type RangedCombatReceiptLike = Readonly<{
  id: string;
  operationId: string;
  fingerprint: string;
  receiptCreatedAt: string;
}>;

export type IdempotentRangedReleaseResult =
  | { ok: true; replayed: boolean; receipt: RangedCombatReceiptPayload; result: Extract<RangedReleaseResult, { ok: true }> }
  | { ok: false; reason: RangedReleaseFailureReason | "invalid_receipt" | "operation_id_reused"; retryAfterMs?: number };

export type VoxelOccluder = (x: number, y: number, z: number) => boolean;

const BEGIN_KEYS = ["version", "operationId", "expectedInventoryRevision", "selectedHotbar", "kind"] as const;
const CANCEL_KEYS = [...BEGIN_KEYS, "beginOperationId"] as const;
const RELEASE_KEYS = [...BEGIN_KEYS, "targetKind", "targetId"] as const;

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function validRevision(value: unknown): value is string {
  return typeof value === "string" && REVISION.test(value) && Number.isSafeInteger(Number(value));
}

function validTargetId(kind: RangedTargetKind, id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (kind === "none") return id === "";
  if (id.length < 1 || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) return false;
  if (kind === "mob") return /^(pig|cow|sheep|zombie|skeleton|creeper|spider)-[0-9a-z]{1,8}-[0-9a-z]{1,3}$/.test(id);
  return true;
}

export function rangedCombatFingerprint(request: RangedCombatRequest): string {
  return request.kind === "begin_charge"
    ? JSON.stringify([RANGED_COMBAT_PROTOCOL_VERSION, request.operationId, request.expectedInventoryRevision, request.selectedHotbar, request.kind])
    : request.kind === "cancel_charge"
      ? JSON.stringify([RANGED_COMBAT_PROTOCOL_VERSION, request.operationId, request.expectedInventoryRevision, request.selectedHotbar, request.kind, request.beginOperationId])
    : JSON.stringify([
        RANGED_COMBAT_PROTOCOL_VERSION,
        request.operationId,
        request.expectedInventoryRevision,
        request.selectedHotbar,
        request.kind,
        request.targetKind,
        request.targetId,
      ]);
}

/** Accepts only the current protocol and rejects every unknown client field. */
export function validateRangedCombatRequestJson(rawJson: string):
  | { ok: true; request: ValidatedRangedCombatRequest }
  | { ok: false; reason: RangedCombatRequestIssue } {
  if (typeof rawJson !== "string" || rawJson.length > MAX_RANGED_COMBAT_REQUEST_BYTES) return { ok: false, reason: "too_large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "invalid_shape" };
  const record = parsed as Record<string, unknown>;
  if (record.version !== RANGED_COMBAT_PROTOCOL_VERSION) return { ok: false, reason: "invalid_version" };
  if (typeof record.operationId !== "string" || !OPERATION_ID.test(record.operationId)) return { ok: false, reason: "invalid_operation_id" };
  if (!validRevision(record.expectedInventoryRevision)) return { ok: false, reason: "invalid_revision" };
  if (typeof record.selectedHotbar !== "number" || !Number.isInteger(record.selectedHotbar)
    || record.selectedHotbar < 0 || record.selectedHotbar >= HOTBAR_SIZE) return { ok: false, reason: "invalid_selected_hotbar" };
  let request: RangedCombatRequest;
  if (record.kind === "begin_charge") {
    if (!exactKeys(record, BEGIN_KEYS)) return { ok: false, reason: "invalid_shape" };
    request = {
      version: RANGED_COMBAT_PROTOCOL_VERSION,
      operationId: record.operationId,
      expectedInventoryRevision: record.expectedInventoryRevision,
      selectedHotbar: record.selectedHotbar,
      kind: "begin_charge",
    };
  } else if (record.kind === "cancel_charge") {
    if (!exactKeys(record, CANCEL_KEYS)
      || typeof record.beginOperationId !== "string" || !OPERATION_ID.test(record.beginOperationId)) {
      return { ok: false, reason: "invalid_shape" };
    }
    request = {
      version: RANGED_COMBAT_PROTOCOL_VERSION,
      operationId: record.operationId,
      expectedInventoryRevision: record.expectedInventoryRevision,
      selectedHotbar: record.selectedHotbar,
      kind: "cancel_charge",
      beginOperationId: record.beginOperationId,
    };
  } else if (record.kind === "release") {
    if (!exactKeys(record, RELEASE_KEYS)) return { ok: false, reason: "invalid_shape" };
    if (record.targetKind !== "none" && record.targetKind !== "player" && record.targetKind !== "mob") {
      return { ok: false, reason: "invalid_target" };
    }
    if (!validTargetId(record.targetKind, record.targetId)) return { ok: false, reason: "invalid_target" };
    request = {
      version: RANGED_COMBAT_PROTOCOL_VERSION,
      operationId: record.operationId,
      expectedInventoryRevision: record.expectedInventoryRevision,
      selectedHotbar: record.selectedHotbar,
      kind: "release",
      targetKind: record.targetKind,
      targetId: record.targetId,
    };
  } else {
    return { ok: false, reason: "invalid_shape" };
  }
  return { ok: true, request: { ...request, fingerprint: rangedCombatFingerprint(request) } };
}

function finiteVec3(value: Vec3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function normalize(value: Vec3): Vec3 | null {
  if (!finiteVec3(value)) return null;
  const length = Math.hypot(value.x, value.y, value.z);
  return length > 1e-9 ? { x: value.x / length, y: value.y / length, z: value.z / length } : null;
}

/** The request has no origin or direction fields: both come from Lakebed presence. */
export function authoritativeRangedTrajectory(pose: CombatPose, chargeMs: number): RangedTrajectory | null {
  if (![pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(Number.isFinite)
    || !Number.isFinite(chargeMs) || chargeMs < RANGED_MIN_CHARGE_MS || chargeMs > RANGED_MAX_CHARGE_MS) return null;
  const cosPitch = Math.cos(pose.pitch);
  const direction = normalize({
    x: Math.sin(pose.yaw) * cosPitch,
    y: Math.sin(pose.pitch),
    z: -Math.cos(pose.yaw) * cosPitch,
  });
  if (!direction) return null;
  const draw = Math.min(1, chargeMs / RANGED_FULL_CHARGE_MS);
  const power = Math.min(1, (draw * draw + draw * 2) / 3);
  return {
    origin: { x: pose.x, y: pose.y + 1.62, z: pose.z },
    direction,
    chargeMs,
    power,
    speed: RANGED_MIN_SPEED + (RANGED_MAX_SPEED - RANGED_MIN_SPEED) * power,
    damage: Math.max(1, Math.round(2 + power * 4)),
  };
}

export function rangedTrajectoryPoint(trajectory: RangedTrajectory, elapsedSeconds: number): Vec3 {
  const t = Math.max(0, elapsedSeconds);
  return {
    x: trajectory.origin.x + trajectory.direction.x * trajectory.speed * t,
    y: trajectory.origin.y + trajectory.direction.y * trajectory.speed * t - 0.5 * RANGED_GRAVITY * t * t,
    z: trajectory.origin.z + trajectory.direction.z * trajectory.speed * t,
  };
}

/** Returns the earliest fraction along a segment that enters an AABB. */
export function segmentAabbIntersectionFraction(start: Vec3, end: Vec3, min: Vec3, max: Vec3): number | null {
  if (![start, end, min, max].every(finiteVec3)) return null;
  let enter = 0;
  let exit = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-12) {
      if (start[axis] < min[axis] || start[axis] > max[axis]) return null;
      continue;
    }
    let near = (min[axis] - start[axis]) / delta;
    let far = (max[axis] - start[axis]) / delta;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  return enter >= 0 && enter <= 1 ? enter : null;
}

/** Deterministic 3D DDA; X then Y then Z breaks exact boundary ties. */
export function firstOccludingVoxelOnSegment(start: Vec3, end: Vec3, occludes: VoxelOccluder):
  | { x: number; y: number; z: number; fraction: number }
  | null {
  if (!finiteVec3(start) || !finiteVec3(end)) return null;
  let x = Math.floor(start.x);
  let y = Math.floor(start.y);
  let z = Math.floor(start.z);
  if (occludes(x, y, z)) return { x, y, z, fraction: 0 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const stepZ = Math.sign(dz);
  const deltaX = dx === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy);
  const deltaZ = dz === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dz);
  let nextX = dx === 0 ? Number.POSITIVE_INFINITY : ((stepX > 0 ? x + 1 : x) - start.x) / dx;
  let nextY = dy === 0 ? Number.POSITIVE_INFINITY : ((stepY > 0 ? y + 1 : y) - start.y) / dy;
  let nextZ = dz === 0 ? Number.POSITIVE_INFINITY : ((stepZ > 0 ? z + 1 : z) - start.z) / dz;
  const maximumSteps = Math.min(512, Math.abs(Math.floor(end.x) - x) + Math.abs(Math.floor(end.y) - y) + Math.abs(Math.floor(end.z) - z) + 3);
  for (let step = 0; step < maximumSteps; step += 1) {
    let fraction: number;
    if (nextX <= nextY && nextX <= nextZ) {
      fraction = nextX;
      x += stepX;
      nextX += deltaX;
    } else if (nextY <= nextZ) {
      fraction = nextY;
      y += stepY;
      nextY += deltaY;
    } else {
      fraction = nextZ;
      z += stepZ;
      nextZ += deltaZ;
    }
    if (fraction > 1) return null;
    if (occludes(x, y, z)) return { x, y, z, fraction: Math.max(0, fraction) };
  }
  return null;
}

function targetBounds(target: RangedAuthorityTarget): { min: Vec3; max: Vec3 } | null {
  if (target.kind === "player") {
    if (![target.pose.x, target.pose.y, target.pose.z].every(Number.isFinite)) return null;
    return {
      min: { x: target.pose.x - 0.42, y: target.pose.y, z: target.pose.z - 0.42 },
      max: { x: target.pose.x + 0.42, y: target.pose.y + 1.8, z: target.pose.z + 0.42 },
    };
  }
  if (!finiteVec3(target.position) || !Number.isFinite(target.height) || !Number.isFinite(target.radius)
    || target.height <= 0 || target.height > 4 || target.radius <= 0 || target.radius > 2) return null;
  return {
    min: { x: target.position.x - target.radius, y: target.position.y, z: target.position.z - target.radius },
    max: { x: target.position.x + target.radius, y: target.position.y + target.height, z: target.position.z + target.radius },
  };
}

export function traceRangedTrajectory(
  trajectory: RangedTrajectory,
  target: RangedAuthorityTarget | null,
  occludes: VoxelOccluder = () => false,
): RangedTraceResult {
  const bounds = target ? targetBounds(target) : null;
  let previous = trajectory.origin;
  let traveled = 0;
  const steps = Math.ceil(RANGED_MAX_FLIGHT_SECONDS / RANGED_TRAJECTORY_STEP_SECONDS);
  for (let index = 1; index <= steps; index += 1) {
    const elapsedSeconds = index * RANGED_TRAJECTORY_STEP_SECONDS;
    let next = rangedTrajectoryPoint(trajectory, elapsedSeconds);
    const segmentLength = Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z);
    if (traveled + segmentLength > RANGED_MAX_RANGE) {
      const remaining = Math.max(0, RANGED_MAX_RANGE - traveled);
      const fraction = segmentLength > 0 ? remaining / segmentLength : 0;
      next = {
        x: previous.x + (next.x - previous.x) * fraction,
        y: previous.y + (next.y - previous.y) * fraction,
        z: previous.z + (next.z - previous.z) * fraction,
      };
    }
    const targetFraction = bounds ? segmentAabbIntersectionFraction(previous, next, bounds.min, bounds.max) : null;
    const voxel = firstOccludingVoxelOnSegment(previous, next, occludes);
    if (targetFraction !== null && (!voxel || targetFraction <= voxel.fraction)) {
      const point = {
        x: previous.x + (next.x - previous.x) * targetFraction,
        y: previous.y + (next.y - previous.y) * targetFraction,
        z: previous.z + (next.z - previous.z) * targetFraction,
      };
      return { outcome: "hit", point, elapsedSeconds, traveled: traveled + segmentLength * targetFraction };
    }
    if (voxel) {
      const point = {
        x: previous.x + (next.x - previous.x) * voxel.fraction,
        y: previous.y + (next.y - previous.y) * voxel.fraction,
        z: previous.z + (next.z - previous.z) * voxel.fraction,
      };
      return { outcome: "occluded", point, elapsedSeconds, traveled: traveled + segmentLength * voxel.fraction, voxel };
    }
    traveled += segmentLength;
    previous = next;
    if (traveled >= RANGED_MAX_RANGE - 1e-9) return { outcome: "miss", point: next, elapsedSeconds, traveled: RANGED_MAX_RANGE };
  }
  return { outcome: "miss", point: previous, elapsedSeconds: RANGED_MAX_FLIGHT_SECONDS, traveled };
}

function validInventory(inventory: RangedInventoryAuthority): boolean {
  return validRevision(inventory.revision) && Number(inventory.revision) < Number.MAX_SAFE_INTEGER
    && Number.isInteger(inventory.selectedHotbar) && inventory.selectedHotbar >= 0 && inventory.selectedHotbar < HOTBAR_SIZE
    && (inventory.heldBowDurability === null || (Number.isInteger(inventory.heldBowDurability)
      && inventory.heldBowDurability >= 1 && inventory.heldBowDurability <= RANGED_MAX_BOW_DURABILITY))
    && Number.isInteger(inventory.arrowCount) && inventory.arrowCount >= 0 && inventory.arrowCount <= RANGED_MAX_ARROW_COUNT;
}

function validCharge(charge: RangedChargeAuthority, serverNow: number): boolean {
  return typeof charge.active === "boolean"
    && Number.isSafeInteger(charge.startedAt) && charge.startedAt >= 0 && charge.startedAt <= serverNow
    && Number.isSafeInteger(charge.lastReleasedAt) && charge.lastReleasedAt >= 0 && charge.lastReleasedAt <= serverNow
    && Number.isSafeInteger(charge.revision) && charge.revision >= 0 && charge.revision < Number.MAX_SAFE_INTEGER;
}

function validateWeaponAndRevision(request: RangedCombatRequest, inventory: RangedInventoryAuthority):
  | { ok: true }
  | { ok: false; reason: "inventory_invalid" | "conflict" | "weapon_mismatch" | "arrows_required" } {
  if (!validInventory(inventory)) return { ok: false, reason: "inventory_invalid" };
  if (request.expectedInventoryRevision !== inventory.revision) return { ok: false, reason: "conflict" };
  if (request.selectedHotbar !== inventory.selectedHotbar || inventory.heldBowDurability === null) return { ok: false, reason: "weapon_mismatch" };
  if (inventory.arrowCount < 1) return { ok: false, reason: "arrows_required" };
  return { ok: true };
}

export function resolveRangedChargeStart(input: {
  request: ValidatedRangedCombatRequest;
  inventory: RangedInventoryAuthority;
  charge: RangedChargeAuthority;
  attackerPresence: CombatPose | null;
  attackerAlive: boolean;
  serverNow: number;
}): RangedChargeStartResult {
  if (input.request.kind !== "begin_charge") return { ok: false, reason: "invalid_request_kind" };
  if (!Number.isSafeInteger(input.serverNow) || input.serverNow < 0) return { ok: false, reason: "invalid_server_time" };
  if (!input.attackerPresence || input.attackerPresence.online !== true) return { ok: false, reason: "active_presence_required" };
  if (!input.attackerAlive) return { ok: false, reason: "attacker_dead" };
  const authority = validateWeaponAndRevision(input.request, input.inventory);
  if (!authority.ok) return authority;
  if (!validCharge(input.charge, input.serverNow)) return { ok: false, reason: "charge_invalid" };
  const elapsed = input.serverNow - input.charge.lastReleasedAt;
  if (input.charge.lastReleasedAt > 0 && elapsed < RANGED_RELEASE_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", retryAfterMs: RANGED_RELEASE_COOLDOWN_MS - Math.max(0, elapsed) };
  }
  return {
    ok: true,
    charge: {
      active: true,
      startedAt: input.serverNow,
      lastReleasedAt: input.charge.lastReleasedAt,
      revision: input.charge.revision + 1,
    },
  };
}

function requestedTarget(request: RangedReleaseRequest, target: RangedAuthorityTarget | null, attackerId: string):
  | { target: RangedAuthorityTarget | null; missReason?: RangedMissReason } {
  if (request.targetKind === "none") return { target: null, missReason: "no_target" };
  if (request.targetKind === "player" && request.targetId === attackerId) return { target: null, missReason: "self_target" };
  if (!target || target.kind !== request.targetKind || target.id !== request.targetId) return { target: null, missReason: "target_unavailable" };
  if (target.kind === "player" && (target.pose.userId !== target.id || target.pose.online !== true
    || target.combat.userId !== target.id || !Number.isInteger(target.armorProtection)
    || target.armorProtection < 0 || target.armorProtection > 20
    || !Number.isSafeInteger(target.combat.revision) || target.combat.revision >= Number.MAX_SAFE_INTEGER)) {
    return { target: null, missReason: "target_unavailable" };
  }
  if (target.kind === "mob" && (target.combat.mobId !== target.id
    || !Number.isSafeInteger(target.combat.revision) || target.combat.revision >= Number.MAX_SAFE_INTEGER)) {
    return { target: null, missReason: "target_unavailable" };
  }
  if (target.combat.health <= 0) return { target: null, missReason: "target_dead" };
  return { target };
}

function targetDistance(origin: Vec3, target: RangedAuthorityTarget): number {
  const position = target.kind === "player" ? target.pose : target.position;
  return Math.hypot(position.x - origin.x, position.y + 0.9 - origin.y, position.z - origin.z);
}

function damageTarget(target: RangedAuthorityTarget, baseDamage: number, attackerId: string, serverNow: number): { combat: RangedTargetCombatState; killed: boolean } {
  if (target.kind === "player") {
    const damage = mitigatedPlayerDamage(baseDamage, target.armorProtection);
    const health = Math.max(0, target.combat.health - damage);
    return {
      killed: health === 0,
      combat: {
        ...target.combat,
        health,
        revision: target.combat.revision + 1,
        deadUntil: health === 0 ? serverNow + PLAYER_RESPAWN_DELAY_MS : 0,
        lastAttackerId: attackerId.slice(0, 128),
      },
    };
  }
  const health = Math.max(0, target.combat.health - baseDamage);
  return {
    killed: health === 0,
    combat: {
      ...target.combat,
      health,
      revision: target.combat.revision + 1,
      deadUntil: health === 0 ? serverNow + MOB_RESPAWN_MS : 0,
      lastAttackAt: serverNow,
      lastAttackerId: attackerId.slice(0, 128),
    },
  };
}

/**
 * One valid release always spends exactly one arrow and one bow durability,
 * including misses. Target damage is derived only after trajectory + terrain
 * authority succeeds and is returned for the caller's single DB transaction.
 */
export function resolveRangedRelease(input: {
  request: ValidatedRangedCombatRequest;
  attackerId: string;
  attackerPresence: CombatPose | null;
  attackerAlive: boolean;
  inventory: RangedInventoryAuthority;
  charge: RangedChargeAuthority;
  target: RangedAuthorityTarget | null;
  serverNow: number;
  occludes?: VoxelOccluder;
}): RangedReleaseResult {
  if (input.request.kind !== "release") return { ok: false, reason: "invalid_request_kind" };
  if (!Number.isSafeInteger(input.serverNow) || input.serverNow < 0) return { ok: false, reason: "invalid_server_time" };
  if (!input.attackerPresence || input.attackerPresence.online !== true || input.attackerPresence.userId !== input.attackerId) {
    return { ok: false, reason: "active_presence_required" };
  }
  if (!input.attackerAlive) return { ok: false, reason: "attacker_dead" };
  const authority = validateWeaponAndRevision(input.request, input.inventory);
  if (!authority.ok) return authority;
  if (!validCharge(input.charge, input.serverNow)) return { ok: false, reason: "charge_invalid" };
  if (!input.charge.active) return { ok: false, reason: "charge_required" };
  const chargeMs = input.serverNow - input.charge.startedAt;
  if (!Number.isFinite(chargeMs) || chargeMs < RANGED_MIN_CHARGE_MS) {
    return { ok: false, reason: "charge_too_short", retryAfterMs: Math.max(0, RANGED_MIN_CHARGE_MS - chargeMs) };
  }
  if (chargeMs > RANGED_MAX_CHARGE_MS) return { ok: false, reason: "charge_expired" };
  const cooldownElapsed = input.serverNow - input.charge.lastReleasedAt;
  if (input.charge.lastReleasedAt > 0 && cooldownElapsed < RANGED_RELEASE_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", retryAfterMs: RANGED_RELEASE_COOLDOWN_MS - Math.max(0, cooldownElapsed) };
  }
  const trajectory = authoritativeRangedTrajectory(input.attackerPresence, chargeMs);
  if (!trajectory) return { ok: false, reason: "active_presence_required" };
  const selection = requestedTarget(input.request, input.target, input.attackerId);
  let trace: RangedTraceResult;
  let missReason = selection.missReason;
  if (selection.target && targetDistance(trajectory.origin, selection.target) > RANGED_MAX_RANGE + 2) {
    trace = traceRangedTrajectory(trajectory, null, input.occludes);
    missReason = "out_of_range";
  } else {
    trace = traceRangedTrajectory(trajectory, selection.target, input.occludes);
    if (selection.target && trace.outcome !== "hit") missReason = trace.outcome === "occluded" ? "occluded" : "not_aimed";
  }
  const landed = Boolean(selection.target && trace.outcome === "hit");
  const targetDamage = landed && selection.target
    ? damageTarget(selection.target, trajectory.damage, input.attackerId, input.serverNow)
    : null;
  const remainingDurability = input.inventory.heldBowDurability! - 1;
  return {
    ok: true,
    fired: true,
    landed,
    ...(landed ? {} : { missReason: missReason ?? "not_aimed" }),
    inventory: {
      revision: String(Number(input.inventory.revision) + 1),
      selectedHotbar: input.inventory.selectedHotbar,
      heldBowDurability: remainingDurability > 0 ? remainingDurability : null,
      arrowCount: input.inventory.arrowCount - 1,
    },
    charge: {
      active: false,
      startedAt: 0,
      lastReleasedAt: input.serverNow,
      revision: input.charge.revision + 1,
    },
    trajectory,
    trace,
    targetKind: input.request.targetKind,
    targetId: input.request.targetId,
    ...(targetDamage ? { targetCombat: targetDamage.combat } : {}),
    killed: targetDamage?.killed ?? false,
    bowBroken: remainingDurability === 0,
  };
}

export function decideRangedCombatReplay(existingFingerprint: string | null, requestFingerprint: string): "new" | "replay" | "operation_id_reused" {
  if (existingFingerprint === null) return "new";
  return existingFingerprint === requestFingerprint ? "replay" : "operation_id_reused";
}

export function encodeRangedCombatReceipt(payload: RangedCombatReceiptPayload): string {
  return JSON.stringify(payload);
}

const RELEASE_RESULT_KEYS = [
  "ok", "fired", "landed", "missReason", "inventory", "charge", "trajectory", "trace",
  "targetKind", "targetId", "targetCombat", "killed", "bowBroken",
] as const;
const RELEASE_RESULT_REQUIRED_KEYS = RELEASE_RESULT_KEYS.filter((key) => key !== "missReason" && key !== "targetCombat");
const MISS_REASONS: readonly RangedMissReason[] = [
  "no_target", "target_unavailable", "self_target", "target_dead", "out_of_range", "not_aimed", "occluded",
];

function allowedAndRequiredKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => keys.includes(key));
}

function validReceiptTrajectory(value: unknown): value is RangedTrajectory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["origin", "direction", "chargeMs", "power", "speed", "damage"])) return false;
  const origin = record.origin as Vec3;
  const direction = record.direction as Vec3;
  if (!origin || typeof origin !== "object" || Array.isArray(origin) || !exactKeys(origin as unknown as Record<string, unknown>, ["x", "y", "z"])
    || !direction || typeof direction !== "object" || Array.isArray(direction) || !exactKeys(direction as unknown as Record<string, unknown>, ["x", "y", "z"])
    || !finiteVec3(origin) || !finiteVec3(direction)) return false;
  const chargeMs = record.chargeMs;
  const power = record.power;
  const speed = record.speed;
  const damage = record.damage;
  if (!Number.isFinite(chargeMs) || (chargeMs as number) < RANGED_MIN_CHARGE_MS || (chargeMs as number) > RANGED_MAX_CHARGE_MS
    || !Number.isFinite(power) || (power as number) < 0 || (power as number) > 1
    || !Number.isFinite(speed) || (speed as number) < RANGED_MIN_SPEED || (speed as number) > RANGED_MAX_SPEED
    || !Number.isInteger(damage) || (damage as number) < 1 || (damage as number) > 6) return false;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  const draw = Math.min(1, (chargeMs as number) / RANGED_FULL_CHARGE_MS);
  const derivedPower = Math.min(1, (draw * draw + draw * 2) / 3);
  return Math.abs(length - 1) < 1e-9
    && Math.abs((power as number) - derivedPower) < 1e-9
    && Math.abs((speed as number) - (RANGED_MIN_SPEED + (RANGED_MAX_SPEED - RANGED_MIN_SPEED) * derivedPower)) < 1e-9
    && damage === Math.max(1, Math.round(2 + derivedPower * 4));
}

function validReceiptTrace(value: unknown): value is RangedTraceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const common = ["outcome", "point", "elapsedSeconds", "traveled"];
  const expected = record.outcome === "occluded" ? [...common, "voxel"] : common;
  if ((record.outcome !== "hit" && record.outcome !== "miss" && record.outcome !== "occluded") || !exactKeys(record, expected)) return false;
  const point = record.point as Vec3;
  if (!point || typeof point !== "object" || Array.isArray(point)
    || !exactKeys(point as unknown as Record<string, unknown>, ["x", "y", "z"]) || !finiteVec3(point)
    || !Number.isFinite(record.elapsedSeconds) || (record.elapsedSeconds as number) < 0 || (record.elapsedSeconds as number) > RANGED_MAX_FLIGHT_SECONDS + RANGED_TRAJECTORY_STEP_SECONDS
    || !Number.isFinite(record.traveled) || (record.traveled as number) < 0 || (record.traveled as number) > RANGED_MAX_RANGE + 1e-6) return false;
  if (record.outcome === "occluded") {
    const voxel = record.voxel;
    if (!voxel || typeof voxel !== "object" || Array.isArray(voxel)
      || !exactKeys(voxel as Record<string, unknown>, ["x", "y", "z", "fraction"])) return false;
    const candidate = voxel as Record<string, unknown>;
    if (!Number.isInteger(candidate.x) || !Number.isInteger(candidate.y) || !Number.isInteger(candidate.z)
      || !Number.isFinite(candidate.fraction) || (candidate.fraction as number) < 0 || (candidate.fraction as number) > 1) return false;
  }
  return true;
}

function validReceiptCombat(value: unknown, targetKind: RangedTargetKind): value is RangedTargetCombatState {
  if (!value || typeof value !== "object" || Array.isArray(value) || targetKind === "none") return false;
  const record = value as Record<string, unknown>;
  const playerKeys = ["userId", "health", "maxHealth", "revision", "deadUntil", "lastAttackAt", "lastAttackerId"];
  const mobKeys = ["mobId", "kind", "health", "maxHealth", "revision", "deadUntil", "lastAttackAt", "lastAttackerId"];
  if (targetKind === "player") {
    if (!exactKeys(record, playerKeys) || typeof record.userId !== "string") return false;
  } else if (!exactKeys(record, mobKeys) || typeof record.mobId !== "string" || typeof record.kind !== "string") return false;
  return Number.isInteger(record.health) && (record.health as number) >= 0
    && Number.isInteger(record.maxHealth) && (record.maxHealth as number) >= 1 && (record.health as number) <= (record.maxHealth as number)
    && Number.isSafeInteger(record.revision) && (record.revision as number) >= 0
    && Number.isSafeInteger(record.deadUntil) && (record.deadUntil as number) >= 0
    && Number.isSafeInteger(record.lastAttackAt) && (record.lastAttackAt as number) >= 0
    && typeof record.lastAttackerId === "string" && record.lastAttackerId.length <= 128;
}

/** Current receipt envelope only; malformed server rows never replay. */
export function decodeRangedCombatReceipt(rawJson: string): RangedCombatReceiptPayload | null {
  try {
    if (typeof rawJson !== "string" || rawJson.length > MAX_RANGED_COMBAT_RECEIPT_BYTES) return null;
    const parsed: unknown = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!exactKeys(record, ["version", "fingerprint", "result"]) || record.version !== RANGED_COMBAT_PROTOCOL_VERSION
      || typeof record.fingerprint !== "string" || record.fingerprint.length < 2 || record.fingerprint.length > MAX_RANGED_COMBAT_REQUEST_BYTES
      || !record.result || typeof record.result !== "object" || Array.isArray(record.result)) return null;
    const resultRecord = record.result as Record<string, unknown>;
    if (!allowedAndRequiredKeys(resultRecord, RELEASE_RESULT_KEYS, RELEASE_RESULT_REQUIRED_KEYS)) return null;
    const result = resultRecord as Partial<Extract<RangedReleaseResult, { ok: true }>>;
    if (result.ok !== true || result.fired !== true || typeof result.landed !== "boolean"
      || typeof result.killed !== "boolean" || typeof result.bowBroken !== "boolean"
      || !result.inventory || !validInventory(result.inventory)
      || !result.charge || typeof result.charge.active !== "boolean"
      || !Number.isSafeInteger(result.charge.startedAt) || !Number.isSafeInteger(result.charge.lastReleasedAt)
      || !Number.isSafeInteger(result.charge.revision) || result.charge.revision < 0
      || !validReceiptTrajectory(result.trajectory) || !validReceiptTrace(result.trace)
      || (result.targetKind !== "none" && result.targetKind !== "player" && result.targetKind !== "mob")
      || !validTargetId(result.targetKind, result.targetId)) return null;
    if (result.charge.active || result.charge.startedAt !== 0) return null;
    if (result.landed) {
      if (result.missReason !== undefined || result.trace.outcome !== "hit"
        || !validReceiptCombat(result.targetCombat, result.targetKind)) return null;
      const identity = result.targetKind === "player"
        ? (result.targetCombat as PlayerCombatState).userId
        : (result.targetCombat as MobAuthorityState).mobId;
      if (identity !== result.targetId || result.killed !== (result.targetCombat!.health === 0)) return null;
    } else if (!result.missReason || !MISS_REASONS.includes(result.missReason)
      || result.targetCombat !== undefined || result.trace.outcome === "hit" || result.killed) return null;
    if (result.bowBroken !== (result.inventory.heldBowDurability === null)) return null;
    return record as RangedCombatReceiptPayload;
  } catch {
    return null;
  }
}

export function resolveRangedReleaseIdempotently(
  existingReceiptJson: string | null,
  input: Parameters<typeof resolveRangedRelease>[0],
): IdempotentRangedReleaseResult {
  if (input.request.kind !== "release") return { ok: false, reason: "invalid_request_kind" };
  if (existingReceiptJson !== null) {
    const receipt = decodeRangedCombatReceipt(existingReceiptJson);
    if (!receipt) return { ok: false, reason: "invalid_receipt" };
    const decision = decideRangedCombatReplay(receipt.fingerprint, input.request.fingerprint);
    if (decision === "operation_id_reused") return { ok: false, reason: "operation_id_reused" };
    return { ok: true, replayed: true, receipt, result: receipt.result };
  }
  const result = resolveRangedRelease(input);
  if (!result.ok) return result;
  const receipt: RangedCombatReceiptPayload = {
    version: RANGED_COMBAT_PROTOCOL_VERSION,
    fingerprint: input.request.fingerprint,
    result,
  };
  return { ok: true, replayed: false, receipt, result };
}

/** Newest-first bounded retention that always keeps the committed receipt. */
export function selectRangedCombatReceiptOverflow(newestFirst: readonly RangedCombatReceiptLike[], committedReceiptId: string): string[] {
  const retained = new Set<string>([committedReceiptId]);
  for (const row of newestFirst) {
    if (retained.size >= MAX_RANGED_COMBAT_RECEIPTS_PER_USER) break;
    retained.add(row.id);
  }
  return newestFirst.filter((row) => !retained.has(row.id)).map((row) => row.id);
}
