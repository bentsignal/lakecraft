import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  SNEAK_SPEED,
  SPRINT_SPEED,
  WALK_SPEED,
  advanceHeadBob,
  createHeadBobState,
  headBobProfileForMovement,
  type HeadBobState,
  type PlayerMovementMode,
} from "../client/game/playerMovement.ts";

function simulate(
  mode: PlayerMovementMode,
  speed: number,
  framesPerSecond: number,
  seconds: number,
  state: HeadBobState = createHeadBobState(),
): HeadBobState {
  const frames = Math.round(framesPerSecond * seconds);
  for (let frame = 0; frame < frames; frame += 1) {
    advanceHeadBob(state, mode, speed / framesPerSecond, true, 1 / framesPerSecond, true, state);
  }
  return state;
}

function circularPhaseDelta(from: number, to: number): number {
  const fullTurn = Math.PI * 2;
  return (to - from + fullTurn) % fullTurn;
}

const frameRates = [30, 60, 120].map((fps) => simulate("walk", WALK_SPEED, fps, 2));
for (const state of frameRates.slice(1)) {
  assert.ok(Math.abs(state.phase - frameRates[0].phase) < 1e-12, "distance phase is frame-rate invariant");
  assert.ok(Math.abs(state.envelope - frameRates[0].envelope) < 1e-12, "start smoothing is frame-rate invariant");
  assert.ok(Math.abs(state.x - frameRates[0].x) < 1e-12, "sampled lateral offset is frame-rate invariant");
  assert.ok(Math.abs(state.y - frameRates[0].y) < 1e-12, "sampled vertical offset is frame-rate invariant");
}

for (const [mode, speed] of [
  ["walk", WALK_SPEED],
  ["sprint", SPRINT_SPEED],
  ["sneak", SNEAK_SPEED],
] as const) {
  const profile = headBobProfileForMovement(mode);
  assert.ok(profile);
  const state = simulate(mode, speed, 60, 3);
  const expectedPhase = (speed * 3 * Math.PI * 2 / profile.strideLength) % (Math.PI * 2);
  assert.ok(Math.abs(state.phase - expectedPhase) < 1e-12, `${mode} phase follows accepted ground distance`);
  assert.ok(Math.abs(state.x) <= profile.horizontalAmplitude + Number.EPSILON);
  assert.ok(state.y <= 0 && state.y >= -profile.verticalAmplitude - Number.EPSILON);
}

const walkProfile = headBobProfileForMovement("walk")!;
const sprintProfile = headBobProfileForMovement("sprint")!;
const sneakProfile = headBobProfileForMovement("sneak")!;
const walkVerticalCadence = WALK_SPEED * 2 / walkProfile.strideLength;
const sprintVerticalCadence = SPRINT_SPEED * 2 / sprintProfile.strideLength;
const sneakVerticalCadence = SNEAK_SPEED * 2 / sneakProfile.strideLength;
assert.ok(sprintVerticalCadence > walkVerticalCadence, "sprint remains visibly quicker than walking");
assert.ok(sprintVerticalCadence < 3.75, "sprint stays below an aggressive four vertical dips per second");
assert.ok(sprintVerticalCadence / walkVerticalCadence < 1.15, "sprint cadence does not scale directly with run speed");
assert.ok(sneakVerticalCadence < 1.1, "sneaking keeps a separate slow gait");

const transition = simulate("walk", WALK_SPEED, 60, 2);
const walkPhase = transition.phase;
const walkHorizontalAmplitude = transition.horizontalAmplitude;
advanceHeadBob(transition, "sprint", SPRINT_SPEED / 60, true, 1 / 60, true, transition);
assert.ok(Math.abs(
  circularPhaseDelta(walkPhase, transition.phase)
    - SPRINT_SPEED / 60 * Math.PI * 2 / sprintProfile.strideLength,
) < 1e-12, "walk-to-sprint changes cadence without resetting or reprojecting phase");
assert.ok(transition.horizontalAmplitude > walkHorizontalAmplitude);
assert.ok(transition.horizontalAmplitude < sprintProfile.horizontalAmplitude,
  "walk-to-sprint amplitude eases toward its new posture");

