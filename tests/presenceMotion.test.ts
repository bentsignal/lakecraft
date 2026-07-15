import assert from "node:assert/strict";
import {
  PRESENCE_ACTIVE_WRITE_INTERVAL_MS,
  PRESENCE_ACTIVE_WRITES_PER_SECOND,
  PRESENCE_ACTIVE_LEASE_MS,
  PRESENCE_ACTION_MUTATION_RESERVE,
  PRESENCE_BUDGET_WINDOW_MS,
  PRESENCE_CLAIMED_MUTATIONS_PER_DAY,
  PRESENCE_CLAIMED_REQUESTS_PER_DAY,
  PRESENCE_EXPECTED_BURST_PLAYERS,
  PRESENCE_FAILURE_BACKOFF_BASE_MS,
  PRESENCE_GENERIC_REJECTION_LIMIT,
  PRESENCE_IDLE_WRITES_PER_MINUTE,
  PRESENCE_LEASE_REFRESH_MS,
  PRESENCE_MAX_IN_FLIGHT_WRITES,
  PRESENCE_MAX_ACTIVE_WRITES_PER_DAY,
  PRESENCE_MAX_EXTRAPOLATION_MS,
  PRESENCE_MAX_HORIZONTAL_SPEED,
  PRESENCE_MAX_IDLE_WRITES_PER_DAY,
  PRESENCE_MAX_VERTICAL_EXTRAPOLATION_MS,
  PRESENCE_MAX_VERTICAL_SPEED,
  PRESENCE_MAX_WRITES_PER_MINUTE,
  PRESENCE_MIN_WRITE_INTERVAL_MS,
  PRESENCE_MOTION_PAYLOAD_MAX_CHARS,
  PRESENCE_REALTIME_BURST_WRITES,
  PRESENCE_SAMPLE_INTERVAL_MS,
  PRESENCE_SESSION_WRITE_BUDGET,
  PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_DAY,
  PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_MINUTE,
  PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS,
  classifyPresenceTransportError,
  computePresenceVelocity,
  createPresenceBurstGuardState,
  createPresenceSchedulerState,
  encodePresenceVelocityFields,
  parsePresenceVelocityFields,
  parsePersistedPresencePose,
  presenceBurstGuardSnapshot,
  presencePoseAgePercentiles,
  presenceTransportQuotaResetAt,
  presenceExtrapolationSeconds,
  recordPresenceFailure,
  recordPresenceRateLimit,
  recordPresenceSuccess,
  reservePresenceAttempt,
  stepPresenceScheduler,
  validatePresenceVelocityFields,
  type PresencePoseSample,
} from "../shared/presenceMotion.ts";

function sample(at: number, overrides: Partial<PresencePoseSample> = {}): PresencePoseSample {
  return { x: 0, y: 8, z: 0, yaw: 0, pitch: 0, at, ...overrides };
}

const capped = computePresenceVelocity(sample(0), sample(1_000, { x: 30, y: 100, z: 40 }));
assert.ok(Math.hypot(capped.vx, capped.vz) <= PRESENCE_MAX_HORIZONTAL_SPEED);
assert.ok(Math.hypot(capped.vx, capped.vz) >= PRESENCE_MAX_HORIZONTAL_SPEED - 0.1);
assert.equal(capped.vy, PRESENCE_MAX_VERTICAL_SPEED);
assert.deepEqual(computePresenceVelocity(sample(0), sample(1_000, { x: 1.023 })), { vx: 1, vy: 0, vz: 0 });
assert.deepEqual(computePresenceVelocity(sample(1_000), sample(1_000, { x: 5 })), { vx: 0, vy: 0, vz: 0 });
assert.deepEqual(computePresenceVelocity(null, sample(0)), { vx: 0, vy: 0, vz: 0 });

