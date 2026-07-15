/**
 * Quota-bounded motion history for Lakecraft's deliberately Lakebed-only
 * multiplayer. Everything in this module is transport-independent and pure so
 * the same validation and replay rules can run on the client and server.
 *
 * Motion is bounded visual evidence. After the server applies its presence
 * trajectory gate, a recent retained final pose may locate a combat target;
 * damage, inventory, blocks, and survival remain separate authenticated
 * mutations and are never derived from visual action claims.
 */

export const LAKEBED_REQUESTS_PER_UTC_DAY = 10_000;
export const LAKEBED_MUTATIONS_PER_UTC_DAY = 1_000;
export const SEGMENT_ACTION_MUTATION_RESERVE = 400;
export const SEGMENT_OTHER_REQUEST_RESERVE = 1_000;
export const SEGMENT_MOTION_MUTATION_BUDGET =
  LAKEBED_MUTATIONS_PER_UTC_DAY - SEGMENT_ACTION_MUTATION_RESERVE;
export const SEGMENT_SNAPSHOT_REQUEST_BUDGET =
  LAKEBED_REQUESTS_PER_UTC_DAY - SEGMENT_OTHER_REQUEST_RESERVE;

export const MOTION_PROTOCOL_VERSION = 1;
export const MOTION_SAMPLE_QUANTUM_MS = 50;
export const MOTION_POSITION_QUANTUM = 1 / 32;
export const MOTION_ANGLE_STEPS_PER_TURN = 1_024;
export const MOTION_MAX_BATCH_DURATION_MS = 30_000;
export const MOTION_MAX_KEYFRAMES = 128;
export const MOTION_MAX_ACTIONS = 64;
export const MOTION_MAX_SEQUENCE = 2_147_483_647;
export const MOTION_MAX_BATCH_CHARS = 16_384;
export const MOTION_MAX_SESSION_ID_CHARS = 48;
export const MOTION_MAX_BATCH_ID_CHARS = 64;
export const MOTION_MAX_COORDINATE = 1_000_000;
export const MOTION_RECEIPT_LIMIT = 32;
export const MOTION_RECEIPT_RETENTION_MS = 15 * 60_000;
export const MOTION_ROW_RETENTION_MS = 15 * 60_000;
export const MOTION_ROWS_PER_PLAYER = 8;
export const REMOTE_INTERPOLATION_BUFFER_MS = 300;
export const REMOTE_MAX_EXTRAPOLATION_MS = 750;
export const REMOTE_STALE_AFTER_MS = 15_000;
export const REMOTE_MAX_CATCH_UP_SPEED = 4;

export interface MotionPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface MotionPoseSample {
  at: number;
  pose: MotionPose;
}

export interface MotionActionSample {
  at: number;
  kind: MotionVisualActionKind;
  value?: number;
}

/** Compact integer tuple: sequence, elapsed 50ms ticks, xyz/32, yaw/1024 turn, pitch/1024 turn. */
export type QuantizedMotionKeyframe = readonly [
  sequence: number,
  tick: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
];

export type MotionVisualActionKind =
  | "swing"
  | "jump"
  | "crouch_on"
  | "crouch_off"
  | "use"
  | "slot"
  | "bow_draw"
  | "bow_release";

/** Visual-only action. `value` is currently used only by slot (0..8). */
export type QuantizedMotionAction = readonly [
  sequence: number,
  tick: number,
  kind: MotionVisualActionKind,
  value?: number,
];

export interface MotionBatchV1 {
  version: 1;
  sessionId: string;
  batchId: string;
  firstSequence: number;
  lastSequence: number;
  durationTicks: number;
  keyframes: QuantizedMotionKeyframe[];
  actions: QuantizedMotionAction[];
}

export type DecodeMotionBatchResult =
  | { ok: true; batch: MotionBatchV1; fingerprint: string }
  | { ok: false; reason: string };

export interface MotionReceipt {
  batchId: string;
  fingerprint: string;
  /** Exact canonical payload makes idempotency independent of hash collisions. */
  canonicalPayload: string;
  acceptedThrough: number;
  acceptedAt: number;
}

export interface MotionAcceptanceState {
  sessionId: string | null;
  acceptedThrough: number;
  receipts: MotionReceipt[];
}

