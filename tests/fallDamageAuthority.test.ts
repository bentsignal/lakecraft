import assert from "node:assert/strict";
import {
  advanceAuthoritativeFall,
  fallDamageForDistance,
  resetAuthoritativeFallState,
  type AuthoritativeFallResult,
  type StoredAuthoritativeFallState,
} from "../shared/fallDamageAuthority.ts";

const grounded = (y: number): StoredAuthoritativeFallState => ({ grounded: true, fallPeakY: String(y) });

function accepted(result: AuthoritativeFallResult) {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function transition(
  state: StoredAuthoritativeFallState | null,
  previousY: number,
  nextY: number,
  supported: boolean,
  overrides: Partial<Parameters<typeof advanceAuthoritativeFall>[0]> = {},
) {
  return advanceAuthoritativeFall({
    state,
    previousY,
    nextY,
    supported,
    onLadder: false,
    relocated: false,
    directDrop: false,
    health: 20,
    revision: 4,
    ...overrides,
  });
}

assert.equal(fallDamageForDistance(0), 0);
assert.equal(fallDamageForDistance(3), 0);
assert.equal(fallDamageForDistance(3.01), 1);
assert.equal(fallDamageForDistance(10), 7);
assert.equal(fallDamageForDistance(Number.NaN), 0);
assert.deepEqual(resetAuthoritativeFallState(32), { grounded: true, fallPeakY: "32" });
assert.equal(resetAuthoritativeFallState(129), null);

// A ten-block fall tracks its highest accepted airborne pose and applies seven
// unarmored damage on the single airborne-to-supported transition.
const takeoff = accepted(transition(grounded(20), 20, 20, false));
assert.deepEqual(takeoff.state, { grounded: false, fallPeakY: "20" });
const falling = accepted(transition(takeoff.state, 20, 14, false));
assert.deepEqual(falling.state, { grounded: false, fallPeakY: "20" });
const tenBlockLanding = accepted(transition(falling.state, 14, 10, true));
assert.deepEqual(
  [tenBlockLanding.fallDistance, tenBlockLanding.damage, tenBlockLanding.health, tenBlockLanding.revision],
  [10, 7, 13, 5],
);
assert.equal(tenBlockLanding.landed, true);
assert.equal(tenBlockLanding.healthChanged, true);

const sparseDirectLanding = accepted(transition(grounded(20), 20, 10, true, { directDrop: true }));
assert.deepEqual(
  [sparseDirectLanding.fallDistance, sparseDirectLanding.damage, sparseDirectLanding.health, sparseDirectLanding.revision],
  [10, 7, 13, 5],
  "a conservative sparse direct-drop fallback applies the same landing rule",
);
const sparseReplay = accepted(transition(sparseDirectLanding.state, 10, 10, true, {
  directDrop: true,
  health: sparseDirectLanding.health,
  revision: sparseDirectLanding.revision,
}));
assert.equal(sparseReplay.damage, 0, "the direct-drop fallback is one-shot after the canonical pose advances");

const replayedLanding = accepted(transition(tenBlockLanding.state, 10, 10, true, {
  health: tenBlockLanding.health,
  revision: tenBlockLanding.revision,
}));
assert.deepEqual(
  [replayedLanding.damage, replayedLanding.health, replayedLanding.revision, replayedLanding.landed],
  [0, 13, 5, false],
  "a second accepted grounded pose cannot duplicate landing damage",
);

for (const distance of [0, 1, 2.5, 3]) {
  const air = accepted(transition(grounded(20), 20, 20, false));
  const landed = accepted(transition(air.state, 20, 20 - distance, true));
  assert.deepEqual([landed.damage, landed.health, landed.revision], [0, 20, 4]);
}

// Rising after takeoff raises the peak; descending snapshots never lower it.
const jumped = accepted(transition(grounded(10), 10, 11, false));
const rose = accepted(transition(jumped.state, 11, 15.5, false));
const descended = accepted(transition(rose.state, 15.5, 12, false));
assert.equal(descended.state.fallPeakY, "15.5");
const jumpLanding = accepted(transition(descended.state, 12, 10, true));
assert.deepEqual([jumpLanding.fallDistance, jumpLanding.damage], [5.5, 3]);

const ladderReset = accepted(transition({ grounded: false, fallPeakY: "40" }, 12, 11, false, {
  onLadder: true,
}));
assert.deepEqual(ladderReset.state, { grounded: true, fallPeakY: "11" });
assert.deepEqual([ladderReset.damage, ladderReset.reset], [0, "ladder"]);
const afterLadder = accepted(transition(ladderReset.state, 11, 10, true));
assert.equal(afterLadder.damage, 0, "ladder contact clears the dangerous peak");

const relocationReset = accepted(transition({ grounded: false, fallPeakY: "100" }, 20, 5, true, {
  relocated: true,
}));
assert.deepEqual(relocationReset.state, { grounded: true, fallPeakY: "5" });
assert.deepEqual([relocationReset.damage, relocationReset.reset], [0, "relocation"]);

const respawnReset = accepted(transition({ grounded: false, fallPeakY: "80" }, 1, 32, true, {
  relocated: true,
  health: 20,
  revision: 9,
}));
assert.deepEqual([respawnReset.state.grounded, respawnReset.state.fallPeakY, respawnReset.damage], [true, "32", 0]);

const fatalAir = accepted(transition(grounded(20), 20, 20, false, { health: 4, revision: 12 }));
const fatal = accepted(transition(fatalAir.state, 20, 10, true, { health: 4, revision: 12 }));
assert.deepEqual([fatal.damage, fatal.health, fatal.revision, fatal.killed], [7, 0, 13, true]);

const exhaustedAir = accepted(transition(grounded(20), 20, 20, false, {
  health: 20,
  revision: Number.MAX_SAFE_INTEGER,
}));
assert.deepEqual(
  transition(exhaustedAir.state, 20, 10, true, { health: 20, revision: Number.MAX_SAFE_INTEGER }),
  { ok: false, reason: "revision_exhausted" },
  "revision exhaustion fails the landing transaction without silently consuming it",
);

for (const [label, overrides, reason] of [
  ["NaN height", { nextY: Number.NaN }, "invalid_height"],
  ["out-of-world height", { nextY: 129 }, "invalid_height"],
  ["numeric support claim", { supported: 1 }, "invalid_flags"],
  ["fractional health", { health: 19.5 }, "invalid_combat"],
  ["negative revision", { revision: -1 }, "invalid_combat"],
] as const) {
  assert.deepEqual(transition(grounded(20), 20, 20, true, overrides), { ok: false, reason }, label);
}

assert.deepEqual(
  transition({ grounded: false, fallPeakY: "Infinity" }, 20, 10, true),
  { ok: false, reason: "invalid_state" },
);
assert.deepEqual(
  transition({ grounded: false, fallPeakY: "020" }, 20, 10, true),
  { ok: false, reason: "invalid_state" },
  "stored heights must use the canonical numeric grammar",
);

console.log("authoritative fall reducer tests passed");