assert.deepEqual(validatePresenceVelocityFields("3", "-2.5", "4"), { vx: 3, vy: -2.5, vz: 4 });
assert.equal(validatePresenceVelocityFields("15", "0", "0"), null);
assert.equal(validatePresenceVelocityFields("0", "25", "0"), null);
assert.equal(validatePresenceVelocityFields("1e1", "0", "0"), null);
assert.equal(validatePresenceVelocityFields("1234567890123", "0", "0"), null);
assert.deepEqual(parsePresenceVelocityFields({}), { vx: 0, vy: 0, vz: 0 });
assert.deepEqual(parsePresenceVelocityFields({ vx: "3", vy: "0", vz: "-4" }), { vx: 3, vy: 0, vz: -4 });
assert.deepEqual(parsePresenceVelocityFields({ velocityX: "2", velocityY: "1", velocityZ: "-2" }), { vx: 2, vy: 1, vz: -2 });
assert.deepEqual(parsePresenceVelocityFields({ vx: "bad", vy: "0", vz: "0" }), { vx: 0, vy: 0, vz: 0 });
assert.deepEqual(encodePresenceVelocityFields({ vx: Infinity, vy: 0, vz: 0 }), { vx: "0", vy: "0", vz: "0" });
assert.deepEqual(parsePersistedPresencePose({ x: "1.5", y: "8", z: "-2", yaw: "3.14", pitch: "-.5" }), {
  x: 1.5,
  y: 8,
  z: -2,
  yaw: 3.14,
  pitch: -0.5,
});
assert.equal(parsePersistedPresencePose({ x: "1000001", y: "8", z: "0", yaw: "0", pitch: "0" }), null);
assert.equal(parsePersistedPresencePose({ x: "0", y: "8", z: "0", yaw: "0", pitch: "NaN" }), null);

const first = createPresenceSchedulerState();
const firstDecision = stepPresenceScheduler(first, sample(42));
assert.equal(firstDecision.send && firstDecision.reason, "join", "first valid sample must force the join write");
const gated = stepPresenceScheduler(first, sample(43, { x: 1 }));
assert.equal(gated.send, false);
assert.equal(gated.reason, "motion_start");
assert.equal(gated.waitMs, PRESENCE_MIN_WRITE_INTERVAL_MS - 1);

// A meaningful change after idle is sent immediately; active motion then
// settles into the deterministic 5 Hz cadence.
const wake = createPresenceSchedulerState();
stepPresenceScheduler(wake, sample(0));
const wakeDecision = stepPresenceScheduler(wake, sample(1_000, { x: 1 }));
assert.equal(wakeDecision.send && wakeDecision.reason, "motion_start");
const activeGated = stepPresenceScheduler(wake, sample(1_100, { x: 1.1 }));
assert.equal(activeGated.send, false);
assert.equal(activeGated.waitMs, 100);
const activeDue = stepPresenceScheduler(wake, sample(1_200, { x: 1.2 }));
assert.equal(activeDue.send && activeDue.reason, "active");

// A stopped transition outranks a simultaneously-due heading/position update.
const priority = createPresenceSchedulerState();
stepPresenceScheduler(priority, sample(0));
stepPresenceScheduler(priority, sample(PRESENCE_MIN_WRITE_INTERVAL_MS, { x: 4 }));
const stopped = stepPresenceScheduler(priority, sample(PRESENCE_MIN_WRITE_INTERVAL_MS * 2, { x: 4, yaw: Math.PI }));
assert.equal(stopped.send && stopped.reason, "motion_stop");

assert.equal(presenceExtrapolationSeconds(-1), 0);
assert.equal(presenceExtrapolationSeconds(250), 0.25);
assert.equal(presenceExtrapolationSeconds(99_000), PRESENCE_MAX_EXTRAPOLATION_MS / 1_000);
assert.ok(PRESENCE_MAX_VERTICAL_EXTRAPOLATION_MS < PRESENCE_MAX_EXTRAPOLATION_MS);
assert.ok(PRESENCE_LEASE_REFRESH_MS < PRESENCE_ACTIVE_LEASE_MS, "refresh deadline must stay safely inside the active lease");

type Scenario = (at: number) => Partial<PresencePoseSample>;

