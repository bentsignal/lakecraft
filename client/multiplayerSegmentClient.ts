import {
  MOTION_MAX_BATCH_DURATION_MS,
  MOTION_MAX_ACTIONS,
  MOTION_MAX_KEYFRAMES,
  MOTION_SAMPLE_QUANTUM_MS,
  REMOTE_STALE_AFTER_MS,
  buildMotionBatch,
  createSegmentBudgetState,
  decideSegmentTraffic,
  ingestRemoteBatch,
  pauseSegmentTrafficForQuota,
  planQuotaSession,
  reserveSegmentAttempt,
  stepRemoteReplay,
  type MotionBatchV1,
  type MotionPose,
  type MotionPoseSample,
  type MotionActionSample,
  type MotionVisualActionKind,
  type ReplayAction,
  type RemoteReplayState,
  type SegmentBudgetState,
  type SegmentTrafficDecision,
} from "../shared/multiplayerSegments.ts";
import type { MobAuthorityState } from "../shared/mobCombat.ts";
import type { MobMotionPose } from "../shared/mobMotionAuthority.ts";

export const SEGMENT_BUDGET_STORAGE_PREFIX = "lakecraft:segment-budget:v1:";
export const SEGMENT_DISCOVERY_INTERVAL_MULTIPLIER = 4;
export const SEGMENT_REPLAY_TICK_MS = 50;
export const SEGMENT_DEFAULT_PLAYERS = 10;
export const SEGMENT_DEFAULT_SESSION_MINUTES = 10;
export const SEGMENT_COMPOSITE_RADIUS = 96;

export interface SegmentAppearance {
  heldItem: string;
  armorHead: string;
  armorChest: string;
  armorLegs: string;
  armorFeet: string;
}

export interface CompositeMotionRow {
  batch: MotionBatchV1;
  acceptedAt: number;
}

export interface CompositeNearbyPlayer extends MotionPose, SegmentAppearance {
  userId: string;
  displayName: string;
  color: string;
  sessionId: string;
  heartbeatAt: number;
  online: boolean;
  batches: CompositeMotionRow[];
}

export type MobWorldCompositeSnapshot =
  | {
      ok: true;
      checkpointRevision: number;
      motionTick: number;
      checkpointAt: number;
      leaseOwnerUserId: string;
      leaseExpiresAt: number;
      serverNow: number;
      poses: MobMotionPose[];
      states: MobAuthorityState[];
      damageClaims: Array<{
        operationId: string;
        mobId: string;
        checkpointRevision: number;
        tick: number;
      }>;
      explosionClaims: Array<{
        operationId: string;
        mobId: string;
        epoch: number;
        checkpointRevision: number;
        fuseStartedTick: number;
      }>;
      needsCheckpoint: boolean;
    }
  | { ok: false; reason: string; poses: []; states: []; damageClaims: []; explosionClaims: []; serverNow: number };

export type MultiplayerCompositeResult =
  | { ok: true; serverNow: number; nearbyPlayers: CompositeNearbyPlayer[]; mobWorld: MobWorldCompositeSnapshot }
  | { ok: false; reason: string; serverNow: number; nearbyPlayers: [] };

export type PublishMotionSegmentsResult =
  | { ok: true; replayed: boolean; acceptedThrough: number; acceptedAt: number; serverNow: number }
  | { ok: false; reason: string; acceptedThrough?: number; retryAfterMs?: number; serverNow: number };

export interface CompositeKnownCursor {
  userId: string;
  sessionId: string;
  acceptedThrough: number;
}

export interface SegmentRemoteVisual extends MotionPose, SegmentAppearance {
  id: string;
  name: string;
  color: string;
  stale: boolean;
  ageMs: number;
  replaySpeed: number;
  backlogMs: number;
  actions: ReplayAction[];
}

export interface SegmentTelemetry {
  mode: "active" | "discovery" | "singleplayer" | "signed_out" | "background" | "paused" | "quota_paused" | "budget_exhausted" | "no_peers";
  publishIntervalMs: number;
  compositeIntervalMs: number;
  mutationAttempts: number;
  mutationGrant: number;
  requestAttempts: number;
  requestGrant: number;
  nearbyPlayers: number;
  stalePlayers: number;
  stalestRemoteMs: number;
  quotaPausedUntil: number;
}

type PendingBatch = { batch: MotionBatchV1; sampleCount: number };

function randomIdentifier(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `${prefix}_${Date.now().toString(36)}_${random}`.slice(0, 64);
}

