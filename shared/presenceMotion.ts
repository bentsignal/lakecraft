/**
 * Quota-aware shared-player motion protocol.
 *
 * Lakebed remains the only multiplayer transport. Presence uses an adaptive
 * cadence: a compact 5 Hz stream while another player is actually present,
 * followed by a sparse lease keepalive for solo play. The deterministic rate
 * gate keeps the client budget measurable even when input is adversarial.
 */

export const PRESENCE_ACTIVE_WRITES_PER_SECOND = 5;
export const PRESENCE_ACTIVE_WRITE_INTERVAL_MS = 1_000 / PRESENCE_ACTIVE_WRITES_PER_SECOND;
/** Existing consumers use this name for the global scheduler rate gate. */
export const PRESENCE_MIN_WRITE_INTERVAL_MS = PRESENCE_ACTIVE_WRITE_INTERVAL_MS;
export const PRESENCE_MAX_WRITES_PER_MINUTE = PRESENCE_ACTIVE_WRITES_PER_SECOND * 60;
/**
 * Lakebed's currently claimed anonymous-tier envelope is deployment-wide, not
 * a realtime-game allowance. The browser cannot coordinate every visitor, so
 * it budgets the common two-player session conservatively: 450 presence calls
 * per participant leaves 100 of the claimed 1,000 daily mutations for chat,
 * inventory, world edits, combat, joins, and leaves.
 */
export const PRESENCE_CLAIMED_MUTATIONS_PER_DAY = 1_000;
export const PRESENCE_CLAIMED_REQUESTS_PER_DAY = 10_000;
export const PRESENCE_EXPECTED_BURST_PLAYERS = 2;
export const PRESENCE_ACTION_MUTATION_RESERVE = 100;
export const PRESENCE_SESSION_WRITE_BUDGET = Math.floor(
  (PRESENCE_CLAIMED_MUTATIONS_PER_DAY - PRESENCE_ACTION_MUTATION_RESERVE) / PRESENCE_EXPECTED_BURST_PLAYERS,
);
/** One measured minute of 5 Hz movement per participant, then sparse lease mode. */
export const PRESENCE_REALTIME_BURST_WRITES = PRESENCE_ACTIVE_WRITES_PER_SECOND * 60;
export const PRESENCE_MAX_ACTIVE_WRITES_PER_DAY = PRESENCE_SESSION_WRITE_BUDGET;
/** Sample more often than the write cadence so input changes are queued quickly. */
export const PRESENCE_SAMPLE_INTERVAL_MS = 50;
/** Keep publication bounded while allowing one slow Lakebed round trip to overlap the next write. */
export const PRESENCE_MAX_IN_FLIGHT_WRITES = 2;
/** Server guard allows ordinary scheduler/network jitter but caps direct spam. */
export const PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS = 150;
export const PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_MINUTE = Math.ceil(
  60_000 / PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS,
);
export const PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_DAY =
  PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_MINUTE * 60 * 24;
export const PRESENCE_LEASE_REFRESH_MS = 60_000;
export const PRESENCE_ACTIVE_LEASE_MS = 90_000;
export const PRESENCE_IDLE_WRITES_PER_MINUTE = 60_000 / PRESENCE_LEASE_REFRESH_MS;
export const PRESENCE_MAX_IDLE_WRITES_PER_DAY = Math.min(
  PRESENCE_IDLE_WRITES_PER_MINUTE * 60 * 24,
  PRESENCE_SESSION_WRITE_BUDGET,
);
export const PRESENCE_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const PRESENCE_FAILURE_BACKOFF_BASE_MS = 1_000;
export const PRESENCE_FAILURE_BACKOFF_MAX_MS = 60_000;
/** Generic production rejection text becomes terminal after this many failures. */
export const PRESENCE_GENERIC_REJECTION_LIMIT = 3;
/** Keep turning active briefly so the final camera orientation is persisted. */
export const PRESENCE_ACTIVITY_LINGER_MS = PRESENCE_ACTIVE_WRITE_INTERVAL_MS * 2;
export const PRESENCE_TURNING_RADIANS_PER_SECOND = Math.PI / 18;
export const PRESENCE_MAX_HORIZONTAL_SPEED = 14;
export const PRESENCE_MAX_VERTICAL_SPEED = 24;
export const PRESENCE_VELOCITY_QUANTUM = 0.05;
export const PRESENCE_MOVING_SPEED = 0.15;
export const PRESENCE_MAJOR_HEADING_RADIANS = Math.PI / 3;
export const PRESENCE_POSITION_CORRECTION_DISTANCE = 2;
/** A short prediction horizon smooths ordinary 5 Hz network jitter. */
export const PRESENCE_MAX_EXTRAPOLATION_MS = 750;
/** Vertical prediction stays short so a missed landing update cannot float. */
export const PRESENCE_MAX_VERTICAL_EXTRAPOLATION_MS = 300;
export const PRESENCE_VELOCITY_FIELD_MAX_CHARS = 12;
export const PRESENCE_MOTION_PAYLOAD_MAX_CHARS = 128;

