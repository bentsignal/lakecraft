/**
 * Quota-aware shared-player motion protocol.
 *
 * Lakebed's anonymous mutation allowance is intentionally tight. Presence is
 * therefore a sparse, velocity-aware snapshot stream rather than a realtime
 * socket feed. The scheduler is a deterministic leaky bucket: no two writes
 * can be closer than 7.5 seconds, so every half-open 60 second window contains
 * at most eight writes even when the player or camera is adversarial.
 */

export const PRESENCE_MAX_WRITES_PER_MINUTE = 8;
export const PRESENCE_MIN_WRITE_INTERVAL_MS = 60_000 / PRESENCE_MAX_WRITES_PER_MINUTE;
export const PRESENCE_LEASE_REFRESH_MS = 10_000;
export const PRESENCE_ACTIVE_LEASE_MS = 15_000;
export const PRESENCE_MAX_HORIZONTAL_SPEED = 14;
export const PRESENCE_MAX_VERTICAL_SPEED = 24;
export const PRESENCE_VELOCITY_QUANTUM = 0.05;
export const PRESENCE_MOVING_SPEED = 0.15;
export const PRESENCE_MAJOR_HEADING_RADIANS = Math.PI / 3;
export const PRESENCE_POSITION_CORRECTION_DISTANCE = 2;
/** Horizontal dead reckoning bridges most of a 7.5s write interval. */
export const PRESENCE_MAX_EXTRAPOLATION_MS = 5_000;
/** Vertical prediction stays short so a missed landing update cannot float. */
export const PRESENCE_MAX_VERTICAL_EXTRAPOLATION_MS = 500;
export const PRESENCE_VELOCITY_FIELD_MAX_CHARS = 12;
export const PRESENCE_MOTION_PAYLOAD_MAX_CHARS = 128;

export const PRESENCE_MIN_X = -128;
export const PRESENCE_MAX_X = 128;
export const PRESENCE_MIN_Y = -32;
export const PRESENCE_MAX_Y = 128;
export const PRESENCE_MIN_Z = -128;
export const PRESENCE_MAX_Z = 128;
export const PRESENCE_MAX_YAW = 100_000;
export const PRESENCE_MAX_PITCH = 2;

const SAMPLE_POSITION_LIMIT = 1_000_000;
const SAMPLE_ANGLE_LIMIT = Math.PI * 100_000;

export interface PresencePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface PresencePoseSample extends PresencePose {
  /** Monotonic or wall-clock sample timestamp in milliseconds. */
  at: number;
}

export interface PresenceVelocity {
  vx: number;
  vy: number;
  vz: number;
}

export interface PresenceVelocityFields {
  vx: string;
  vy: string;
  vz: string;
}

export interface PresenceVelocityFieldsLike {
  vx?: unknown;
  vy?: unknown;
  vz?: unknown;
  /** Accepted aliases make experimental pre-v1 rows safe to read. */
  velocityX?: unknown;
  velocityY?: unknown;
  velocityZ?: unknown;
}

export interface PresencePoseFieldsLike {
  x?: unknown;
  y?: unknown;
  z?: unknown;
  yaw?: unknown;
  pitch?: unknown;
}

export type PresenceSendReason =
  | "join"
  | "motion_stop"
  | "motion_start"
  | "heading"
  | "correction"
  | "lease";

export interface PresenceSchedulerState {
  lastWriteAt: number | null;
  lastWrittenPose: PresencePose | null;
  lastObservedSample: PresencePoseSample | null;
  velocity: PresenceVelocity;
  lastWrittenMoving: boolean;
  writeCount: number;
}

export type PresenceSendDecision =
  | {
      send: true;
      reason: PresenceSendReason;
      velocity: PresenceVelocity;
      fields: PresenceVelocityFields;
      waitMs: 0;
    }
  | {
      send: false;
      /** Highest-priority event waiting behind the rate gate, if any. */
      reason: PresenceSendReason | null;
      velocity: PresenceVelocity;
      waitMs: number;
    };

const ZERO_VELOCITY: Readonly<PresenceVelocity> = Object.freeze({ vx: 0, vy: 0, vz: 0 });

