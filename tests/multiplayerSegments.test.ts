import assert from "node:assert/strict";
import {
  LAKEBED_MUTATIONS_PER_UTC_DAY,
  LAKEBED_REQUESTS_PER_UTC_DAY,
  MOTION_MAX_ACTIONS,
  MOTION_MAX_BATCH_CHARS,
  MOTION_MAX_BATCH_DURATION_MS,
  MOTION_MAX_KEYFRAMES,
  MOTION_RECEIPT_LIMIT,
  MOTION_RECEIPT_RETENTION_MS,
  MOTION_ROWS_PER_PLAYER,
  MOTION_ROW_RETENTION_MS,
  MOTION_SAMPLE_QUANTUM_MS,
  REMOTE_MAX_CATCH_UP_SPEED,
  REMOTE_MAX_EXTRAPOLATION_MS,
  REMOTE_STALE_AFTER_MS,
  SEGMENT_ACTION_MUTATION_RESERVE,
  SEGMENT_MOTION_MUTATION_BUDGET,
  SEGMENT_OTHER_REQUEST_RESERVE,
  SEGMENT_SNAPSHOT_REQUEST_BUDGET,
  acceptMotionBatch,
  buildMotionBatch,
  createMotionAcceptanceState,
  createSegmentBudgetState,
  decideSegmentTraffic,
  decodeMotionBatch,
  dequantizeMotionPose,
  ingestRemoteBatch,
  motionBatchFingerprint,
  pauseSegmentTrafficForQuota,
  planQuotaSession,
  quantizeMotionPose,
  reserveSegmentAttempt,
  retainedMotionRows,
  stepRemoteReplay,
  utcQuotaWindowStartedAt,
  type MotionAcceptanceState,
  type MotionBatchV1,
  type RemoteReplayState,
  type SegmentTrafficGate,
} from "../shared/multiplayerSegments.ts";

function makeBatch(
  batchNumber = 0,
  player = 0,
  durationMs = 30_000,
): MotionBatchV1 {
  const firstSequence = batchNumber * 7;
  const startMs = batchNumber * durationMs;
  const keyframes: MotionBatchV1["keyframes"] = [];
  for (let frame = 0; frame < 7; frame += 1) {
    const sourceMs = startMs + frame * durationMs / 6;
    const [x, y, z, yaw, pitch] = quantizeMotionPose({
      x: player * 20 + sourceMs / 10_000,
      y: 10 + (frame === 3 ? 1 : 0),
      z: player * -4 + sourceMs / 20_000,
      yaw: (sourceMs / 20_000) % (Math.PI * 2),
      pitch: 0,
    });
    keyframes.push([
      firstSequence + frame,
      Math.round((frame * durationMs / 6) / MOTION_SAMPLE_QUANTUM_MS),
      x, y, z, yaw, pitch,
    ]);
  }
  return {
    version: 1,
    sessionId: `session_${String(player).padStart(2, "0")}`,
    batchId: `batch_${String(player).padStart(2, "0")}_${String(batchNumber).padStart(4, "0")}`,
    firstSequence,
    lastSequence: firstSequence + 6,
    durationTicks: durationMs / MOTION_SAMPLE_QUANTUM_MS,
    keyframes,
    actions: [[firstSequence + 3, durationMs / MOTION_SAMPLE_QUANTUM_MS / 2, "swing"]],
  };
}

// Exact deployed quota model. These are deployment-wide daily ceilings.
assert.equal(LAKEBED_REQUESTS_PER_UTC_DAY, 10_000);
assert.equal(LAKEBED_MUTATIONS_PER_UTC_DAY, 1_000);
assert.equal(SEGMENT_ACTION_MUTATION_RESERVE, 400);
assert.equal(SEGMENT_OTHER_REQUEST_RESERVE, 1_000);
assert.equal(SEGMENT_MOTION_MUTATION_BUDGET, 600);
assert.equal(SEGMENT_SNAPSHOT_REQUEST_BUDGET, 9_000);

const showcase = planQuotaSession(5, 10);
assert.equal(showcase.mutationIntervalMs, 5_000);
assert.equal(showcase.snapshotIntervalMs, 334);
assert.equal(showcase.motionMutations, 600);
assert.equal(showcase.snapshotRequests, 9_000);

const party = planQuotaSession(10, 30);
assert.equal(party.mutationIntervalMs, 30_000);
assert.equal(party.snapshotIntervalMs, 2_000);
assert.equal(party.motionMutations, 600);
assert.equal(party.snapshotRequests, 9_000);
assert.equal(party.motionMutations + SEGMENT_ACTION_MUTATION_RESERVE, LAKEBED_MUTATIONS_PER_UTC_DAY);
assert.equal(party.snapshotRequests + SEGMENT_OTHER_REQUEST_RESERVE, LAKEBED_REQUESTS_PER_UTC_DAY);