function finitePose(pose: MotionPose): boolean {
  return [pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(Number.isFinite);
}

/**
 * Local high-frequency sampling with a cadence-aware retained history. Sampling
 * itself is free; retained frames are spaced so a quota-sized network batch can
 * cover the whole publish interval without overflowing 128 keyframes.
 */
export class MotionSegmentRecorder {
  readonly sessionId: string;
  private samples: MotionPoseSample[] = [];
  private actions: MotionActionSample[] = [];
  private nextSequence = 0;
  private pending: PendingBatch | null = null;
  private captureIntervalMs = MOTION_SAMPLE_QUANTUM_MS;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  configurePublishInterval(publishIntervalMs: number): void {
    const boundedWindow = Math.min(MOTION_MAX_BATCH_DURATION_MS, Math.max(MOTION_SAMPLE_QUANTUM_MS, publishIntervalMs));
    this.captureIntervalMs = Math.max(
      MOTION_SAMPLE_QUANTUM_MS,
      Math.ceil(boundedWindow / Math.max(1, MOTION_MAX_KEYFRAMES - 1) / MOTION_SAMPLE_QUANTUM_MS) * MOTION_SAMPLE_QUANTUM_MS,
    );
  }

  sample(pose: MotionPose, at: number, force = false): boolean {
    if (!finitePose(pose) || !Number.isFinite(at)) return false;
    const previous = this.samples.at(-1);
    if (previous && at <= previous.at) return false;
    if (!force && previous && at - previous.at < this.captureIntervalMs) return false;
    if (previous && at - this.samples[0].at > MOTION_MAX_BATCH_DURATION_MS) {
      // The transport is expected to flush at or before 30 seconds. Retaining
      // the newest legal window is safer than constructing an invalid payload.
      this.samples = this.samples.filter((sample) => at - sample.at <= MOTION_MAX_BATCH_DURATION_MS);
      const earliestRetainedAt = this.samples[0]?.at ?? at;
      this.actions = this.actions.filter((action) => action.at >= earliestRetainedAt);
    }
    if (this.samples.length >= MOTION_MAX_KEYFRAMES) {
      if (force) return false;
      this.samples.splice(1, 1);
    }
    this.samples.push({ at, pose: { ...pose } });
    return true;
  }

  action(kind: MotionVisualActionKind, pose: MotionPose, at: number, value?: number): boolean {
    if (this.pending || this.actions.length >= MOTION_MAX_ACTIONS) return false;
    const previousAt = Math.max(this.samples.at(-1)?.at ?? -Infinity, this.actions.at(-1)?.at ?? -Infinity);
    const actionAt = Math.max(at, previousAt + 1);
    if (!this.sample(pose, actionAt, true)) return false;
    this.actions.push({ at: actionAt, kind, ...(value === undefined ? {} : { value }) });
    return true;
  }

  prepare(now: number, latestPose: MotionPose): MotionBatchV1 | null {
    if (this.pending) return this.pending.batch;
    this.sample(latestPose, now, true);
    if (this.samples.length === 0) return null;
    const batch = buildMotionBatch({
      sessionId: this.sessionId,
      batchId: randomIdentifier("motion"),
      firstSequence: this.nextSequence,
      samples: this.samples,
      actions: this.actions,
    });
    this.pending = { batch, sampleCount: this.samples.length };
    return batch;
  }

  accept(acceptedThrough: number): boolean {
    if (!this.pending || acceptedThrough < this.pending.batch.lastSequence) return false;
    this.nextSequence = this.pending.batch.lastSequence + 1;
    const final = this.samples.at(-1);
    this.samples = final ? [{ at: final.at, pose: { ...final.pose } }] : [];
    this.actions = [];
    this.pending = null;
    return true;
  }

  get pendingBatch(): MotionBatchV1 | null {
    return this.pending?.batch ?? null;
  }
}

export function createCompositeRequest(
  known: readonly CompositeKnownCursor[],
  sample = Date.now(),
  mobIds: readonly string[] = [],
): string {
  const compact = known.slice(0, 12).map((cursor): readonly [string, string, number] => [
    cursor.userId,
    cursor.sessionId,
    cursor.acceptedThrough,
  ]);
  const compactMobIds = [...new Set(mobIds)].sort().slice(0, 64);
  return JSON.stringify({ radius: SEGMENT_COMPOSITE_RADIUS, known: compact, mobIds: compactMobIds, sample: String(Math.max(0, Math.floor(sample))) });
}

export function loadSegmentBudget(userId: string, now: number): SegmentBudgetState {
  try {
    const raw = globalThis.localStorage?.getItem(`${SEGMENT_BUDGET_STORAGE_PREFIX}${userId}`);
    return createSegmentBudgetState(now, raw ? JSON.parse(raw) : null);
  } catch {
    return createSegmentBudgetState(now);
  }
}

export function persistSegmentBudget(userId: string, state: SegmentBudgetState): void {
  try {
    globalThis.localStorage?.setItem(`${SEGMENT_BUDGET_STORAGE_PREFIX}${userId}`, JSON.stringify(state));
  } catch {
    // In-memory accounting still prevents a retry storm when storage is denied.
  }
}

export function segmentQuotaResetAt(error: unknown, now: number): number {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const timestamp = text.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/)?.[0];
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > now) return parsed;
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export class SegmentReplayCollection {
  private readonly states = new Map<string, RemoteReplayState>();
  private readonly appearances = new Map<string, Omit<SegmentRemoteVisual, keyof MotionPose | "stale" | "ageMs" | "replaySpeed" | "backlogMs">>();
  private readonly cursors = new Map<string, CompositeKnownCursor>();

  ingest(result: MultiplayerCompositeResult, receivedAt: number, ownUserId: string): void {
    if (!result.ok) return;
    const present = new Set<string>();
    for (const remote of result.nearbyPlayers) {
      if (remote.userId === ownUserId || !remote.online) continue;
      present.add(remote.userId);
      this.appearances.set(remote.userId, {
        id: remote.userId,
        name: remote.displayName,
        color: remote.color,
        heldItem: remote.heldItem,
        armorHead: remote.armorHead,
        armorChest: remote.armorChest,
        armorLegs: remote.armorLegs,
        armorFeet: remote.armorFeet,
      });
      const previousCursor = this.cursors.get(remote.userId);
      const switchingSession = Boolean(previousCursor && previousCursor.sessionId !== remote.sessionId);
      let state = switchingSession ? null : this.states.get(remote.userId) ?? null;
      const rows = [...remote.batches].sort((a, b) => a.acceptedAt - b.acceptedAt);
      for (const row of rows) state = ingestRemoteBatch(state, row.batch, row.acceptedAt, receivedAt);
      if (!state) {
        const fallback = buildMotionBatch({
          sessionId: remote.sessionId,
          batchId: `fallback_${remote.userId.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64).padEnd(8, "_"),
          firstSequence: 0,
          samples: [{ at: receivedAt, pose: remote }],
        });
        state = ingestRemoteBatch(null, fallback, result.serverNow, receivedAt);
      }
      this.states.set(remote.userId, state);
      const acceptedThrough = rows.at(-1)?.batch.lastSequence ?? this.cursors.get(remote.userId)?.acceptedThrough ?? -1;
      this.cursors.set(remote.userId, { userId: remote.userId, sessionId: remote.sessionId, acceptedThrough });
    }
    for (const id of this.states.keys()) {
      const state = this.states.get(id)!;
      if (!present.has(id) && receivedAt - state.lastReceivedAt > REMOTE_STALE_AFTER_MS) {
        this.states.delete(id);
        this.appearances.delete(id);
        this.cursors.delete(id);
      }
    }
  }

  step(now: number): SegmentRemoteVisual[] {
    const visuals: SegmentRemoteVisual[] = [];
    for (const [id, current] of this.states) {
      const replay = stepRemoteReplay(current, now);
      this.states.set(id, replay.state);
      const appearance = this.appearances.get(id);
      if (!appearance) continue;
      visuals.push({
        ...appearance,
        ...replay.pose,
        stale: replay.stale,
        ageMs: Math.max(0, now - current.lastReceivedAt),
        replaySpeed: replay.speed,
        backlogMs: replay.backlogMs,
        actions: replay.actions,
      });
    }
    return visuals;
  }

  known(): CompositeKnownCursor[] {
    return [...this.cursors.values()].sort((a, b) => a.userId.localeCompare(b.userId)).slice(0, 12);
  }
}

export function segmentQuotaPlan(nearbyPlayers: number) {
  return planQuotaSession(
    Math.max(SEGMENT_DEFAULT_PLAYERS, nearbyPlayers + 1),
    SEGMENT_DEFAULT_SESSION_MINUTES,
  );
}

export function decideAndReserveSegmentTraffic(input: {
  budget: SegmentBudgetState;
  kind: "mutation" | "request";
  now: number;
  multiplayer: boolean;
  authenticated: boolean;
  visible: boolean;
  focused: boolean;
  paused: boolean;
  nearbyPlayers: number;
  grant: number;
}): SegmentTrafficDecision {
  const decision = decideSegmentTraffic({
    multiplayer: input.multiplayer,
    authenticated: input.authenticated,
    visible: input.visible,
    focused: input.focused,
    paused: input.paused,
    nearbyPlayers: input.nearbyPlayers,
    quotaPausedUntil: input.budget.quotaPausedUntil,
    mutationAttempts: input.budget.mutationAttempts,
    requestAttempts: input.budget.requestAttempts,
    mutationGrant: input.kind === "mutation" ? input.grant : Number.MAX_SAFE_INTEGER,
    requestGrant: input.kind === "request" ? input.grant : Number.MAX_SAFE_INTEGER,
  }, input.kind, input.now);
  if (!decision.allow) return decision;
  return reserveSegmentAttempt(input.budget, input.kind, input.grant, input.now)
    ? decision
    : { allow: false, reason: "budget_exhausted" };
}

export { pauseSegmentTrafficForQuota };
