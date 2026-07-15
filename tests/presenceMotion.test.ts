import assert from "node:assert/strict";
import {
  PRESENCE_ACTIVE_WRITE_INTERVAL_MS,
  PRESENCE_ACTIVE_WRITES_PER_SECOND,
  PRESENCE_ACTIVE_LEASE_MS,
  PRESENCE_IDLE_WRITES_PER_MINUTE,
  PRESENCE_LEASE_REFRESH_MS,
  PRESENCE_MAX_ACTIVE_WRITES_PER_DAY,
  PRESENCE_MAX_EXTRAPOLATION_MS,
  PRESENCE_MAX_HORIZONTAL_SPEED,
  PRESENCE_MAX_IDLE_WRITES_PER_DAY,
  PRESENCE_MAX_VERTICAL_EXTRAPOLATION_MS,
  PRESENCE_MAX_VERTICAL_SPEED,
  PRESENCE_MAX_WRITES_PER_MINUTE,
  PRESENCE_MIN_WRITE_INTERVAL_MS,
  PRESENCE_MOTION_PAYLOAD_MAX_CHARS,
  PRESENCE_SAMPLE_INTERVAL_MS,
  PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_DAY,
  PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_MINUTE,
  PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS,
  computePresenceVelocity,
  createPresenceSchedulerState,
  encodePresenceVelocityFields,
  parsePresenceVelocityFields,
  parsePersistedPresencePose,
  presenceExtrapolationSeconds,
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
assert.equal(PRESENCE_MAX_ACTIVE_WRITES_PER_DAY, 432_000);
assert.equal(PRESENCE_IDLE_WRITES_PER_MINUTE, 1);
assert.equal(PRESENCE_MAX_IDLE_WRITES_PER_DAY, 1_440);
assert.equal(PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS, 150);
assert.equal(PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_MINUTE, 400);
assert.equal(PRESENCE_SERVER_MAX_ACCEPTED_WRITES_PER_DAY, 576_000);

console.log(JSON.stringify({
  benchmark: "multiplayer-only 5 Hz Lakebed presence over one hour",
  idleWrites: idleWrites.length,
  soloMovingWrites: soloMovingWrites.length,
  straightWrites: straightWrites.length,
  turnSpamWrites: turnSpamWrites.length,
  maximumWritesPerMinute: PRESENCE_MAX_WRITES_PER_MINUTE,
  leaseRefreshMs: PRESENCE_LEASE_REFRESH_MS,
  minimumWriteIntervalMs: PRESENCE_MIN_WRITE_INTERVAL_MS,
}));
console.log("lakecraft presence motion tests: ok");