export type MotionAcceptanceResult =
  | { ok: true; replay: boolean; state: MotionAcceptanceState; receipt: MotionReceipt }
  | { ok: false; reason: "batch_id_collision" | "sequence_gap" | "stale_sequence"; state: MotionAcceptanceState };

export interface QuotaSessionPlan {
  players: number;
  sessionMinutes: number;
  sessionsPerUtcDay: number;
  mutationIntervalMs: number;
  snapshotIntervalMs: number;
  motionMutations: number;
  snapshotRequests: number;
  mutationsPerPlayerPerSession: number;
  requestsPerPlayerPerSession: number;
}

export type TrafficKind = "mutation" | "request";

export interface SegmentTrafficGate {
  multiplayer: boolean;
  authenticated: boolean;
  visible: boolean;
  focused: boolean;
  paused: boolean;
  nearbyPlayers: number;
  quotaPausedUntil: number;
  mutationAttempts: number;
  requestAttempts: number;
  mutationGrant: number;
  requestGrant: number;
}

export interface SegmentBudgetState {
  utcWindowStartedAt: number;
  mutationAttempts: number;
  requestAttempts: number;
  quotaPausedUntil: number;
}

export type SegmentTrafficDecision =
  | { allow: true; mode: "active" | "discovery" }
  | {
      allow: false;
      reason:
        | "singleplayer"
        | "signed_out"
        | "background"
        | "paused"
        | "quota_paused"
        | "budget_exhausted"
        | "no_peers";
    };

export interface ReplayFrame extends MotionPose {
  sourceAt: number;
  sequence: number;
}

export interface ReplayAction {
  sourceAt: number;
  sequence: number;
  kind: MotionVisualActionKind;
  value?: number;
}

export interface RemoteReplayState {
  frames: ReplayFrame[];
  actions: ReplayAction[];
  cursorAt: number;
  lastStepAt: number;
  lastReceivedAt: number;
  lastEmittedActionSequence: number;
  pose: MotionPose;
}

export interface RemoteReplayStep {
  state: RemoteReplayState;
  pose: MotionPose;
  actions: ReplayAction[];
  speed: number;
  backlogMs: number;
  stale: boolean;
}