function runHour(scenario: Scenario, realtime = true): number[] {
  const state = createPresenceSchedulerState();
  const writes: number[] = [];
  // Half-open hour: [0, 3_600_000). This makes writes/minute arithmetic exact.
  for (let at = 0; at < 3_600_000; at += PRESENCE_SAMPLE_INTERVAL_MS) {
    const decision = stepPresenceScheduler(state, sample(at, scenario(at)), realtime);
    if (decision.send) {
      writes.push(at);
      const payload = JSON.stringify({
        x: String(scenario(at).x ?? 0),
        y: String(scenario(at).y ?? 8),
        z: String(scenario(at).z ?? 0),
        yaw: String(scenario(at).yaw ?? 0),
        pitch: "0",
        heartbeatAt: String(at),
        ...decision.fields,
      });
      assert.ok(payload.length <= PRESENCE_MOTION_PAYLOAD_MAX_CHARS, `presence payload was ${payload.length} chars`);
    }
  }
  let windowEnd = 0;
  for (let windowStart = 0; windowStart < writes.length; windowStart += 1) {
    while (windowEnd < writes.length && writes[windowEnd] < writes[windowStart] + 60_000) windowEnd += 1;
    const windowWrites = windowEnd - windowStart;
    assert.ok(windowWrites <= PRESENCE_MAX_WRITES_PER_MINUTE, `${windowWrites} writes in minute at ${writes[windowStart]}`);
  }
  for (let index = 1; index < writes.length; index += 1) {
    assert.ok(writes[index] - writes[index - 1] >= PRESENCE_MIN_WRITE_INTERVAL_MS);
  }
  return writes;
}

const idleWrites = runHour(() => ({}));
const straightWrites = runHour((at) => ({ x: ((at / 1_000) * 4) % 200 - 100 }));
const turnSpamWrites = runHour((at) => ({ yaw: (at / 1_000) * Math.PI }));
const soloMovingWrites = runHour((at) => ({ x: ((at / 1_000) * 4) % 200 - 100 }), false);

assert.equal(idleWrites.length, 60);
assert.ok(Math.max(...idleWrites.slice(1).map((at, index) => at - idleWrites[index])) <= PRESENCE_LEASE_REFRESH_MS);
assert.equal(straightWrites.length, PRESENCE_ACTIVE_WRITES_PER_SECOND * 60 * 60);
assert.equal(turnSpamWrites.length, PRESENCE_ACTIVE_WRITES_PER_SECOND * 60 * 60);
assert.equal(soloMovingWrites.length, idleWrites.length, "solo movement must not burn the realtime request budget");
assert.equal(PRESENCE_ACTIVE_WRITE_INTERVAL_MS, 200);
assert.equal(PRESENCE_MAX_WRITES_PER_MINUTE, 300);
assert.equal(PRESENCE_MAX_ACTIVE_WRITES_PER_DAY, PRESENCE_SESSION_WRITE_BUDGET);
assert.equal(PRESENCE_IDLE_WRITES_PER_MINUTE, 1);
assert.equal(PRESENCE_MAX_IDLE_WRITES_PER_DAY, PRESENCE_SESSION_WRITE_BUDGET);
assert.equal(PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS, 150);
assert.equal(PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_MINUTE, 400);
assert.equal(PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_DAY, 576_000);
assert.equal(PRESENCE_MAX_IN_FLIGHT_WRITES, 2);

// The outer browser-day guard makes the deliberately expensive 5 Hz cadence a
// bounded burst instead of pretending 432k daily writes fit a 1k quota.
assert.equal(PRESENCE_CLAIMED_MUTATIONS_PER_DAY, 1_000);
assert.equal(PRESENCE_CLAIMED_REQUESTS_PER_DAY, 10_000);
assert.equal(PRESENCE_EXPECTED_BURST_PLAYERS, 2);
assert.equal(PRESENCE_ACTION_MUTATION_RESERVE, 100);
assert.equal(PRESENCE_SESSION_WRITE_BUDGET, 450);
assert.equal(PRESENCE_REALTIME_BURST_WRITES, 300);
assert.equal(
  PRESENCE_SESSION_WRITE_BUDGET * PRESENCE_EXPECTED_BURST_PLAYERS + PRESENCE_ACTION_MUTATION_RESERVE,
  PRESENCE_CLAIMED_MUTATIONS_PER_DAY,
);