let largestTransitionStep = 0;
let previousX = transition.x;
let previousY = transition.y;
for (let frame = 0; frame < 30; frame += 1) {
  advanceHeadBob(transition, "sneak", SNEAK_SPEED / 60, true, 1 / 60, true, transition);
  largestTransitionStep = Math.max(
    largestTransitionStep,
    Math.hypot(transition.x - previousX, transition.y - previousY),
  );
  previousX = transition.x;
  previousY = transition.y;
}
assert.ok(largestTransitionStep < 0.006, "sprint-to-sneak posture changes have no camera snap");
assert.ok(transition.horizontalAmplitude > sneakProfile.horizontalAmplitude,
  "profile smoothing does not jump directly to the sneak amplitude");

const stopped = simulate("sprint", SPRINT_SPEED, 60, 2);
const stoppedPhase = stopped.phase;
const envelopeBeforeStop = stopped.envelope;
advanceHeadBob(stopped, "sprint", 0, true, 1 / 60, true, stopped);
assert.equal(stopped.phase, stoppedPhase, "blocked or stationary frames freeze gait phase");
assert.ok(stopped.envelope < envelopeBeforeStop && stopped.envelope > 0, "stopping eases the envelope toward rest");
for (let frame = 0; frame < 120; frame += 1) {
  advanceHeadBob(stopped, "sprint", 0, true, 1 / 60, true, stopped);
}
assert.ok(stopped.envelope < 1e-8 && Math.hypot(stopped.x, stopped.y) < 1e-8,
  "stationary bob converges smoothly to zero");

for (const [mode, grounded, allowed, label] of [
  ["sprint", false, true, "airborne"],
  ["ladder", true, true, "ladder"],
  ["walk", true, false, "reduced motion"],
] as const) {
  const state = simulate("walk", WALK_SPEED, 60, 1);
  const phase = state.phase;
  advanceHeadBob(state, mode, WALK_SPEED / 60, grounded, 1 / 60, allowed, state);
  assert.equal(state.phase, phase, `${label} frames cannot advance gait`);
  assert.ok(state.envelope < 1, `${label} frames decay toward a still camera`);
}
const reducedMotion = createHeadBobState();
for (let frame = 0; frame < 120; frame += 1) {
  advanceHeadBob(reducedMotion, "sprint", SPRINT_SPEED / 60, true, 1 / 60, false, reducedMotion);
}
assert.deepEqual(reducedMotion, createHeadBobState(), "reduced-motion users never acquire camera bob");

const invalid = createHeadBobState();
advanceHeadBob(invalid, "sprint", Number.POSITIVE_INFINITY, true, Number.NaN, true, invalid);
assert.ok(Object.values(invalid).every(Number.isFinite), "invalid frame inputs fail closed to finite state");

const benchmarkState = createHeadBobState();
const benchmarkStartedAt = performance.now();
for (let sample = 0; sample < 200_000; sample += 1) {
  advanceHeadBob(benchmarkState, "sprint", SPRINT_SPEED / 60, true, 1 / 60, true, benchmarkState);
}
const benchmarkElapsedMs = performance.now() - benchmarkStartedAt;
assert.ok(benchmarkElapsedMs < 2_000, `head-bob sampling exceeded its frame-loop budget: ${benchmarkElapsedMs}ms`);
console.log(JSON.stringify({
  benchmark: "allocation-free grounded head-bob sampling",
  samples: 200_000,
  elapsedMs: Number(benchmarkElapsedMs.toFixed(2)),
  walkVerticalCadence: Number(walkVerticalCadence.toFixed(2)),
  sprintVerticalCadence: Number(sprintVerticalCadence.toFixed(2)),
  sneakVerticalCadence: Number(sneakVerticalCadence.toFixed(2)),
}));

console.log("grounded view-bob cadence, continuity, and frame-rate tests passed");