const ACTIONS = new Set<MotionVisualActionKind>([
  "swing", "jump", "crouch_on", "crouch_off", "use", "slot", "bow_draw", "bow_release",
]);
const BATCH_KEYS = [
  "actions", "batchId", "durationTicks", "firstSequence", "keyframes", "lastSequence", "sessionId", "version",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function safeInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

function validIdentifier(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
}

/** Canonical wire identity used by the server for exact replay/collision checks. */
export function canonicalMotionBatchPayload(batch: MotionBatchV1): string {
  return JSON.stringify([
    batch.version, batch.sessionId, batch.batchId, batch.firstSequence, batch.lastSequence,
    batch.durationTicks, batch.keyframes, batch.actions,
  ]);
}

/** Deterministic non-cryptographic identity; collision is always checked against the full canonical payload. */
export function motionBatchFingerprint(batch: MotionBatchV1): string {
  const text = canonicalMotionBatchPayload(batch);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}:${text.length}`;
}

export function quantizeMotionPose(pose: MotionPose): readonly [number, number, number, number, number] {
  const finite = [pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(Number.isFinite);
  if (!finite) throw new Error("motion pose must be finite");
  if (Math.max(Math.abs(pose.x), Math.abs(pose.y), Math.abs(pose.z)) > MOTION_MAX_COORDINATE) {
    throw new Error("motion pose is outside the world envelope");
  }
  const position = (value: number) => Math.round(value / MOTION_POSITION_QUANTUM);
  const angle = (value: number) => Math.round((value / (Math.PI * 2)) * MOTION_ANGLE_STEPS_PER_TURN);
  return [position(pose.x), position(pose.y), position(pose.z), angle(pose.yaw), angle(pose.pitch)];
}

export function dequantizeMotionPose(frame: QuantizedMotionKeyframe): MotionPose {
  return {
    x: frame[2] * MOTION_POSITION_QUANTUM,
    y: frame[3] * MOTION_POSITION_QUANTUM,
    z: frame[4] * MOTION_POSITION_QUANTUM,
    yaw: (frame[5] / MOTION_ANGLE_STEPS_PER_TURN) * Math.PI * 2,
    pitch: (frame[6] / MOTION_ANGLE_STEPS_PER_TURN) * Math.PI * 2,
  };
}

/**
 * Builds one bounded history segment. Callers flush before either array limit;
 * the builder rejects overflow rather than silently discarding local history.
 */
export function buildMotionBatch(input: {
  sessionId: string;
  batchId: string;
  firstSequence: number;
  samples: readonly MotionPoseSample[];
  actions?: readonly MotionActionSample[];
}): MotionBatchV1 {
  if (!validIdentifier(input.sessionId, MOTION_MAX_SESSION_ID_CHARS)
    || !validIdentifier(input.batchId, MOTION_MAX_BATCH_ID_CHARS)
    || !safeInteger(input.firstSequence, 0, MOTION_MAX_SEQUENCE)
    || input.samples.length < 1 || input.samples.length > MOTION_MAX_KEYFRAMES
    || (input.actions?.length ?? 0) > MOTION_MAX_ACTIONS) throw new Error("invalid motion batch input");
  const startedAt = input.samples[0].at;
  if (!Number.isFinite(startedAt)) throw new Error("invalid motion sample time");
  let previousAt = startedAt - 1;
  const keyframes = input.samples.map((sample, index): QuantizedMotionKeyframe => {
    if (!Number.isFinite(sample.at) || sample.at <= previousAt || sample.at - startedAt > MOTION_MAX_BATCH_DURATION_MS) {
      throw new Error("motion samples must be ordered within one batch window");
    }
    previousAt = sample.at;
    const sequence = input.firstSequence + index;
    if (sequence > MOTION_MAX_SEQUENCE) throw new Error("motion sequence exhausted");
    const tick = Math.round((sample.at - startedAt) / MOTION_SAMPLE_QUANTUM_MS);
    const [x, y, z, yaw, pitch] = quantizeMotionPose(sample.pose);
    return [sequence, tick, x, y, z, yaw, pitch];
  });
  const durationTicks = keyframes.at(-1)![1];
  let previousActionSequence = input.firstSequence - 1;
  const actions = [...(input.actions ?? [])].map((action): QuantizedMotionAction => {
    if (!Number.isFinite(action.at) || action.at < startedAt || action.at > previousAt || !ACTIONS.has(action.kind)) {
      throw new Error("invalid motion action");
    }
    let sampleIndex = 0;
    for (let index = 1; index < input.samples.length; index += 1) {
      if (input.samples[index].at > action.at) break;
      sampleIndex = index;
    }
    const sequence = input.firstSequence + sampleIndex;
    if (sequence <= previousActionSequence) throw new Error("visual actions require distinct ordered sample ticks");
    previousActionSequence = sequence;
    const tick = Math.round((action.at - startedAt) / MOTION_SAMPLE_QUANTUM_MS);
    if (action.kind === "slot") {
      if (!safeInteger(action.value, 0, 8)) throw new Error("invalid selected slot");
      return [sequence, tick, action.kind, action.value];
    }
    if (action.value !== undefined) throw new Error("unexpected motion action value");
    return [sequence, tick, action.kind];
  });
  const batch: MotionBatchV1 = {
    version: 1,
    sessionId: input.sessionId,
    batchId: input.batchId,
    firstSequence: input.firstSequence,
    lastSequence: keyframes.at(-1)![0],
    durationTicks,
    keyframes,
    actions,
  };
  const decoded = decodeMotionBatch(batch);
  if (!decoded.ok) throw new Error(`built invalid motion batch: ${decoded.reason}`);
  return batch;
}

/** Strictly decodes an untrusted client batch. Extra fields and coercions are rejected. */
export function decodeMotionBatch(value: unknown): DecodeMotionBatchResult {
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, reason: "not_serializable" };
  }
  if (!serialized || serialized.length > MOTION_MAX_BATCH_CHARS) return { ok: false, reason: "payload_size" };
  if (!isRecord(value) || !exactKeys(value, BATCH_KEYS)) return { ok: false, reason: "shape" };
  if (value.version !== MOTION_PROTOCOL_VERSION) return { ok: false, reason: "version" };
  if (!validIdentifier(value.sessionId, MOTION_MAX_SESSION_ID_CHARS)) return { ok: false, reason: "session_id" };
  if (!validIdentifier(value.batchId, MOTION_MAX_BATCH_ID_CHARS)) return { ok: false, reason: "batch_id" };
  if (!safeInteger(value.firstSequence, 0, MOTION_MAX_SEQUENCE)
    || !safeInteger(value.lastSequence, value.firstSequence, MOTION_MAX_SEQUENCE)) {
    return { ok: false, reason: "sequence" };
  }
  const maxTicks = MOTION_MAX_BATCH_DURATION_MS / MOTION_SAMPLE_QUANTUM_MS;
  if (!safeInteger(value.durationTicks, 0, maxTicks)) return { ok: false, reason: "duration" };
  if (!Array.isArray(value.keyframes) || value.keyframes.length < 1 || value.keyframes.length > MOTION_MAX_KEYFRAMES) {
    return { ok: false, reason: "keyframes" };
  }
  if (!Array.isArray(value.actions) || value.actions.length > MOTION_MAX_ACTIONS) return { ok: false, reason: "actions" };

  let previousTick = -1;
  let previousSequence = value.firstSequence - 1;
  const coordinateLimit = Math.round(MOTION_MAX_COORDINATE / MOTION_POSITION_QUANTUM);
  for (let index = 0; index < value.keyframes.length; index += 1) {
    const frame = value.keyframes[index];
    if (!Array.isArray(frame) || frame.length !== 7
      || !safeInteger(frame[0], value.firstSequence, value.lastSequence)
      || !safeInteger(frame[1], 0, value.durationTicks)
      || !safeInteger(frame[2], -coordinateLimit, coordinateLimit)
      || !safeInteger(frame[3], -coordinateLimit, coordinateLimit)
      || !safeInteger(frame[4], -coordinateLimit, coordinateLimit)
      || !safeInteger(frame[5], -MOTION_MAX_SEQUENCE, MOTION_MAX_SEQUENCE)
      || !safeInteger(frame[6], -MOTION_ANGLE_STEPS_PER_TURN / 4, MOTION_ANGLE_STEPS_PER_TURN / 4)
      || frame[0] !== value.firstSequence + index || frame[1] < previousTick) {
      return { ok: false, reason: "keyframe_value" };
    }
    previousSequence = frame[0];
    previousTick = frame[1];
  }
  if (value.keyframes[0][0] !== value.firstSequence
    || value.keyframes[0][1] !== 0
    || value.keyframes.at(-1)![0] !== value.lastSequence
    || value.keyframes.at(-1)![1] !== value.durationTicks
    || value.lastSequence !== value.firstSequence + value.keyframes.length - 1) {
    return { ok: false, reason: "keyframe_bounds" };
  }

  let previousActionSequence = value.firstSequence - 1;
  for (const action of value.actions) {
    const matchingFrame = value.keyframes[action?.[0] - value.firstSequence];
    if (!Array.isArray(action) || (action.length !== 3 && action.length !== 4)
      || !safeInteger(action[0], value.firstSequence, value.lastSequence)
      || !safeInteger(action[1], 0, value.durationTicks)
      || !ACTIONS.has(action[2] as MotionVisualActionKind)
      || action[0] <= previousActionSequence
      || !matchingFrame || matchingFrame[0] !== action[0] || matchingFrame[1] !== action[1]) {
      return { ok: false, reason: "action_value" };
    }
    if (action[2] === "slot") {
      if (action.length !== 4 || !safeInteger(action[3], 0, 8)) return { ok: false, reason: "action_value" };
    } else if (action.length !== 3) return { ok: false, reason: "action_value" };
    previousActionSequence = action[0];
  }

  const batch = value as unknown as MotionBatchV1;
  return { ok: true, batch, fingerprint: motionBatchFingerprint(batch) };
}

export function createMotionAcceptanceState(): MotionAcceptanceState {
  return { sessionId: null, acceptedThrough: -1, receipts: [] };
}

function pruneReceipts(receipts: readonly MotionReceipt[], now: number): MotionReceipt[] {
  return receipts.filter((receipt) => now - receipt.acceptedAt <= MOTION_RECEIPT_RETENTION_MS).slice(-MOTION_RECEIPT_LIMIT);
}

/** Server reducer for exact replay, collision, strict contiguity, and bounded receipts. */
export function acceptMotionBatch(
  current: MotionAcceptanceState,
  batch: MotionBatchV1,
  now: number,
): MotionAcceptanceResult {
  const fingerprint = motionBatchFingerprint(batch);
  const canonicalPayload = canonicalMotionBatchPayload(batch);
  let receipts = pruneReceipts(current.receipts, now);
  const existing = receipts.find((receipt) => receipt.batchId === batch.batchId);
  if (existing) {
    if (existing.fingerprint !== fingerprint || existing.canonicalPayload !== canonicalPayload) {
      return { ok: false, reason: "batch_id_collision", state: { ...current, receipts } };
    }
    return { ok: true, replay: true, receipt: existing, state: { ...current, receipts } };
  }

  const switchingSession = current.sessionId !== batch.sessionId;
  const acceptedThrough = switchingSession ? -1 : current.acceptedThrough;
  if (batch.lastSequence <= acceptedThrough) return { ok: false, reason: "stale_sequence", state: { ...current, receipts } };
  if (batch.firstSequence !== acceptedThrough + 1) return { ok: false, reason: "sequence_gap", state: { ...current, receipts } };

  const receipt: MotionReceipt = {
    batchId: batch.batchId,
    fingerprint,
    canonicalPayload,
    acceptedThrough: batch.lastSequence,
    acceptedAt: now,
  };
  receipts = [...receipts, receipt].slice(-MOTION_RECEIPT_LIMIT);
  return {
    ok: true,
    replay: false,
    receipt,
    state: { sessionId: batch.sessionId, acceptedThrough: batch.lastSequence, receipts },
  };
}

/** Rows are newest-first. Keep both age and cardinality bounded per player. */
export function retainedMotionRows<T extends { acceptedAt: number }>(rows: readonly T[], now: number): T[] {
  return [...rows]
    .filter((row) => Number.isFinite(row.acceptedAt) && now - row.acceptedAt <= MOTION_ROW_RETENTION_MS)
    .sort((a, b) => b.acceptedAt - a.acceptedAt)
    .slice(0, MOTION_ROWS_PER_PLAYER);
}

/**
 * Allocates one deployment day's motion/read budget to identical sessions.
 * The result deliberately exposes bad degradation instead of claiming realtime.
 */
export function planQuotaSession(players: number, sessionMinutes: number, sessionsPerUtcDay = 1): QuotaSessionPlan {
  if (!safeInteger(players, 1, 100) || !Number.isFinite(sessionMinutes) || sessionMinutes <= 0
    || !safeInteger(sessionsPerUtcDay, 1, 100)) throw new Error("invalid quota session");
  const sessionMs = sessionMinutes * 60_000;
  const divisor = players * sessionsPerUtcDay;
  const mutationsPerPlayerPerSession = Math.floor(SEGMENT_MOTION_MUTATION_BUDGET / divisor);
  const requestsPerPlayerPerSession = Math.floor(SEGMENT_SNAPSHOT_REQUEST_BUDGET / divisor);
  return {
    players,
    sessionMinutes,
    sessionsPerUtcDay,
    mutationIntervalMs: mutationsPerPlayerPerSession > 0
      ? Math.ceil(sessionMs / mutationsPerPlayerPerSession)
      : Number.POSITIVE_INFINITY,
    snapshotIntervalMs: requestsPerPlayerPerSession > 0
      ? Math.ceil(sessionMs / requestsPerPlayerPerSession)
      : Number.POSITIVE_INFINITY,
    motionMutations: mutationsPerPlayerPerSession * divisor,
    snapshotRequests: requestsPerPlayerPerSession * divisor,
    mutationsPerPlayerPerSession,
    requestsPerPlayerPerSession,
  };
}

export function utcQuotaWindowStartedAt(now: number): number {
  if (!Number.isFinite(now)) now = 0;
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Strict hydration; corrupted/future/local-day state never grants extra calls. */
export function createSegmentBudgetState(now: number, persisted?: Partial<SegmentBudgetState> | null): SegmentBudgetState {
  const utcWindowStartedAt = utcQuotaWindowStartedAt(now);
  if (!persisted || (Number.isFinite(persisted.utcWindowStartedAt) && persisted.utcWindowStartedAt! < utcWindowStartedAt)) {
    return { utcWindowStartedAt, mutationAttempts: 0, requestAttempts: 0, quotaPausedUntil: 0 };
  }
  if (persisted.utcWindowStartedAt !== utcWindowStartedAt
    || !safeInteger(persisted.mutationAttempts, 0, LAKEBED_MUTATIONS_PER_UTC_DAY)
    || !safeInteger(persisted.requestAttempts, 0, LAKEBED_REQUESTS_PER_UTC_DAY)
    || !Number.isFinite(persisted.quotaPausedUntil)) {
    return {
      utcWindowStartedAt,
      mutationAttempts: LAKEBED_MUTATIONS_PER_UTC_DAY,
      requestAttempts: LAKEBED_REQUESTS_PER_UTC_DAY,
      quotaPausedUntil: utcWindowStartedAt + 24 * 60 * 60_000,
    };
  }
  return {
    utcWindowStartedAt,
    mutationAttempts: persisted.mutationAttempts,
    requestAttempts: persisted.requestAttempts,
    quotaPausedUntil: Math.max(0, persisted.quotaPausedUntil!),
  };
}

/** Debits before transport. The caller must not refund failures. */
export function reserveSegmentAttempt(
  state: SegmentBudgetState,
  kind: TrafficKind,
  grant: number,
  now: number,
): boolean {
  if (utcQuotaWindowStartedAt(now) !== state.utcWindowStartedAt) {
    Object.assign(state, createSegmentBudgetState(now));
  }
  if (state.quotaPausedUntil > now || !safeInteger(grant, 0,
    kind === "mutation" ? LAKEBED_MUTATIONS_PER_UTC_DAY : LAKEBED_REQUESTS_PER_UTC_DAY)) return false;
  if (kind === "mutation") {
    if (state.mutationAttempts >= grant) return false;
    state.mutationAttempts += 1;
  } else {
    if (state.requestAttempts >= grant) return false;
    state.requestAttempts += 1;
  }
  return true;
}

export function pauseSegmentTrafficForQuota(state: SegmentBudgetState, resetAt: number, now: number): void {
  const utcReset = state.utcWindowStartedAt + 24 * 60 * 60_000;
  state.quotaPausedUntil = Math.max(state.quotaPausedUntil, now, Number.isFinite(resetAt) ? resetAt : utcReset);
}

/** Every attempted call consumes its local grant, including failures. */
export function decideSegmentTraffic(gate: SegmentTrafficGate, kind: TrafficKind, now: number): SegmentTrafficDecision {
  if (!gate.multiplayer) return { allow: false, reason: "singleplayer" };
  if (!gate.authenticated) return { allow: false, reason: "signed_out" };
  if (!gate.visible || !gate.focused) return { allow: false, reason: "background" };
  if (gate.paused) return { allow: false, reason: "paused" };
  if (gate.quotaPausedUntil > now) return { allow: false, reason: "quota_paused" };
  const attempts = kind === "mutation" ? gate.mutationAttempts : gate.requestAttempts;
  const grant = kind === "mutation" ? gate.mutationGrant : gate.requestGrant;
  if (attempts >= grant) return { allow: false, reason: "budget_exhausted" };
  if (gate.nearbyPlayers <= 0) {
    return kind === "request" ? { allow: true, mode: "discovery" } : { allow: false, reason: "no_peers" };
  }
  return { allow: true, mode: "active" };
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function interpolatePose(a: MotionPose, b: MotionPose, amount: number): MotionPose {
  const mix = (x: number, y: number) => x + (y - x) * amount;
  return {
    x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z),
    yaw: a.yaw + shortestAngle(a.yaw, b.yaw) * amount,
    pitch: mix(a.pitch, b.pitch),
  };
}

function poseAt(frames: readonly ReplayFrame[], sourceAt: number): MotionPose {
  if (sourceAt <= frames[0].sourceAt) return { ...frames[0] };
  for (let index = 1; index < frames.length; index += 1) {
    const next = frames[index];
    if (sourceAt <= next.sourceAt) {
      const previous = frames[index - 1];
      const span = Math.max(1, next.sourceAt - previous.sourceAt);
      return interpolatePose(previous, next, (sourceAt - previous.sourceAt) / span);
    }
  }
  const latest = frames.at(-1)!;
  if (frames.length < 2) return { ...latest };
  const previous = frames.at(-2)!;
  const span = Math.max(1, latest.sourceAt - previous.sourceAt);
  const extrapolation = Math.min(REMOTE_MAX_EXTRAPOLATION_MS, Math.max(0, sourceAt - latest.sourceAt));
  return interpolatePose(previous, latest, 1 + extrapolation / span);
}

/** Anchors relative client history to the server acceptance timestamp. */
export function ingestRemoteBatch(
  current: RemoteReplayState | null,
  batch: MotionBatchV1,
  acceptedAt: number,
  receivedAt: number,
): RemoteReplayState {
  const durationMs = batch.durationTicks * MOTION_SAMPLE_QUANTUM_MS;
  const sourceStartAt = acceptedAt - durationMs;
  const incomingFrames = batch.keyframes.map((frame): ReplayFrame => ({
    ...dequantizeMotionPose(frame),
    sourceAt: sourceStartAt + frame[1] * MOTION_SAMPLE_QUANTUM_MS,
    sequence: frame[0],
  }));
  const incomingActions = batch.actions.map((action): ReplayAction => ({
    sourceAt: sourceStartAt + action[1] * MOTION_SAMPLE_QUANTUM_MS,
    sequence: action[0],
    kind: action[2],
    ...(action[3] === undefined ? {} : { value: action[3] }),
  }));
  const minimumSequence = current?.frames.at(-1)?.sequence ?? -1;
  const frames = [...(current?.frames ?? []), ...incomingFrames.filter((frame) => frame.sequence > minimumSequence)]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-MOTION_MAX_KEYFRAMES * 2);
  const actions = [...(current?.actions ?? []), ...incomingActions]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-MOTION_MAX_ACTIONS * 2);
  const latestAt = frames.at(-1)!.sourceAt;
  const cursorAt = current
    ? Math.min(current.cursorAt, latestAt)
    : Math.max(frames[0].sourceAt, latestAt - REMOTE_INTERPOLATION_BUFFER_MS);
  const initialEmittedActionSequence = current?.lastEmittedActionSequence
    ?? incomingActions.filter((action) => action.sourceAt <= cursorAt).at(-1)?.sequence
    ?? -1;
  return {
    frames,
    actions,
    cursorAt,
    lastStepAt: current?.lastStepAt ?? receivedAt,
    lastReceivedAt: receivedAt,
    lastEmittedActionSequence: initialEmittedActionSequence,
    pose: current?.pose ?? poseAt(frames, cursorAt),
  };
}

/** Deterministic buffered replay with bounded catch-up, extrapolation, and stale freeze. */
export function stepRemoteReplay(current: RemoteReplayState, now: number): RemoteReplayStep {
  const elapsed = Math.max(0, Math.min(1_000, now - current.lastStepAt));
  const latestAt = current.frames.at(-1)!.sourceAt;
  const desiredAt = latestAt - REMOTE_INTERPOLATION_BUFFER_MS;
  const backlogMs = Math.max(0, desiredAt - current.cursorAt);
  const speed = backlogMs <= REMOTE_INTERPOLATION_BUFFER_MS
    ? 1
    : Math.min(REMOTE_MAX_CATCH_UP_SPEED, 1 + backlogMs / 2_000);
  const stale = now - current.lastReceivedAt > REMOTE_STALE_AFTER_MS;
  const maximumCursor = latestAt + (stale ? 0 : REMOTE_MAX_EXTRAPOLATION_MS);
  const cursorAt = stale ? current.cursorAt : Math.min(maximumCursor, current.cursorAt + elapsed * speed);
  const actions = current.actions.filter((action) =>
    action.sequence > current.lastEmittedActionSequence && action.sourceAt <= cursorAt);
  const lastEmittedActionSequence = actions.at(-1)?.sequence ?? current.lastEmittedActionSequence;
  const pose = poseAt(current.frames, cursorAt);
  const state: RemoteReplayState = {
    ...current,
    cursorAt,
    lastStepAt: Math.max(current.lastStepAt, now),
    lastEmittedActionSequence,
    pose,
  };
  return { state, pose, actions, speed, backlogMs, stale };
}