const guarded = createPresenceBurstGuardState(0);
assert.deepEqual(presenceBurstGuardSnapshot(guarded, 0, false), {
  mode: "solo",
  cadenceHz: 1 / 60,
  canAttempt: true,
  sessionRemaining: 450,
  realtimeRemaining: 300,
  confirmedCount: 0,
  attemptCount: 0,
  retryInMs: 0,
  windowResetsInMs: PRESENCE_BUDGET_WINDOW_MS,
});
for (let write = 0; write < PRESENCE_REALTIME_BURST_WRITES; write += 1) {
  const at = write * PRESENCE_ACTIVE_WRITE_INTERVAL_MS;
  assert.equal(reservePresenceAttempt(guarded, at, true), true);
  recordPresenceSuccess(guarded, at);
}
const degraded = presenceBurstGuardSnapshot(guarded, 60_000, true);
assert.equal(degraded.mode, "degraded");
assert.equal(degraded.cadenceHz, 1 / 60);
assert.equal(degraded.realtimeRemaining, 0);
assert.equal(degraded.sessionRemaining, 150);
assert.equal(reservePresenceAttempt(guarded, 60_000, true), false, "realtime cannot overrun its burst allocation");
for (let lease = 0; lease < 150; lease += 1) {
  assert.equal(reservePresenceAttempt(guarded, 60_000 + lease * 60_000, false), true);
  recordPresenceSuccess(guarded, 60_000 + lease * 60_000);
}
assert.equal(presenceBurstGuardSnapshot(guarded, 9_100_000, true).mode, "budget_exhausted");
assert.equal(reservePresenceAttempt(guarded, 9_100_000, false), false);

const hydratedGuard = createPresenceBurstGuardState(9_100_001, JSON.parse(JSON.stringify(guarded)));
assert.equal(hydratedGuard.attemptCount, PRESENCE_SESSION_WRITE_BUDGET, "reloads retain the browser-day budget");
const recoveredGuard = createPresenceBurstGuardState(PRESENCE_BUDGET_WINDOW_MS + 1, hydratedGuard);
assert.equal(recoveredGuard.attemptCount, 0, "the next rolling day deterministically recovers the budget");
assert.equal(presenceBurstGuardSnapshot(recoveredGuard, PRESENCE_BUDGET_WINDOW_MS + 1, true).mode, "burst");

const transient = createPresenceBurstGuardState(0);
assert.equal(reservePresenceAttempt(transient, 0, true), true);
recordPresenceFailure(transient, 0, "transient");
assert.equal(presenceBurstGuardSnapshot(transient, 999, true).mode, "backoff");
assert.equal(reservePresenceAttempt(transient, 999, true), false);
assert.equal(reservePresenceAttempt(transient, PRESENCE_FAILURE_BACKOFF_BASE_MS, true), true);
recordPresenceSuccess(transient, PRESENCE_FAILURE_BACKOFF_BASE_MS);
assert.equal(presenceBurstGuardSnapshot(transient, PRESENCE_FAILURE_BACKOFF_BASE_MS, true).mode, "burst");

const opaqueRejections = createPresenceBurstGuardState(0);
let rejectionAt = 0;
let lastRejectionAt = 0;
for (let failure = 0; failure < PRESENCE_GENERIC_REJECTION_LIMIT; failure += 1) {
  lastRejectionAt = rejectionAt;
  assert.equal(reservePresenceAttempt(opaqueRejections, rejectionAt, true), true);
  recordPresenceFailure(opaqueRejections, rejectionAt, "transient");
  rejectionAt = opaqueRejections.blockedUntilAt;
}
assert.equal(presenceBurstGuardSnapshot(opaqueRejections, lastRejectionAt + 1, true).mode, "quota_paused");
assert.equal(reservePresenceAttempt(opaqueRejections, lastRejectionAt + 60_000, true), false, "opaque retry storms stop");
assert.equal(
  presenceBurstGuardSnapshot(opaqueRejections, PRESENCE_BUDGET_WINDOW_MS, true).mode,
  "burst",
  "rolling-window recovery clears a terminal pause",
);

const explicitQuota = createPresenceBurstGuardState(0);
assert.equal(reservePresenceAttempt(explicitQuota, 0, true), true);
recordPresenceFailure(explicitQuota, 0, classifyPresenceTransportError(new Error("429 quota exceeded")), 60_000);
assert.equal(presenceBurstGuardSnapshot(explicitQuota, 1, true).mode, "quota_paused");
recordPresenceSuccess(explicitQuota, 100);
assert.equal(presenceBurstGuardSnapshot(explicitQuota, 100, true).mode, "quota_paused", "a late sibling success cannot clear quota pause");
assert.equal(explicitQuota.confirmedCount, 0);
recordPresenceRateLimit(explicitQuota, 150, 175);
assert.equal(explicitQuota.blockedUntilAt, 60_000, "a late cadence rejection cannot shorten quota pause");
recordPresenceFailure(explicitQuota, 200, "transient");
assert.equal(explicitQuota.blockedUntilAt, 60_000, "a late transient failure cannot shorten quota pause");
assert.equal(presenceBurstGuardSnapshot(explicitQuota, 59_999, true).canAttempt, false);
assert.equal(presenceBurstGuardSnapshot(explicitQuota, 60_000, true).mode, "burst", "the same guard resumes at reset without reload");
assert.equal(reservePresenceAttempt(explicitQuota, 60_000, true), true);