const endurance = planQuotaSession(10, 120);
assert.equal(endurance.mutationIntervalMs, 120_000);
assert.equal(endurance.snapshotIntervalMs, 8_000);
const twoParties = planQuotaSession(10, 30, 2);
assert.equal(twoParties.mutationIntervalMs, 60_000);
assert.equal(twoParties.snapshotIntervalMs, 4_000);
const infeasible = planQuotaSession(100, 10, 100);
assert.equal(infeasible.motionMutations, 0);
assert.equal(infeasible.mutationIntervalMs, Number.POSITIVE_INFINITY);
assert.ok(infeasible.snapshotRequests <= SEGMENT_SNAPSHOT_REQUEST_BUDGET);
assert.throws(() => planQuotaSession(0, 30));
assert.throws(() => planQuotaSession(10, 0));

// Quantization is deterministic and bounded to Minecraft-useful precision.
const quantized = quantizeMotionPose({ x: 1.02, y: 9.99, z: -2.51, yaw: Math.PI, pitch: -Math.PI / 4 });
const restored = dequantizeMotionPose([0, 0, ...quantized]);
assert.ok(Math.abs(restored.x - 1.02) <= 1 / 64);
assert.ok(Math.abs(restored.y - 9.99) <= 1 / 64);
assert.ok(Math.abs(restored.z + 2.51) <= 1 / 64);
assert.ok(Math.abs(restored.yaw - Math.PI) <= Math.PI / 1_024);
assert.throws(() => quantizeMotionPose({ x: Infinity, y: 0, z: 0, yaw: 0, pitch: 0 }));
assert.throws(() => quantizeMotionPose({ x: 1_000_001, y: 0, z: 0, yaw: 0, pitch: 0 }));

const built = buildMotionBatch({
  sessionId: "session_builder_01",
  batchId: "batch_builder_0001",
  firstSequence: 20,
  samples: [
    { at: 1_000, pose: { x: 0, y: 10, z: 0, yaw: 0, pitch: 0 } },
    { at: 1_100, pose: { x: 1, y: 10, z: 0, yaw: 0.1, pitch: 0 } },
    { at: 1_200, pose: { x: 2, y: 10, z: 0, yaw: 0.2, pitch: 0 } },
  ],
  actions: [
    { at: 1_100, kind: "swing" },
    { at: 1_200, kind: "slot", value: 4 },
  ],
});
assert.equal(built.firstSequence, 20);
assert.equal(built.lastSequence, 22);
assert.equal(built.durationTicks, 4);
assert.deepEqual(built.actions, [[21, 2, "swing"], [22, 4, "slot", 4]]);
assert.equal(decodeMotionBatch(built).ok, true);
assert.throws(() => buildMotionBatch({
  sessionId: "session_builder_01", batchId: "batch_builder_0002", firstSequence: 0,
  samples: Array.from({ length: MOTION_MAX_KEYFRAMES + 1 }, (_, index) => ({
    at: index * 50, pose: { x: index, y: 10, z: 0, yaw: 0, pitch: 0 },
  })),
}));
assert.throws(() => buildMotionBatch({
  sessionId: "session_builder_01", batchId: "batch_builder_0003", firstSequence: 0,
  samples: [
    { at: 100, pose: { x: 0, y: 10, z: 0, yaw: 0, pitch: 0 } },
    { at: 100, pose: { x: 1, y: 10, z: 0, yaw: 0, pitch: 0 } },
  ],
}));

// Untrusted payload decoding: no unknown keys, coercions, oversized histories,
// invalid slot values, non-monotonic time/sequence, or unbounded coordinates.
const valid = makeBatch();
const decoded = decodeMotionBatch(valid);
assert.equal(decoded.ok, true);
if (decoded.ok) assert.equal(decoded.fingerprint, motionBatchFingerprint(valid));

function rejected(mutator: (copy: Record<string, unknown>) => void, reason?: string): void {
  const copy = structuredClone(valid) as unknown as Record<string, unknown>;
  mutator(copy);
  const result = decodeMotionBatch(copy);
  assert.equal(result.ok, false);
  if (!result.ok && reason) assert.equal(result.reason, reason);
}

