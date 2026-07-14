import {
  PRESENCE_MAX_PITCH,
  PRESENCE_MAX_X,
  PRESENCE_MAX_Y,
  PRESENCE_MAX_YAW,
  PRESENCE_MAX_Z,
  PRESENCE_MIN_X,
  PRESENCE_MIN_Y,
  PRESENCE_MIN_Z,
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
    vx: "0",
    vy: "0",
    vz: "0",
    heartbeatAt: String(serverNow),
    online: false,
  };
}
