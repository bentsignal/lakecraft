import assert from "node:assert/strict";
import {
  ACTIVE_PLAYER_WINDOW_MS,
  MORNING_PHASE,
  SLEEP_VOTE_FRESH_MS,
  WORLD_CLOCK_KEY,
  WORLD_CYCLE_LENGTH_MS,
  morningClockSnapshot,
  normalizeWorldPhase,
  sleepVoteStatus,
  validateSleepCoordinate,
  worldClockSnapshot,
  worldPhaseAt,
} from "../shared/sleep.ts";

assert.equal(normalizeWorldPhase(1.25), 0.25);
assert.equal(normalizeWorldPhase(-0.25), 0.75);
assert.equal(worldPhaseAt(1_000, 1_000, 0), 0);
assert.equal(worldPhaseAt(1_000 + WORLD_CYCLE_LENGTH_MS / 4, 1_000, 0), 0.25);
assert.equal(worldPhaseAt(1_000 + WORLD_CYCLE_LENGTH_MS, 1_000, 0.25), 0.25);

assert.deepEqual(worldClockSnapshot(null, 5_000), {
  key: WORLD_CLOCK_KEY,
  epochMs: 0,
  epochPhase: 0,
  cycleLengthMs: WORLD_CYCLE_LENGTH_MS,
  serverNow: 5_000,
});
assert.deepEqual(worldClockSnapshot({ epochMs: "1000", epochPhase: "1.25" }, 5_000), {
  key: WORLD_CLOCK_KEY,
  epochMs: 1_000,
  epochPhase: 0.25,
  cycleLengthMs: WORLD_CYCLE_LENGTH_MS,
  serverNow: 5_000,
});
const morning = morningClockSnapshot(42_000);
assert.equal(morning.epochMs, 42_000);
assert.equal(morning.epochPhase, MORNING_PHASE);
assert.equal(worldPhaseAt(morning.serverNow, morning.epochMs, morning.epochPhase), MORNING_PHASE);

assert.deepEqual(validateSleepCoordinate(" 01:7:-03 "), { ok: true, coordKey: "1:7:-3", x: 1, y: 7, z: -3 });
for (const invalid of ["", "1:2", "1:2:3:4", "1.2:3:4", "65:1:1", "1:-5:1", "1:1:-65"]) {
  assert.deepEqual(validateSleepCoordinate(invalid), { ok: false, reason: "invalid_coordinate" });
}

const now = 100_000;
const presences = [
  { userId: "bob", heartbeatAt: String(now - 100), online: true },
  { userId: "alice", heartbeatAt: String(now - 200), online: true },
  // Legacy duplicate: the newest presence above wins.
  { userId: "alice", heartbeatAt: String(now - 10_000), online: false },
  { userId: "offline", heartbeatAt: String(now), online: false },
  { userId: "stale", heartbeatAt: String(now - ACTIVE_PLAYER_WINDOW_MS - 1), online: true },
  { userId: "future", heartbeatAt: String(now + 5_001), online: true },
];

const waiting = sleepVoteStatus(presences, [
  { userId: "alice", votedAt: String(now) },
  { userId: "stale", votedAt: String(now) },
], now);
assert.deepEqual(waiting.activePlayerIds, ["alice", "bob"]);
assert.deepEqual(waiting.freshVoterIds, ["alice"]);
assert.equal(waiting.activePlayers, 2);
assert.equal(waiting.sleepingPlayers, 1);
assert.equal(waiting.requiredPlayers, 2);
assert.equal(waiting.reached, false);

const unanimous = sleepVoteStatus(presences, [
  { userId: "alice", votedAt: String(now - SLEEP_VOTE_FRESH_MS) },
  { userId: "alice", votedAt: String(now - 10) },
  { userId: "bob", votedAt: String(now) },
], now);
assert.deepEqual(unanimous.freshVoterIds, ["alice", "bob"]);
assert.equal(unanimous.reached, true, "all active players with fresh votes should advance morning");

const staleVote = sleepVoteStatus(presences, [
  { userId: "alice", votedAt: String(now - SLEEP_VOTE_FRESH_MS - 1) },
  { userId: "bob", votedAt: String(now) },
], now);
assert.deepEqual(staleVote.freshVoterIds, ["bob"]);
assert.equal(staleVote.reached, false);

const noPlayers = sleepVoteStatus([], [{ userId: "alice", votedAt: String(now) }], now);
assert.equal(noPlayers.requiredPlayers, 0);
assert.equal(noPlayers.reached, false, "sleep requires at least one active authenticated player");

console.log("lakecraft shared sleep vote and clock tests: ok");
