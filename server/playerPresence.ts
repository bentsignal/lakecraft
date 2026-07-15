import {
  PRESENCE_MAX_PITCH,
  PRESENCE_MAX_HORIZONTAL_SPEED,
  PRESENCE_MAX_VERTICAL_SPEED,
  PRESENCE_MAX_X,
  PRESENCE_MAX_Y,
  PRESENCE_MAX_YAW,
  PRESENCE_MAX_Z,
  PRESENCE_MIN_X,
  PRESENCE_MIN_Y,
  PRESENCE_MIN_Z,
  PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS,
} from "../shared/presenceMotion.ts";

export type StoredPlayerPresence = {
  userId: string;
  displayName: string;
  color: string;
  x: string;
  y: string;
  z: string;
  yaw: string;
  pitch: string;
  /** Optional only for pure compatibility with rows predating avatar appearance. */
  heldItem?: string;
  armorHead?: string;
  armorChest?: string;
  armorLegs?: string;
  armorFeet?: string;
};

export type OfflinePlayerPresenceValue = StoredPlayerPresence & {
  vx: "0";
  vy: "0";
  vz: "0";
  heartbeatAt: string;
  online: false;
};

export type ValidatedPresencePose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type PresenceWriteGateDecision =
  | { accept: true; retryAfterMs: 0 }
  | { accept: false; retryAfterMs: number };

/**
 * Motion authority deliberately permits only a short, continuously observed
 * trajectory. A heartbeat arriving after this window is a reconnect and must
 * resume at the exact persisted pose (or spend a server-approved relocation).
 */
export const PRESENCE_TRAJECTORY_MAX_ELAPSED_MS = 2_000;
export const PRESENCE_TRAJECTORY_HORIZONTAL_SLACK = 0.75;
export const PRESENCE_TRAJECTORY_VERTICAL_SLACK = 1.25;
export const PRESENCE_RELOCATION_MAX_LIFETIME_MS = 15_000;
const PRESENCE_TRAJECTORY_COMPARISON_EPSILON = 1e-9;

export type PresenceTrajectoryRecord = {
  userId: string;
  x: string;
  y: string;
  z: string;
  yaw: string;
  pitch: string;
  heartbeatAt: string;
  online: boolean;
};

/**
 * A single active row per user is enough for Lakebed. The issuing mutation
 * writes this server-built value; heartbeat authorization writes consumedAt in
 * the same transaction as the accepted pose. The epoch need not be secret:
 * possession is useless without the matching, unconsumed database row.
 */
export type PresenceRelocationGrant = {
  userId: string;
  epoch: string;
  x: string;
  y: string;
  z: string;
  yaw: string;
  pitch: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string;
};

export type PresenceTrajectoryDecision =
  | {
      accept: true;
      reason: "initial_spawn" | "online_motion" | "persisted_reconnect" | "approved_relocation";
      /** Persist this update atomically with an approved relocation pose. */
      relocationGrantUpdate: PresenceRelocationGrant | null;
    }
  | {
      accept: false;
      reason:
        | "invalid_server_time"
        | "initial_spawn_required"
        | "invalid_persisted_pose"
        | "persisted_pose_required"
        | "displacement_exceeded"
        | "relocation_missing"
        | "relocation_invalid"
        | "relocation_user_mismatch"
        | "relocation_epoch_mismatch"
        | "relocation_replayed"
        | "relocation_expired"
        | "relocation_destination_mismatch";
    };

const MAX_NUMERIC_FIELD_LENGTH = 32;

function parseBoundedNumber(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_NUMERIC_FIELD_LENGTH) return null;
  // Allow ordinary JavaScript decimal/exponent serialization (and harmless
  // surrounding whitespace), but reject alternate spellings such as hex.
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function parseServerTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,16}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function posesExactlyMatch(left: ValidatedPresencePose, right: ValidatedPresencePose): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.z === right.z
    && left.yaw === right.yaw
    && left.pitch === right.pitch;
}

function parseStoredPose(value: Pick<PresenceTrajectoryRecord, "x" | "y" | "z" | "yaw" | "pitch">) {
  return validatePresencePoseFields(value.x, value.y, value.z, value.yaw, value.pitch);
}

/**
 * Creates the only valid relocation shape. Callers supply an epoch from
 * server-owned state (for example, the next decimal epoch on the user's single
 * grant row) and a destination that was independently approved by a death,
 * bed, or admin mutation.
 */