rejected((copy) => { copy.extra = true; }, "shape");
rejected((copy) => { copy.version = "1"; }, "version");
rejected((copy) => { copy.firstSequence = "0"; }, "sequence");
rejected((copy) => { copy.sessionId = "../bad"; }, "session_id");
rejected((copy) => { copy.durationTicks = MOTION_MAX_BATCH_DURATION_MS / MOTION_SAMPLE_QUANTUM_MS + 1; }, "duration");
rejected((copy) => { copy.keyframes = Array(MOTION_MAX_KEYFRAMES + 1).fill(valid.keyframes[0]); }, "keyframes");
rejected((copy) => { copy.actions = Array(MOTION_MAX_ACTIONS + 1).fill(valid.actions[0]); }, "actions");
rejected((copy) => { (copy.keyframes as number[][])[1][0] = 0; }, "keyframe_value");
rejected((copy) => { (copy.keyframes as number[][])[1][0] = 2_147_483_647; }, "keyframe_value");
rejected((copy) => { (copy.keyframes as number[][])[1][1] = -1; }, "keyframe_value");
rejected((copy) => { (copy.keyframes as number[][])[1][2] = 99_999_999; }, "keyframe_value");
rejected((copy) => { copy.actions = [[3, 300, "slot", 9]]; }, "action_value");
rejected((copy) => { copy.actions = [[3, 300, "mine_authoritatively"]]; }, "action_value");
rejected((copy) => { copy.actions = [[3, 300, "swing", 1]]; }, "action_value");
const huge = { ...valid, batchId: `batch_${"x".repeat(MOTION_MAX_BATCH_CHARS)}` };
assert.deepEqual(decodeMotionBatch(huge), { ok: false, reason: "payload_size" });

// Exact replay is idempotent; stale/gapped sequences and operation-ID payload
// collisions are rejected. New sessions restart sequence at zero only.
let acceptance = createMotionAcceptanceState();
const accepted0 = acceptMotionBatch(acceptance, valid, 1_000);
assert.equal(accepted0.ok && accepted0.replay, false);
if (!accepted0.ok) throw new Error("fixture rejected");
acceptance = accepted0.state;
const replay0 = acceptMotionBatch(acceptance, structuredClone(valid), 1_001);
assert.equal(replay0.ok && replay0.replay, true);

const collision = structuredClone(valid);
collision.keyframes[1][2] += 1;
assert.deepEqual(
  acceptMotionBatch(acceptance, collision, 1_002).ok,
  false,
  "same operation ID with a changed canonical payload must not replay",
);
const gap = makeBatch(2);
const gapResult = acceptMotionBatch(acceptance, gap, 1_003);
assert.equal(gapResult.ok, false);
if (!gapResult.ok) assert.equal(gapResult.reason, "sequence_gap");
const stale = { ...makeBatch(1), batchId: "batch_stale_0001", firstSequence: 0, lastSequence: 6 };
const staleResult = acceptMotionBatch(acceptance, stale, 1_004);
assert.equal(staleResult.ok, false);
if (!staleResult.ok) assert.equal(staleResult.reason, "stale_sequence");
const accepted1 = acceptMotionBatch(acceptance, makeBatch(1), 2_000);
assert.equal(accepted1.ok, true);
if (!accepted1.ok) throw new Error("fixture rejected");
acceptance = accepted1.state;

const changedSession = makeBatch(0, 1);
const newSession = acceptMotionBatch(acceptance, changedSession, 3_000);
assert.equal(newSession.ok, true);
const changedSessionGap = makeBatch(1, 2);
const newSessionGap = acceptMotionBatch(acceptance, changedSessionGap, 3_001);
assert.equal(newSessionGap.ok, false);
if (!newSessionGap.ok) assert.equal(newSessionGap.reason, "sequence_gap");