/** Keep the shared pose envelope aligned with persisted streamed-world edits. */
export const PRESENCE_MIN_X = -1_000_000;
export const PRESENCE_MAX_X = 1_000_000;
/** Player feet cannot enter the y=0 bedrock foundation. */
export const PRESENCE_MIN_Y = 1;
export const PRESENCE_MAX_Y = 128;
export const PRESENCE_MIN_Z = -1_000_000;
export const PRESENCE_MAX_Z = 1_000_000;
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
  | "active"
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
  /**
   * Solo mode normally publishes only its lease. Vertical direction edges are
   * the exception: Lakebed's authoritative fall reducer must see takeoff,
   * apex, and landing even when no remote player is currently visible.
   */
  lastWrittenVerticalMode: PresenceVerticalMode;
  activeUntilAt: number;
  writeCount: number;
}

export type PresenceVerticalMode = "up" | "down" | "still";

export type PresenceTransportMode =
  | "solo"
  | "burst"
  | "degraded"
  | "backoff"
  | "quota_paused"
  | "budget_exhausted";

export type PresenceTransportErrorKind = "quota" | "transient";

/** Persist this small record per signed-in user so reloads cannot reset the daily envelope. */
export interface PresenceBurstGuardState {
  windowStartedAt: number;
  attemptCount: number;
  confirmedCount: number;
  realtimeAttemptCount: number;
  consecutiveFailures: number;
  blockedUntilAt: number;
  quotaPaused: boolean;
}

export interface PresenceBurstGuardSnapshot {
  mode: PresenceTransportMode;
  cadenceHz: number;
  canAttempt: boolean;
  sessionRemaining: number;
  realtimeRemaining: number;
  confirmedCount: number;
  attemptCount: number;
  retryInMs: number;
  windowResetsInMs: number;
}