function finiteWithin(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

function isValidSample(sample: PresencePoseSample): boolean {
  return finiteWithin(sample.x, SAMPLE_POSITION_LIMIT)
    && finiteWithin(sample.y, SAMPLE_POSITION_LIMIT)
    && finiteWithin(sample.z, SAMPLE_POSITION_LIMIT)
    && finiteWithin(sample.yaw, SAMPLE_ANGLE_LIMIT)
    && finiteWithin(sample.pitch, SAMPLE_ANGLE_LIMIT)
    && Number.isFinite(sample.at);
}

function quantize(value: number): number {
  const rounded = Math.round(value / PRESENCE_VELOCITY_QUANTUM) * PRESENCE_VELOCITY_QUANTUM;
  if (Math.abs(rounded) < PRESENCE_VELOCITY_QUANTUM / 2) return 0;
  return Number(rounded.toFixed(2));
}

function quantizeTowardZero(value: number): number {
  const steps = Math.floor(Math.abs(value) / PRESENCE_VELOCITY_QUANTUM + 1e-9);
  return Number((Math.sign(value) * steps * PRESENCE_VELOCITY_QUANTUM).toFixed(2));
}

function boundedVelocity(vx: number, vy: number, vz: number): PresenceVelocity {
  const horizontalSpeed = Math.hypot(vx, vz);
  const horizontalScale = horizontalSpeed > PRESENCE_MAX_HORIZONTAL_SPEED
    ? PRESENCE_MAX_HORIZONTAL_SPEED / horizontalSpeed
    : 1;
  let safeVx = quantize(vx * horizontalScale);
  let safeVz = quantize(vz * horizontalScale);
  const quantizedSpeed = Math.hypot(safeVx, safeVz);
  // Component rounding can put a diagonal vector a few thousandths above the
  // magnitude cap. A second inward-only quantization makes the invariant exact.
  if (quantizedSpeed > PRESENCE_MAX_HORIZONTAL_SPEED) {
    const inwardScale = PRESENCE_MAX_HORIZONTAL_SPEED / quantizedSpeed;
    safeVx = quantizeTowardZero(safeVx * inwardScale);
    safeVz = quantizeTowardZero(safeVz * inwardScale);
  }
  return {
    vx: safeVx,
    vy: quantize(Math.max(-PRESENCE_MAX_VERTICAL_SPEED, Math.min(PRESENCE_MAX_VERTICAL_SPEED, vy))),
    vz: safeVz,
  };
}

/** Computes a quantized, magnitude-bounded velocity from two local samples. */
export function computePresenceVelocity(
  previous: PresencePoseSample | null,
  next: PresencePoseSample,
): PresenceVelocity {
  if (!previous || !isValidSample(previous) || !isValidSample(next)) return { ...ZERO_VELOCITY };
  const elapsedSeconds = (next.at - previous.at) / 1_000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return { ...ZERO_VELOCITY };
  return boundedVelocity(
    (next.x - previous.x) / elapsedSeconds,
    (next.y - previous.y) / elapsedSeconds,
    (next.z - previous.z) / elapsedSeconds,
  );
}

function parseFiniteField(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text.length > PRESENCE_VELOCITY_FIELD_MAX_CHARS) return null;
  // Exponent notation and non-decimal spellings are unnecessary on the wire
  // and make payload/cost reasoning harder.
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePersistedNumber(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text.length > 32) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

/** Strict, server-compatible parser for reconnecting at the last known pose. */
export function parsePersistedPresencePose(row: PresencePoseFieldsLike): PresencePose | null {
  const x = parsePersistedNumber(row.x, PRESENCE_MIN_X, PRESENCE_MAX_X);
  const y = parsePersistedNumber(row.y, PRESENCE_MIN_Y, PRESENCE_MAX_Y);
  const z = parsePersistedNumber(row.z, PRESENCE_MIN_Z, PRESENCE_MAX_Z);
  const yaw = parsePersistedNumber(row.yaw, -PRESENCE_MAX_YAW, PRESENCE_MAX_YAW);
  const pitch = parsePersistedNumber(row.pitch, -PRESENCE_MAX_PITCH, PRESENCE_MAX_PITCH);
  return x == null || y == null || z == null || yaw == null || pitch == null
    ? null
    : { x, y, z, yaw, pitch };
}

/**
 * Strict server-side parser. Over-limit client claims are rejected instead of
 * being trusted for dead reckoning.
 */
export function validatePresenceVelocityFields(
  rawVx: unknown,
  rawVy: unknown,
  rawVz: unknown,
): PresenceVelocity | null {
  const vx = parseFiniteField(rawVx);
  const vy = parseFiniteField(rawVy);
  const vz = parseFiniteField(rawVz);
  if (vx == null || vy == null || vz == null) return null;
  if (Math.abs(vy) > PRESENCE_MAX_VERTICAL_SPEED) return null;
  if (Math.hypot(vx, vz) > PRESENCE_MAX_HORIZONTAL_SPEED + PRESENCE_VELOCITY_QUANTUM / 2) return null;
  return boundedVelocity(vx, vy, vz);
}

/** Legacy rows (or malformed new rows) deliberately render as stationary. */
export function parsePresenceVelocityFields(row: PresenceVelocityFieldsLike): PresenceVelocity {
  const rawVx = row.vx ?? row.velocityX;
  const rawVy = row.vy ?? row.velocityY;
  const rawVz = row.vz ?? row.velocityZ;
  if (rawVx === undefined && rawVy === undefined && rawVz === undefined) return { ...ZERO_VELOCITY };
  return validatePresenceVelocityFields(rawVx, rawVy, rawVz) ?? { ...ZERO_VELOCITY };
}

/** Canonical compact decimal fields for the Lakebed mutation and row. */
export function encodePresenceVelocityFields(velocity: PresenceVelocity): PresenceVelocityFields {
  const safe = Number.isFinite(velocity.vx) && Number.isFinite(velocity.vy) && Number.isFinite(velocity.vz)
    ? boundedVelocity(velocity.vx, velocity.vy, velocity.vz)
    : { ...ZERO_VELOCITY };
  return { vx: String(safe.vx), vy: String(safe.vy), vz: String(safe.vz) };
}

export function createPresenceSchedulerState(): PresenceSchedulerState {
  return {
    lastWriteAt: null,
    lastWrittenPose: null,
    lastObservedSample: null,
    velocity: { ...ZERO_VELOCITY },
    lastWrittenMoving: false,
    writeCount: 0,
  };
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function currentReason(
  state: PresenceSchedulerState,
  sample: PresencePoseSample,
  moving: boolean,
): PresenceSendReason | null {
  if (state.lastWriteAt == null || !state.lastWrittenPose) return "join";
  if (moving !== state.lastWrittenMoving) return moving ? "motion_start" : "motion_stop";
  if (Math.abs(shortestAngleDelta(state.lastWrittenPose.yaw, sample.yaw)) >= PRESENCE_MAJOR_HEADING_RADIANS) {
    return "heading";
  }
  if (Math.hypot(
    sample.x - state.lastWrittenPose.x,
    sample.y - state.lastWrittenPose.y,
    sample.z - state.lastWrittenPose.z,
  ) >= PRESENCE_POSITION_CORRECTION_DISTANCE) {
    return "correction";
  }
  if (sample.at - state.lastWriteAt >= PRESENCE_LEASE_REFRESH_MS) return "lease";
  return null;
}

/**
 * Mutates a small ref-friendly state object and returns whether to write this
 * sample. The first valid sample always joins; all later writes pass through
 * the same 7.5 second rate gate, including stop/turn corrections.
 */
export function stepPresenceScheduler(
  state: PresenceSchedulerState,
  sample: PresencePoseSample,
): PresenceSendDecision {
  if (!isValidSample(sample)) {
    return { send: false, reason: null, velocity: { ...state.velocity }, waitMs: PRESENCE_LEASE_REFRESH_MS };
  }

  const velocity = computePresenceVelocity(state.lastObservedSample, sample);
  state.lastObservedSample = { ...sample };
  state.velocity = velocity;
  const moving = Math.hypot(velocity.vx, velocity.vy, velocity.vz) >= PRESENCE_MOVING_SPEED;
  const reason = currentReason(state, sample, moving);

  if (state.lastWriteAt != null) {
    const sinceWrite = Math.max(0, sample.at - state.lastWriteAt);
    const gateWait = Math.max(0, PRESENCE_MIN_WRITE_INTERVAL_MS - sinceWrite);
    if (reason && gateWait > 0) {
      return { send: false, reason, velocity: { ...velocity }, waitMs: gateWait };
    }
    if (!reason) {
      const leaseWait = Math.max(0, PRESENCE_LEASE_REFRESH_MS - sinceWrite);
      return { send: false, reason: null, velocity: { ...velocity }, waitMs: leaseWait };
    }
  }

  const fields = encodePresenceVelocityFields(velocity);
  state.lastWriteAt = sample.at;
  state.lastWrittenPose = {
    x: sample.x,
    y: sample.y,
    z: sample.z,
    yaw: sample.yaw,
    pitch: sample.pitch,
  };
  state.lastWrittenMoving = moving;
  state.writeCount += 1;
  return { send: true, reason: reason ?? "join", velocity: { ...velocity }, fields, waitMs: 0 };
}

/** Bounded dead-reckoning horizon shared by renderer and deterministic tests. */
export function presenceExtrapolationSeconds(snapshotAgeMs: number): number {
  if (!Number.isFinite(snapshotAgeMs) || snapshotAgeMs <= 0) return 0;
  return Math.min(snapshotAgeMs, PRESENCE_MAX_EXTRAPOLATION_MS) / 1_000;
}