export function buildPresenceRelocationGrant(
  userId: string,
  epoch: string,
  destination: ValidatedPresencePose,
  serverNow: number,
  lifetimeMs = PRESENCE_RELOCATION_MAX_LIFETIME_MS,
): PresenceRelocationGrant | null {
  if (!userId || userId.length > 256 || !/^\d{1,16}$/.test(epoch)) return null;
  if (!Number.isSafeInteger(serverNow) || serverNow < 0) return null;
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > PRESENCE_RELOCATION_MAX_LIFETIME_MS) {
    return null;
  }
  const validatedDestination = validatePresencePoseFields(
    String(destination.x),
    String(destination.y),
    String(destination.z),
    String(destination.yaw),
    String(destination.pitch),
  );
  if (!validatedDestination) return null;
  return {
    userId,
    epoch,
    x: String(validatedDestination.x),
    y: String(validatedDestination.y),
    z: String(validatedDestination.z),
    yaw: String(validatedDestination.yaw),
    pitch: String(validatedDestination.pitch),
    issuedAt: String(serverNow),
    expiresAt: String(serverNow + lifetimeMs),
  };
}

/**
 * Pure movement/relocation authority for heartbeat integration. Lakebed's
 * serialized mutation transaction must read the presence and active grant,
 * call this function, then persist both the pose and relocationGrantUpdate.
 */
export function decidePresenceTrajectory(
  userId: string,
  existing: PresenceTrajectoryRecord | null,
  requestedPose: ValidatedPresencePose,
  serverNow: number,
  trustedInitialPose: ValidatedPresencePose | null = null,
  presentedRelocationEpoch: string | null = null,
  activeRelocationGrant: PresenceRelocationGrant | null = null,
): PresenceTrajectoryDecision {
  if (!Number.isSafeInteger(serverNow) || serverNow < 0) {
    return { accept: false, reason: "invalid_server_time" };
  }

  if (presentedRelocationEpoch !== null) {
    const grant = activeRelocationGrant;
    if (!grant) return { accept: false, reason: "relocation_missing" };
    if (grant.userId !== userId) return { accept: false, reason: "relocation_user_mismatch" };
    if (!/^\d{1,16}$/.test(presentedRelocationEpoch) || presentedRelocationEpoch !== grant.epoch) {
      return { accept: false, reason: "relocation_epoch_mismatch" };
    }
    if (grant.consumedAt !== undefined) return { accept: false, reason: "relocation_replayed" };
    const issuedAt = parseServerTimestamp(grant.issuedAt);
    const expiresAt = parseServerTimestamp(grant.expiresAt);
    const destination = parseStoredPose(grant);
    if (
      issuedAt === null
      || expiresAt === null
      || !destination
      || expiresAt <= issuedAt
      || expiresAt - issuedAt > PRESENCE_RELOCATION_MAX_LIFETIME_MS
      || serverNow < issuedAt
    ) {
      return { accept: false, reason: "relocation_invalid" };
    }
    if (serverNow >= expiresAt) return { accept: false, reason: "relocation_expired" };
    if (!posesExactlyMatch(requestedPose, destination)) {
      return { accept: false, reason: "relocation_destination_mismatch" };
    }
    return {
      accept: true,
      reason: "approved_relocation",
      relocationGrantUpdate: { ...grant, consumedAt: String(serverNow) },
    };
  }

  if (!existing) {
    if (!trustedInitialPose || !posesExactlyMatch(requestedPose, trustedInitialPose)) {
      return { accept: false, reason: "initial_spawn_required" };
    }
    return { accept: true, reason: "initial_spawn", relocationGrantUpdate: null };
  }
  if (existing.userId !== userId) return { accept: false, reason: "invalid_persisted_pose" };
  const previousPose = parseStoredPose(existing);
  if (!previousPose) return { accept: false, reason: "invalid_persisted_pose" };
  const exactPersistedPose = posesExactlyMatch(requestedPose, previousPose);
  const previousHeartbeatAt = parseServerTimestamp(existing.heartbeatAt);

  if (!existing.online || previousHeartbeatAt === null) {
    return exactPersistedPose
      ? { accept: true, reason: "persisted_reconnect", relocationGrantUpdate: null }
      : { accept: false, reason: "persisted_pose_required" };
  }

  const elapsedMs = serverNow - previousHeartbeatAt;
  if (elapsedMs < 0 || elapsedMs > PRESENCE_TRAJECTORY_MAX_ELAPSED_MS) {
    return exactPersistedPose
      ? { accept: true, reason: "persisted_reconnect", relocationGrantUpdate: null }
      : { accept: false, reason: "persisted_pose_required" };
  }
  const elapsedSeconds = elapsedMs / 1_000;
  const horizontalDistance = Math.hypot(requestedPose.x - previousPose.x, requestedPose.z - previousPose.z);
  const verticalDistance = Math.abs(requestedPose.y - previousPose.y);
  if (
    horizontalDistance > PRESENCE_TRAJECTORY_HORIZONTAL_SLACK
      + PRESENCE_MAX_HORIZONTAL_SPEED * elapsedSeconds
      + PRESENCE_TRAJECTORY_COMPARISON_EPSILON
    || verticalDistance > PRESENCE_TRAJECTORY_VERTICAL_SLACK
      + PRESENCE_MAX_VERTICAL_SPEED * elapsedSeconds
      + PRESENCE_TRAJECTORY_COMPARISON_EPSILON
  ) {
    return { accept: false, reason: "displacement_exceeded" };
  }
  return { accept: true, reason: "online_motion", relocationGrantUpdate: null };
}