export type PresenceSendDecision =
  | {
      send: true;
      reason: PresenceSendReason;
      /** Vertical direction edge that must be delivered in order for fall authority. */
      safetyCritical: boolean;
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

function freshPresenceBurstGuardState(now: number): PresenceBurstGuardState {
  return {
    windowStartedAt: now,
    attemptCount: 0,
    confirmedCount: 0,
    realtimeAttemptCount: 0,
    consecutiveFailures: 0,
    blockedUntilAt: 0,
    quotaPaused: false,
  };
}

function isValidGuardCount(value: unknown, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

/** Creates or strictly hydrates a browser-day transport budget. */
export function createPresenceBurstGuardState(
  now: number,
  persisted?: Partial<PresenceBurstGuardState> | null,
): PresenceBurstGuardState {
  if (!Number.isFinite(now)) now = 0;
  if (!persisted
    || !Number.isFinite(persisted.windowStartedAt)
    || persisted.windowStartedAt! > now
    || !isValidGuardCount(persisted.attemptCount, PRESENCE_SESSION_WRITE_BUDGET)
    || !isValidGuardCount(persisted.confirmedCount, PRESENCE_SESSION_WRITE_BUDGET)
    || persisted.confirmedCount! > persisted.attemptCount!
    || !isValidGuardCount(persisted.realtimeAttemptCount, PRESENCE_REALTIME_BURST_WRITES)
    || !isValidGuardCount(persisted.consecutiveFailures, PRESENCE_GENERIC_REJECTION_LIMIT)
    || !Number.isFinite(persisted.blockedUntilAt)
    || typeof persisted.quotaPaused !== "boolean") {
    return freshPresenceBurstGuardState(now);
  }
  if (now - persisted.windowStartedAt! >= PRESENCE_BUDGET_WINDOW_MS) {
    const fresh = freshPresenceBurstGuardState(now);
    if (persisted.quotaPaused && persisted.blockedUntilAt! > now) {
      fresh.quotaPaused = true;
      fresh.blockedUntilAt = persisted.blockedUntilAt!;
    }
    return fresh;
  }
  return {
    windowStartedAt: persisted.windowStartedAt!,
    attemptCount: persisted.attemptCount!,
    confirmedCount: persisted.confirmedCount!,
    realtimeAttemptCount: persisted.realtimeAttemptCount!,
    consecutiveFailures: persisted.consecutiveFailures!,
    blockedUntilAt: persisted.blockedUntilAt!,
    quotaPaused: persisted.quotaPaused!,
  };
}

function refreshPresenceBurstGuardWindow(state: PresenceBurstGuardState, now: number): void {
  if (Number.isFinite(now) && now < state.windowStartedAt) {
    Object.assign(state, freshPresenceBurstGuardState(now));
  } else if (Number.isFinite(now) && now - state.windowStartedAt >= PRESENCE_BUDGET_WINDOW_MS) {
    const quotaBlockedUntilAt = state.quotaPaused ? state.blockedUntilAt : 0;
    Object.assign(state, freshPresenceBurstGuardState(now));
    if (quotaBlockedUntilAt > now) {
      state.quotaPaused = true;
      state.blockedUntilAt = quotaBlockedUntilAt;
    }
  } else if (state.quotaPaused && Number.isFinite(now) && now >= state.blockedUntilAt) {
    // Keep the 50 ms sampler alive but resume through the same guarded Lakebed
    // heartbeat path as soon as Retry-After/reset says the bucket recovered.
    state.quotaPaused = false;
    state.consecutiveFailures = 0;
    state.blockedUntilAt = 0;
  }
}

export function presenceBurstGuardSnapshot(
  state: PresenceBurstGuardState,
  now: number,
  hasRemotePlayer: boolean,
): PresenceBurstGuardSnapshot {
  refreshPresenceBurstGuardWindow(state, now);
  const sessionRemaining = Math.max(0, PRESENCE_SESSION_WRITE_BUDGET - state.attemptCount);
  const realtimeRemaining = Math.max(0, PRESENCE_REALTIME_BURST_WRITES - state.realtimeAttemptCount);
  const windowResetsInMs = Math.max(0, state.windowStartedAt + PRESENCE_BUDGET_WINDOW_MS - now);
  const retryInMs = Math.max(0, state.blockedUntilAt - now);
  let mode: PresenceTransportMode;
  if (sessionRemaining === 0) mode = "budget_exhausted";
  else if (state.quotaPaused) mode = "quota_paused";
  else if (retryInMs > 0) mode = "backoff";
  else if (!hasRemotePlayer) mode = "solo";
  else if (realtimeRemaining > 0) mode = "burst";
  else mode = "degraded";
  return {
    mode,
    cadenceHz: mode === "burst"
      ? PRESENCE_ACTIVE_WRITES_PER_SECOND
      : mode === "solo" || mode === "degraded"
        ? PRESENCE_IDLE_WRITES_PER_MINUTE / 60
        : 0,
    canAttempt: sessionRemaining > 0 && !state.quotaPaused && retryInMs === 0,
    sessionRemaining,
    realtimeRemaining,
    confirmedCount: state.confirmedCount,
    attemptCount: state.attemptCount,
    retryInMs,
    windowResetsInMs,
  };
}

/** Reserves one Lakebed request before starting it; rejected calls still cost request budget. */
export function reservePresenceAttempt(
  state: PresenceBurstGuardState,
  now: number,
  realtime: boolean,
): boolean {
  const snapshot = presenceBurstGuardSnapshot(state, now, realtime);
  if (!snapshot.canAttempt || (realtime && snapshot.realtimeRemaining === 0)) return false;
  state.attemptCount += 1;
  if (realtime) state.realtimeAttemptCount += 1;
  return true;
}

export function recordPresenceSuccess(state: PresenceBurstGuardState, now: number): void {
  refreshPresenceBurstGuardWindow(state, now);
  // With two bounded requests in flight, an earlier success can settle after a
  // sibling has already reported deployment quota exhaustion. The quota pause
  // must dominate that late settlement until its explicit reset deadline.
  if (state.quotaPaused) return;
  state.confirmedCount = Math.min(state.attemptCount, state.confirmedCount + 1);
  state.consecutiveFailures = 0;
  state.blockedUntilAt = 0;
}

/** Quota-like errors pause immediately; three opaque rejections stop a retry storm. */
export function recordPresenceFailure(
  state: PresenceBurstGuardState,
  now: number,
  kind: PresenceTransportErrorKind,
  quotaResetAt?: number | null,
): void {
  refreshPresenceBurstGuardWindow(state, now);
  if (state.quotaPaused) {
    if (kind === "quota" && typeof quotaResetAt === "number" && Number.isFinite(quotaResetAt) && quotaResetAt > now) {
      state.blockedUntilAt = Math.max(state.blockedUntilAt, quotaResetAt);
    }
    return;
  }
  state.consecutiveFailures = Math.min(PRESENCE_GENERIC_REJECTION_LIMIT, state.consecutiveFailures + 1);
  if (kind === "quota" || state.consecutiveFailures >= PRESENCE_GENERIC_REJECTION_LIMIT) {
    state.quotaPaused = true;
    const browserWindowResetAt = state.windowStartedAt + PRESENCE_BUDGET_WINDOW_MS;
    state.blockedUntilAt = kind === "quota" && typeof quotaResetAt === "number"
      && Number.isFinite(quotaResetAt) && quotaResetAt > now
      ? quotaResetAt
      : browserWindowResetAt;
    return;
  }
  const backoffMs = Math.min(
    PRESENCE_FAILURE_BACKOFF_MAX_MS,
    PRESENCE_FAILURE_BACKOFF_BASE_MS * (2 ** (state.consecutiveFailures - 1)),
  );
  state.blockedUntilAt = now + backoffMs;
}

/** A server cadence rejection is expected jitter, not evidence of a quota storm. */
export function recordPresenceRateLimit(
  state: PresenceBurstGuardState,
  now: number,
  retryAfterMs: number,
): void {
  refreshPresenceBurstGuardWindow(state, now);
  if (state.quotaPaused) return;
  state.consecutiveFailures = 0;
  state.blockedUntilAt = now + Math.max(
    PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS,
    Math.min(PRESENCE_FAILURE_BACKOFF_MAX_MS, Number.isFinite(retryAfterMs) ? retryAfterMs : 0),
  );
}

export function classifyPresenceTransportError(error: unknown): PresenceTransportErrorKind {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return /(?:429|quota|daily|limit exceeded|resource exhausted|too many requests|mutation limit)/.test(message)
    ? "quota"
    : "transient";
}

/** Extracts a bounded absolute recovery time from common Lakebed 429 shapes. */
export function presenceTransportQuotaResetAt(error: unknown, now: number): number | null {
  if (!Number.isFinite(now)) return null;
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const absoluteCandidates = [record?.resetAt, record?.retryAt];
  for (const candidate of absoluteCandidates) {
    const parsed = typeof candidate === "number"
      ? candidate
      : typeof candidate === "string"
        ? Date.parse(candidate)
        : Number.NaN;
    if (Number.isFinite(parsed) && parsed > now) return Math.min(parsed, now + PRESENCE_BUDGET_WINDOW_MS);
  }
  if (typeof record?.retryAfterMs === "number" && Number.isFinite(record.retryAfterMs) && record.retryAfterMs > 0) {
    return Math.min(now + record.retryAfterMs, now + PRESENCE_BUDGET_WINDOW_MS);
  }
  if (typeof record?.retryAfterSeconds === "number" && Number.isFinite(record.retryAfterSeconds) && record.retryAfterSeconds > 0) {
    return Math.min(now + record.retryAfterSeconds * 1_000, now + PRESENCE_BUDGET_WINDOW_MS);
  }
  const message = String(error instanceof Error ? error.message : error);
  const isoTimestamp = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/)?.[0];
  if (isoTimestamp) {
    const parsed = Date.parse(isoTimestamp);
    if (Number.isFinite(parsed) && parsed > now) return Math.min(parsed, now + PRESENCE_BUDGET_WINDOW_MS);
  }
  const retryAfter = /retry(?:-|\s*)after[^\d]{0,8}(\d{1,10})\s*(ms|milliseconds?|s|seconds?)?/i.exec(message);
  if (retryAfter) {
    const amount = Number(retryAfter[1]);
    const unit = retryAfter[2]?.toLowerCase();
    const milliseconds = !unit || unit.startsWith("s") ? amount * 1_000 : amount;
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      return Math.min(now + milliseconds, now + PRESENCE_BUDGET_WINDOW_MS);
    }
  }
  // Lakebed's current browser transport may retain only the error message and
  // discard structured reset metadata. Hosted daily buckets reset at 00:00 UTC,
  // so this documented control-plane boundary is the safe no-reload fallback.
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export interface PresencePoseAgeSummary {
  count: number;
  p50: number;
  p95: number;
}

/** Bounded observer-side age summary for F3 and deterministic QA. */
export function presencePoseAgePercentiles(ages: readonly number[]): PresencePoseAgeSummary {
  const finite = ages
    .filter((age) => Number.isFinite(age) && age >= 0)
    .map((age) => Math.round(age))
    .sort((left, right) => left - right);
  const at = (fraction: number) => finite[Math.max(0, Math.ceil(finite.length * fraction) - 1)] ?? 0;
  return { count: finite.length, p50: at(0.5), p95: at(0.95) };
}

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
    lastWrittenVerticalMode: "still",
    activeUntilAt: Number.NEGATIVE_INFINITY,
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
  active: boolean,
  realtime: boolean,
  verticalMode: PresenceVerticalMode,
): PresenceSendReason | null {
  if (state.lastWriteAt == null || !state.lastWrittenPose) return "join";
  if (!realtime) {
    if (verticalMode !== state.lastWrittenVerticalMode) {
      return verticalMode === "still" ? "motion_stop" : "motion_start";
    }
    return sample.at - state.lastWriteAt >= PRESENCE_LEASE_REFRESH_MS ? "lease" : null;
  }
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
  if (active) return "active";
  if (sample.at - state.lastWriteAt >= PRESENCE_LEASE_REFRESH_MS) return "lease";
  return null;
}

