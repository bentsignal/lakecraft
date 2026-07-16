import assert from "node:assert/strict";
import {
  DEFAULT_FOV_RADIANS,
  SNEAKING_BODY_HEIGHT,
  SNEAKING_EYE_HEIGHT,
  SNEAK_SPEED,
  SPRINT_FOV_RADIANS,
  SPRINT_HUNGER_THRESHOLD,
  SPRINT_SPEED,
  STANDING_BODY_HEIGHT,
  STANDING_EYE_HEIGHT,
  WALK_SPEED,
  clampSneakAxisMovement,
  movementActivityMultiplier,
  normalizeMovementInput,
  postureTargetsForMovement,
  resolvePlayerMovement,
  resolveSneakIntent,
  sampleHeadBob,
  shouldHoldSprintAfterControlKeyDown,
  smoothMovementValue,
  smoothPlayerPosture,
  writeHorizontalMovementDelta,
  writePlayerEye,
  type PlayerMovementMode,
} from "../client/game/playerMovement.ts";

assert.equal(WALK_SPEED, 4.35);
assert.equal(SPRINT_SPEED, 5.6);
assert.equal(SNEAK_SPEED, 1.3);

assert.equal(shouldHoldSprintAfterControlKeyDown(false, false), true, "the first Ctrl press starts held sprint");
assert.equal(shouldHoldSprintAfterControlKeyDown(true, true), true, "native key repeat cannot toggle sprint off");
assert.equal(shouldHoldSprintAfterControlKeyDown(true, false), false,
  "a fresh Ctrl press clears stale state when the browser lost the prior keyup");

const diagonal = normalizeMovementInput(1, 1);
assert.ok(Math.abs(diagonal.magnitude - 1) < 1e-12, "diagonal input is normalized");
assert.ok(Math.abs(diagonal.forward - Math.SQRT1_2) < 1e-12);
assert.ok(Math.abs(diagonal.strafe - Math.SQRT1_2) < 1e-12);
assert.deepEqual(normalizeMovementInput(Number.NaN, Number.POSITIVE_INFINITY), {
  forward: 0,
  strafe: 0,
  magnitude: 0,
});
const clampedDiagonal = normalizeMovementInput(1_000, -1_000);
assert.ok(Math.abs(clampedDiagonal.forward - Math.SQRT1_2) < 1e-12);
assert.ok(Math.abs(clampedDiagonal.strafe + Math.SQRT1_2) < 1e-12);
assert.equal(clampedDiagonal.magnitude, 1);

const base = {
  forward: 0,
  strafe: 0,
  sprintHeld: false,
  sneakHeld: false,
  onLadder: false,
  hunger: 20,
};
assert.equal(resolvePlayerMovement(base).mode, "idle");
assert.equal(resolvePlayerMovement({ ...base, sneakHeld: true }).mode, "sneak", "posture remains crouched while still");
assert.equal(resolvePlayerMovement({ ...base, sneakHeld: true }).activityMultiplier, 0.5, "stationary crouch is idle exertion");
assert.equal(resolvePlayerMovement({ ...base, forward: 1 }).mode, "walk");
assert.equal(resolvePlayerMovement({ ...base, forward: 1, sprintHeld: true }).mode, "sprint");
assert.equal(resolvePlayerMovement({ ...base, forward: 1, sprintHeld: true }).speed, SPRINT_SPEED);
assert.equal(
  resolvePlayerMovement({ ...base, forward: 1, sprintHeld: true, hunger: SPRINT_HUNGER_THRESHOLD }).mode,
  "walk",
  "sprinting requires more than six hunger points",
);
assert.equal(resolvePlayerMovement({ ...base, forward: 1, sprintHeld: true, hunger: Number.NaN }).mode, "walk");
assert.equal(resolvePlayerMovement({ ...base, strafe: 1, sprintHeld: true }).mode, "walk", "strafe alone cannot sprint");
assert.equal(resolvePlayerMovement({ ...base, forward: -1, sprintHeld: true }).mode, "walk", "backpedaling cannot sprint");
assert.equal(
  resolvePlayerMovement({ ...base, forward: 1, sprintHeld: true, sneakHeld: true }).mode,
  "sneak",
  "sneaking takes precedence over sprinting",
);
assert.equal(resolvePlayerMovement({ ...base, forward: 1, sneakHeld: true }).speed, SNEAK_SPEED);
assert.equal(resolvePlayerMovement({ ...base, onLadder: true, sneakHeld: true, sprintHeld: true }).mode, "ladder");
assert.equal(resolvePlayerMovement({ ...base, onLadder: true }).activityMultiplier, 0.5, "touching a ladder is not movement");
assert.equal(resolvePlayerMovement({ ...base, onLadder: true, ladderMotion: true }).activityMultiplier, 2);

const expectedActivity: Record<PlayerMovementMode, number> = {
  idle: 0.5,
  sneak: 1,
  walk: 2,
  sprint: 3,
  ladder: 2,
};
for (const mode of Object.keys(expectedActivity) as PlayerMovementMode[]) {
  assert.equal(movementActivityMultiplier(mode), expectedActivity[mode]);
}
assert.equal(resolvePlayerMovement(base).activityMultiplier, expectedActivity.idle);
assert.equal(resolvePlayerMovement({ ...base, forward: 1 }).activityMultiplier, expectedActivity.walk);
assert.equal(resolvePlayerMovement({ ...base, forward: 1, sprintHeld: true }).activityMultiplier, expectedActivity.sprint);
assert.equal(resolvePlayerMovement({ ...base, forward: 1, sneakHeld: true }).activityMultiplier, expectedActivity.sneak);
assert.equal(resolvePlayerMovement({ ...base, onLadder: true, ladderMotion: true }).activityMultiplier, expectedActivity.ladder);