/** Strictly validates the server-owned spatial envelope before a row write. */
export function validatePresencePoseFields(
  rawX: unknown,
  rawY: unknown,
  rawZ: unknown,
  rawYaw: unknown,
  rawPitch: unknown,
): ValidatedPresencePose | null {
  const x = parseBoundedNumber(rawX, PRESENCE_MIN_X, PRESENCE_MAX_X);
  const y = parseBoundedNumber(rawY, PRESENCE_MIN_Y, PRESENCE_MAX_Y);
  const z = parseBoundedNumber(rawZ, PRESENCE_MIN_Z, PRESENCE_MAX_Z);
  const yaw = parseBoundedNumber(rawYaw, -PRESENCE_MAX_YAW, PRESENCE_MAX_YAW);
  const pitch = parseBoundedNumber(rawPitch, -PRESENCE_MAX_PITCH, PRESENCE_MAX_PITCH);
  return x === null || y === null || z === null || yaw === null || pitch === null
    ? null
    : { x, y, z, yaw, pitch };
}

/**
 * Server-authoritative per-user heartbeat gate. The stored heartbeat is the
 * previous server timestamp, never a client claim. Malformed legacy values are
 * accepted once so the next write heals the row. A future stored timestamp is
 * likewise healed immediately; clients cannot author this server-owned field.
 */
export function decidePresenceWriteGate(
  existingHeartbeatAt: unknown,
  serverNow: number,
): PresenceWriteGateDecision {
  if (!Number.isFinite(serverNow)) {
    return { accept: false, retryAfterMs: PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS };
  }
  if (typeof existingHeartbeatAt !== "string" || !/^\d{1,16}$/.test(existingHeartbeatAt)) {
    return { accept: true, retryAfterMs: 0 };
  }
  const previous = Number(existingHeartbeatAt);
  if (!Number.isFinite(previous)) return { accept: true, retryAfterMs: 0 };
  const elapsed = serverNow - previous;
  if (elapsed < 0) return { accept: true, retryAfterMs: 0 };
  if (elapsed >= PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS) {
    return { accept: true, retryAfterMs: 0 };
  }
  return {
    accept: false,
    retryAfterMs: Math.ceil(PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS - elapsed),
  };
}

/**
 * Builds the only server-authoritative leave transition. Client timestamps and
 * poses are deliberately absent from this API: leaving preserves the latest
 * accepted pose and only expires motion/the online lease.
 */
export function buildOfflinePresenceValue(
  existing: StoredPlayerPresence,
  serverNow: number,
): OfflinePlayerPresenceValue {
  return {
    userId: existing.userId,
    displayName: existing.displayName,
    color: existing.color,
    x: existing.x,
    y: existing.y,
    z: existing.z,
    yaw: existing.yaw,
    pitch: existing.pitch,
    heldItem: existing.heldItem ?? "",
    armorHead: existing.armorHead ?? "",
    armorChest: existing.armorChest ?? "",
    armorLegs: existing.armorLegs ?? "",
    armorFeet: existing.armorFeet ?? "",
    vx: "0",
    vy: "0",
    vz: "0",
    heartbeatAt: String(serverNow),
    online: false,
  };
}