/**
 * Mutates a small ref-friendly state object and returns whether to write this
 * sample. The first valid sample always joins; all later writes pass through
 * the same 200ms rate gate, including stop/turn corrections. Realtime motion
 * emits at 5 Hz only while another player is present; solo play keeps a sparse
 * lease even while the local player moves.
 */
export function stepPresenceScheduler(
  state: PresenceSchedulerState,
  sample: PresencePoseSample,
  realtime = true,
): PresenceSendDecision {
  if (!isValidSample(sample)) {
    return { send: false, reason: null, velocity: { ...state.velocity }, waitMs: PRESENCE_LEASE_REFRESH_MS };
  }

  const previousObserved = state.lastObservedSample;
  const velocity = computePresenceVelocity(previousObserved, sample);
  const elapsedSeconds = previousObserved ? (sample.at - previousObserved.at) / 1_000 : 0;
  const turningRate = previousObserved && elapsedSeconds > 0
    ? Math.abs(shortestAngleDelta(previousObserved.yaw, sample.yaw)) / elapsedSeconds
    : 0;
  state.lastObservedSample = { ...sample };
  state.velocity = velocity;
  const moving = Math.hypot(velocity.vx, velocity.vy, velocity.vz) >= PRESENCE_MOVING_SPEED;
  const verticalMode: PresenceVerticalMode = velocity.vy >= PRESENCE_MOVING_SPEED
    ? "up"
    : velocity.vy <= -PRESENCE_MOVING_SPEED
      ? "down"
      : "still";
  if (moving || turningRate >= PRESENCE_TURNING_RADIANS_PER_SECOND) {
    state.activeUntilAt = sample.at + PRESENCE_ACTIVITY_LINGER_MS;
  }
  const active = sample.at <= state.activeUntilAt;
  const safetyCritical = verticalMode !== state.lastWrittenVerticalMode;
  const reason = currentReason(state, sample, moving, active, realtime, verticalMode);

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
  state.lastWrittenVerticalMode = verticalMode;
  state.writeCount += 1;
  return {
    send: true,
    reason: reason ?? "join",
    safetyCritical,
    velocity: { ...velocity },
    fields,
    waitMs: 0,
  };
}

/** Bounded dead-reckoning horizon shared by renderer and deterministic tests. */
export function presenceExtrapolationSeconds(snapshotAgeMs: number): number {
  if (!Number.isFinite(snapshotAgeMs) || snapshotAgeMs <= 0) return 0;
  return Math.min(snapshotAgeMs, PRESENCE_MAX_EXTRAPOLATION_MS) / 1_000;
}