// Receipts and rows have hard age/count limits.
let many: MotionAcceptanceState = createMotionAcceptanceState();
for (let index = 0; index < MOTION_RECEIPT_LIMIT + 10; index += 1) {
  const result = acceptMotionBatch(many, makeBatch(index), index * 100);
  assert.equal(result.ok, true);
  if (result.ok) many = result.state;
}
assert.equal(many.receipts.length, MOTION_RECEIPT_LIMIT);
const expired = acceptMotionBatch(many, makeBatch(MOTION_RECEIPT_LIMIT + 10), MOTION_RECEIPT_RETENTION_MS + 10_000);
assert.equal(expired.ok, true);
if (expired.ok) assert.ok(expired.state.receipts.length < MOTION_RECEIPT_LIMIT);
const retained = retainedMotionRows(
  Array.from({ length: 20 }, (_, index) => ({ id: index, acceptedAt: 50_000 - index * 1_000 })),
  50_000,
);
assert.equal(retained.length, MOTION_ROWS_PER_PLAYER);
assert.deepEqual(retained.map((row) => row.id), [0, 1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(retainedMotionRows([{ acceptedAt: 0 }], MOTION_ROW_RETENTION_MS + 1), []);

// Traffic gates are fail-closed and make no motion calls in offline,
// background, paused, quota-paused, exhausted, or peerless mutation states.
const baseGate: SegmentTrafficGate = {
  multiplayer: true,
  authenticated: true,
  visible: true,
  focused: true,
  paused: false,
  nearbyPlayers: 1,
  quotaPausedUntil: 0,
  mutationAttempts: 0,
  requestAttempts: 0,
  mutationGrant: 60,
  requestGrant: 900,
};
assert.deepEqual(decideSegmentTraffic(baseGate, "mutation", 1), { allow: true, mode: "active" });
assert.deepEqual(decideSegmentTraffic({ ...baseGate, multiplayer: false }, "request", 1), { allow: false, reason: "singleplayer" });
assert.deepEqual(decideSegmentTraffic({ ...baseGate, authenticated: false }, "request", 1), { allow: false, reason: "signed_out" });
assert.deepEqual(decideSegmentTraffic({ ...baseGate, visible: false }, "request", 1), { allow: false, reason: "background" });
assert.deepEqual(decideSegmentTraffic({ ...baseGate, focused: false }, "request", 1), { allow: false, reason: "background" });
assert.deepEqual(decideSegmentTraffic({ ...baseGate, paused: true }, "request", 1), { allow: false, reason: "paused" });
assert.deepEqual(decideSegmentTraffic({ ...baseGate, quotaPausedUntil: 2 }, "request", 1), { allow: false, reason: "quota_paused" });
assert.deepEqual(decideSegmentTraffic({ ...baseGate, mutationAttempts: 60 }, "mutation", 1), { allow: false, reason: "budget_exhausted" });
assert.deepEqual(decideSegmentTraffic({ ...baseGate, nearbyPlayers: 0 }, "mutation", 1), { allow: false, reason: "no_peers" });
assert.deepEqual(decideSegmentTraffic({ ...baseGate, nearbyPlayers: 0 }, "request", 1), { allow: true, mode: "discovery" });

// UTC-day budget hydration and debit are deterministic. Attempts are charged
// before transport, failures are never refunded, and an explicit 429 pause
// blocks both call types until the exact server reset.
const noon = Date.UTC(2026, 6, 15, 12);
assert.equal(utcQuotaWindowStartedAt(noon), Date.UTC(2026, 6, 15));
const budget = createSegmentBudgetState(noon);
for (let index = 0; index < 3; index += 1) assert.equal(reserveSegmentAttempt(budget, "mutation", 3, noon), true);
assert.equal(reserveSegmentAttempt(budget, "mutation", 3, noon), false);
assert.equal(budget.mutationAttempts, 3);
assert.equal(reserveSegmentAttempt(budget, "request", 2, noon), true);
pauseSegmentTrafficForQuota(budget, noon + 60_000, noon + 1);
assert.equal(reserveSegmentAttempt(budget, "request", 2, noon + 59_999), false);
assert.equal(reserveSegmentAttempt(budget, "request", 2, noon + 60_000), true);
assert.equal(createSegmentBudgetState(noon, budget).requestAttempts, 2, "reload retains attempted calls");
const corruptBudget = createSegmentBudgetState(noon, { ...budget, requestAttempts: -1 });
assert.equal(corruptBudget.requestAttempts, LAKEBED_REQUESTS_PER_UTC_DAY, "corrupt current-day state fails closed");
const nextDay = createSegmentBudgetState(Date.UTC(2026, 6, 16), budget);
assert.equal(nextDay.requestAttempts, 0, "midnight UTC starts the next observed Lakebed quota window");

// Deterministic replay interpolates, catches up at <=4x, emits actions once,
// limits extrapolation, and freezes stale avatars.
let replay = ingestRemoteBatch(null, makeBatch(0), 30_000, 30_050);
assert.ok(replay.cursorAt >= 29_700, "join starts near latest, not at the beginning of retained history");
const firstStep = stepRemoteReplay(replay, 30_150);
assert.deepEqual(firstStep.actions, [], "historical actions before a join are not replayed");
replay = firstStep.state;
replay = ingestRemoteBatch(replay, makeBatch(1), 60_000, 60_050);
let emitted = 0;
let sawCatchup = false;
for (let now = 60_150; now <= 75_000; now += 100) {
  const step = stepRemoteReplay(replay, now);
  replay = step.state;
  emitted += step.actions.length;
  sawCatchup ||= step.speed > 1;
  assert.ok(step.speed <= REMOTE_MAX_CATCH_UP_SPEED);
}
assert.equal(emitted, 1);
assert.equal(stepRemoteReplay(replay, 75_100).actions.length, 0, "visual actions emit once");
assert.equal(sawCatchup, true);
const beforeExtrapolation = replay.cursorAt;
for (let now = 75_100; now <= 90_000; now += 100) replay = stepRemoteReplay(replay, now).state;
assert.ok(replay.cursorAt <= 60_000 + REMOTE_MAX_EXTRAPOLATION_MS);
const staleStep = stepRemoteReplay(replay, 60_050 + REMOTE_STALE_AFTER_MS + 1);
assert.equal(staleStep.stale, true);
assert.ok(staleStep.state.cursorAt >= beforeExtrapolation);

// Ten-client, 30-minute deployment simulation. It proves exact quota counts,
// contiguous/idempotent acceptance, deterministic remote playback, bounded
// catch-up, and no request retry amplification. It intentionally does not call
// the cadence realtime: each remote recording arrives every 30 seconds.
function simulateTenClients(): { hash: string; motionMutations: number; requests: number; maxError: number } {
  const clients = Array.from({ length: 10 }, () => ({
    acceptance: createMotionAcceptanceState(),
    replay: null as RemoteReplayState | null,
    actionCount: 0,
  }));
  let motionMutations = 0;
  let requests = 0;
  let maxError = 0;
  const digest: string[] = [];

  // One composite request/player/2s. One batch/player/30s. A receiver follows
  // its next neighbor, which exercises ten independent remote timelines.
  for (let now = 100; now <= 1_800_000; now += 100) {
    if (now % 2_000 === 0) requests += 10;
    if (now % 30_000 === 0) {
      const batchNumber = now / 30_000 - 1;
      for (let player = 0; player < 10; player += 1) {
        const batch = makeBatch(batchNumber, player);
        const accepted = acceptMotionBatch(clients[player].acceptance, batch, now);
        assert.equal(accepted.ok, true);
        if (!accepted.ok) throw new Error("simulation batch rejected");
        clients[player].acceptance = accepted.state;
        motionMutations += 1;
        const receiver = (player + 9) % 10;
        clients[receiver].replay = ingestRemoteBatch(clients[receiver].replay, batch, now, now + 80);
      }
    }

    for (let receiver = 0; receiver < 10; receiver += 1) {
      if (!clients[receiver].replay) continue;
      const step = stepRemoteReplay(clients[receiver].replay!, now + 100);
      clients[receiver].replay = step.state;
      clients[receiver].actionCount += step.actions.length;
      assert.ok(step.speed <= REMOTE_MAX_CATCH_UP_SPEED);

      // Eight seconds after publication the bounded 4x replay is close to the
      // latest published pose. Between publications it visibly freezes/stales.
      if (now % 30_000 === 8_000) {
        const trackedPlayer = (receiver + 1) % 10;
        const targetX = trackedPlayer * 20 + (now - 8_000) / 10_000;
        maxError = Math.max(maxError, Math.abs(step.pose.x - targetX));
      }
    }
  }
  for (const client of clients) {
    const pose = client.replay!.pose;
    digest.push([
      pose.x.toFixed(4), pose.y.toFixed(4), pose.z.toFixed(4), pose.yaw.toFixed(4),
      client.actionCount, client.acceptance.acceptedThrough,
    ].join(":"));
  }
  return { hash: digest.join("|"), motionMutations, requests, maxError };
}

const simulationA = simulateTenClients();
const simulationB = simulateTenClients();
assert.deepEqual(simulationA, simulationB, "identical ten-client inputs must produce byte-identical replay summaries");
assert.equal(simulationA.motionMutations, 600);
assert.equal(simulationA.requests, 9_000);
assert.ok(simulationA.maxError < 1, `catch-up error was ${simulationA.maxError.toFixed(3)} blocks`);
assert.ok(simulationA.motionMutations + SEGMENT_ACTION_MUTATION_RESERVE <= LAKEBED_MUTATIONS_PER_UTC_DAY);
assert.ok(simulationA.requests + SEGMENT_OTHER_REQUEST_RESERVE <= LAKEBED_REQUESTS_PER_UTC_DAY);

console.log("multiplayer segment protocol tests passed", {
  tenClientMotionMutations: simulationA.motionMutations,
  tenClientCompositeRequests: simulationA.requests,
  catchUpMaxErrorBlocks: Number(simulationA.maxError.toFixed(3)),
  partyPublishSeconds: party.mutationIntervalMs / 1_000,
  partyReadSeconds: party.snapshotIntervalMs / 1_000,
});