const delayedQuota = createPresenceBurstGuardState(0);
recordPresenceFailure(delayedQuota, 0, "quota", PRESENCE_BUDGET_WINDOW_MS + 5_000);
assert.equal(presenceBurstGuardSnapshot(delayedQuota, PRESENCE_BUDGET_WINDOW_MS, true).mode, "quota_paused");
const rehydratedDelayedQuota = createPresenceBurstGuardState(
  PRESENCE_BUDGET_WINDOW_MS + 1,
  JSON.parse(JSON.stringify(delayedQuota)),
);
assert.equal(presenceBurstGuardSnapshot(rehydratedDelayedQuota, PRESENCE_BUDGET_WINDOW_MS + 1, true).mode, "quota_paused");
assert.equal(presenceBurstGuardSnapshot(rehydratedDelayedQuota, PRESENCE_BUDGET_WINDOW_MS + 5_000, true).mode, "burst");

const rateLimited = createPresenceBurstGuardState(0);
assert.equal(reservePresenceAttempt(rateLimited, 0, true), true);
recordPresenceRateLimit(rateLimited, 0, 175);
assert.equal(rateLimited.consecutiveFailures, 0, "ordinary cadence jitter never escalates to terminal quota pause");
assert.equal(presenceBurstGuardSnapshot(rateLimited, 174, true).mode, "backoff");
assert.equal(presenceBurstGuardSnapshot(rateLimited, 175, true).mode, "burst");

const resetNow = Date.parse("2026-07-15T12:00:00.000Z");
assert.equal(presenceTransportQuotaResetAt({ resetAt: resetNow + 2_000 }, resetNow), resetNow + 2_000);
assert.equal(presenceTransportQuotaResetAt({ retryAfterSeconds: 3 }, resetNow), resetNow + 3_000);
assert.equal(presenceTransportQuotaResetAt(new Error("429 retry-after 2500ms"), resetNow), resetNow + 2_500);
assert.equal(presenceTransportQuotaResetAt(new Error("429 Retry-After: 3"), resetNow), resetNow + 3_000);
assert.equal(
  presenceTransportQuotaResetAt(new Error("quota resets 2026-07-15T12:00:05.000Z"), resetNow),
  resetNow + 5_000,
);
assert.equal(
  presenceTransportQuotaResetAt(new Error("429 quota exceeded"), resetNow),
  Date.parse("2026-07-16T00:00:00.000Z"),
);

assert.deepEqual(presencePoseAgePercentiles([210, 55, 90, 140, 75, 125, 180, 100]), {
  count: 8,
  p50: 100,
  p95: 210,
});
assert.deepEqual(presencePoseAgePercentiles([-1, Number.NaN, 99.6]), { count: 1, p50: 100, p95: 100 });
assert.equal(classifyPresenceTransportError(new Error("Mutation rejected")), "transient");
assert.equal(classifyPresenceTransportError("resource exhausted"), "quota");

console.log(JSON.stringify({
  benchmark: "raw scheduler envelope plus browser-day Lakebed burst guard",
  idleWrites: idleWrites.length,
  soloMovingWrites: soloMovingWrites.length,
  unguardedStraightWrites: straightWrites.length,
  unguardedTurnSpamWrites: turnSpamWrites.length,
  guardedRealtimeWrites: PRESENCE_REALTIME_BURST_WRITES,
  guardedSessionWrites: PRESENCE_SESSION_WRITE_BUDGET,
  maximumWritesPerMinute: PRESENCE_MAX_WRITES_PER_MINUTE,
  leaseRefreshMs: PRESENCE_LEASE_REFRESH_MS,
  minimumWriteIntervalMs: PRESENCE_MIN_WRITE_INTERVAL_MS,
}));
console.log("lakecraft presence motion tests: ok");