let clearanceChecks = 0;
assert.equal(resolveSneakIntent(true, "walk", () => { clearanceChecks += 1; return false; }), true);
assert.equal(resolveSneakIntent(false, "walk", () => { clearanceChecks += 1; return true; }), false);
assert.equal(clearanceChecks, 0, "standing clearance is lazy outside the sneak-release edge");
assert.equal(resolveSneakIntent(false, "sneak", () => { clearanceChecks += 1; return true; }), true);
assert.equal(resolveSneakIntent(false, "sneak", () => { clearanceChecks += 1; return false; }), false);
assert.equal(clearanceChecks, 2);

const oneSecondWalk = { forward: 1, strafe: 0, speed: WALK_SPEED };
assert.deepEqual(writeHorizontalMovementDelta(0, oneSecondWalk, 0.1), { x: 0, z: -WALK_SPEED * 0.1 });
const yawRight = writeHorizontalMovementDelta(Math.PI / 2, oneSecondWalk, 0.1);
assert.ok(Math.abs(yawRight.x - WALK_SPEED * 0.1) < 1e-12 && Math.abs(yawRight.z) < 1e-12);
const diagonalWorld = writeHorizontalMovementDelta(0, resolvePlayerMovement({ ...base, forward: 1, strafe: 1 }), 0.1);
assert.ok(Math.abs(Math.hypot(diagonalWorld.x, diagonalWorld.z) - WALK_SPEED * 0.1) < 1e-12, "world-space diagonal speed stays normalized");

const postureEye = writePlayerEye(4, 10, -2, 0, SNEAKING_EYE_HEIGHT, { x: 0, y: 0 });
assert.deepEqual(postureEye, [4, 10 + SNEAKING_EYE_HEIGHT, -2]);
const visualEye = writePlayerEye(4, 10, -2, Math.PI / 2, SNEAKING_EYE_HEIGHT, { x: 0.02, y: -0.01 });
assert.ok(Math.abs(visualEye[0] - 4) < 1e-12);
assert.ok(Math.abs(visualEye[1] - (10 + SNEAKING_EYE_HEIGHT - 0.01)) < 1e-12);
assert.ok(Math.abs(visualEye[2] - -1.98) < 1e-12);

assert.deepEqual(postureTargetsForMovement("idle"), {
  eyeHeight: STANDING_EYE_HEIGHT,
  bodyHeight: STANDING_BODY_HEIGHT,
  fovRadians: DEFAULT_FOV_RADIANS,
});
assert.deepEqual(postureTargetsForMovement("sneak"), {
  eyeHeight: SNEAKING_EYE_HEIGHT,
  bodyHeight: SNEAKING_BODY_HEIGHT,
  fovRadians: DEFAULT_FOV_RADIANS,
});
assert.equal(postureTargetsForMovement("sprint").fovRadians, SPRINT_FOV_RADIANS);

let smoothed = DEFAULT_FOV_RADIANS;
for (let frame = 0; frame < 600; frame += 1) {
  const next = smoothMovementValue(smoothed, SPRINT_FOV_RADIANS, 1 / 60);
  assert.ok(next >= smoothed && next <= SPRINT_FOV_RADIANS, "smoothing cannot overshoot");
  smoothed = next;
}
assert.ok(Math.abs(smoothed - SPRINT_FOV_RADIANS) < 1e-10, "smoothing converges to the target");
assert.equal(smoothMovementValue(Number.NaN, 4, Number.NaN), 4);
assert.equal(smoothMovementValue(4, Number.NaN, 1), 4);

const current = { ...postureTargetsForMovement("idle") };
const target = postureTargetsForMovement("sneak");
const output = { ...current };
assert.equal(smoothPlayerPosture(current, target, 1 / 60, output), output, "caller output is reused");
assert.ok(output.eyeHeight < current.eyeHeight && output.eyeHeight >= target.eyeHeight);
assert.ok(output.bodyHeight < current.bodyHeight && output.bodyHeight >= target.bodyHeight);

const reusedBob = { x: 99, y: 99 };
assert.equal(sampleHeadBob("walk", 1, true, reusedBob), reusedBob, "caller output is reused");
for (const mode of ["walk", "sprint", "sneak", "ladder"] as const) {
  for (let step = -1_000; step <= 1_000; step += 7) {
    const bob = sampleHeadBob(mode, step / 13, true);
    assert.ok(Number.isFinite(bob.x) && Number.isFinite(bob.y));
    assert.ok(Math.abs(bob.x) <= 0.032 + Number.EPSILON, "horizontal bob is globally bounded");
    assert.ok(bob.y <= 0 && bob.y >= -0.05 - Number.EPSILON, "vertical bob is globally bounded");
  }
}
assert.deepEqual(sampleHeadBob("idle", 4, true), { x: 0, y: 0 });
assert.deepEqual(sampleHeadBob("sprint", 4, false), { x: 0, y: 0 });
assert.deepEqual(sampleHeadBob("sprint", Number.NaN, true), { x: 0, y: 0 });

assert.equal(clampSneakAxisMovement(0.08, () => true), 0.08, "supported walking keeps its full step");
const positiveEdge = clampSneakAxisMovement(0.08, (offset) => offset <= 0.03);
assert.ok(positiveEdge <= 0.03 && positiveEdge >= 0.029, "positive motion stops at the last supported footprint");
const negativeEdge = clampSneakAxisMovement(-0.08, (offset) => offset >= -0.025);
assert.ok(negativeEdge >= -0.025 && negativeEdge <= -0.024, "negative motion stops at the last supported footprint");
assert.equal(clampSneakAxisMovement(Number.NaN, () => true), 0);

console.log("lakecraft player movement tests: ok");
