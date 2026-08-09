import assert from "node:assert/strict";
import {
  DEFAULT_FOV_RADIANS,
  FORWARD_SPRINT_DOUBLE_TAP_MS,
  SNEAKING_BODY_HEIGHT,
  SNEAKING_EYE_HEIGHT,
  SNEAK_SPEED,
  SPRINT_FOV_RADIANS,
  SPRINT_HUNGER_THRESHOLD,
  SPRINT_SPEED,
  STANDING_BODY_HEIGHT,
  STANDING_EYE_HEIGHT,
  WALK_SPEED,
  advanceHeadBob,
  clampSneakAxisMovement,
  createForwardSprintTapState,
  createHeadBobState,
  headBobProfileForMovement,
  movementFovRadians,
  movementActivityMultiplier,
  normalizeMovementInput,
  postureTargetsForMovement,
  resolvePlayerMovement,
  resolveSneakIntent,
  RELEASED_SPRINT_CONTROLS,
  resetHeadBob,
  sprintControlHeld,
  smoothMovementValue,
  smoothPlayerPosture,
  updateSprintControl,
  transitionForwardSprintTap,
  writeHorizontalMovementDelta,
  writePlayerEye,
  type PlayerMovementMode,
} from "../client/game/playerMovement.ts";

assert.equal(WALK_SPEED, 4.35);
assert.equal(SPRINT_SPEED, 5.6);
assert.equal(SNEAK_SPEED, 1.3);

const leftControl = updateSprintControl(RELEASED_SPRINT_CONTROLS, "ControlLeft", true);
assert.equal(sprintControlHeld(leftControl), true, "the first Ctrl press starts held sprint");
assert.equal(updateSprintControl(leftControl, "ControlLeft", true), leftControl, "native key repeat is idempotent");
const bothControls = updateSprintControl(leftControl, "ControlRight", true);
assert.equal(sprintControlHeld(updateSprintControl(bothControls, "ControlLeft", false)), true,
  "releasing one Ctrl preserves the independently held side");
assert.deepEqual(updateSprintControl(leftControl, "ControlLeft", false), RELEASED_SPRINT_CONTROLS,
  "releasing the held Ctrl stops sprint immediately");

assert.equal(FORWARD_SPRINT_DOUBLE_TAP_MS, 100);
const forwardTapStart = createForwardSprintTapState();
const firstForwardPress = transitionForwardSprintTap(forwardTapStart, 1_000, true);
assert.equal(firstForwardPress, forwardTapStart, "the first W press walks without sprinting");
const forwardTapArmed = transitionForwardSprintTap(firstForwardPress, 1_080, false);
assert.deepEqual(forwardTapArmed, { armedAt: 1_080, active: false });
const doubleTapSprint = transitionForwardSprintTap(forwardTapArmed, 1_150, true);
assert.equal(doubleTapSprint.active, true, "a second W press inside the tap window starts sprinting");
assert.equal(
  transitionForwardSprintTap(doubleTapSprint, 1_151, true, true),
  doubleTapSprint,
  "native repeats cannot retrigger or cancel double-tap sprint",
);
assert.deepEqual(
  transitionForwardSprintTap(doubleTapSprint, 1_500, false),
  createForwardSprintTapState(),
  "releasing the sprinting W press stops sprint without arming a third tap",
);
const expiredForwardTap = transitionForwardSprintTap(forwardTapArmed, 1_181, true);
assert.equal(expiredForwardTap.active, false, "a slow second W press remains a walk");
assert.equal(expiredForwardTap.armedAt, Number.NEGATIVE_INFINITY, "the expired first tap is consumed");
assert.equal(
  transitionForwardSprintTap(forwardTapArmed, Number.NaN, true),
  forwardTapArmed,
  "invalid clocks cannot corrupt the input state",
);

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
const configuredFov = 90 * Math.PI / 180;
assert.equal(movementFovRadians("idle", configuredFov), configuredFov,
  "ordinary movement preserves the configured base FOV");
assert.ok(Math.abs(movementFovRadians("sprint", configuredFov) - configuredFov * 1.1) < 1e-12,
  "sprinting widens any configured base FOV by the existing ten percent");
assert.equal(movementFovRadians("idle", Number.NaN), DEFAULT_FOV_RADIANS,
  "invalid live camera preferences fail closed to the default");

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

assert.deepEqual(headBobProfileForMovement("walk"), {
  strideLength: 2.7,
  horizontalAmplitude: 0.012,
  verticalAmplitude: 0.02,
});
assert.deepEqual(headBobProfileForMovement("sprint"), {
  strideLength: 3.1,
  horizontalAmplitude: 0.016,
  verticalAmplitude: 0.026,
});
assert.deepEqual(headBobProfileForMovement("sneak"), {
  strideLength: 2.4,
  horizontalAmplitude: 0.005,
  verticalAmplitude: 0.008,
});
assert.equal(headBobProfileForMovement("idle"), null);
assert.equal(headBobProfileForMovement("ladder"), null);

const reusedBob = createHeadBobState();
assert.equal(advanceHeadBob(reusedBob, "walk", WALK_SPEED / 60, true, 1 / 60, true, reusedBob), reusedBob,
  "caller state is reused");
for (let frame = 0; frame < 600; frame += 1) {
  advanceHeadBob(reusedBob, "sprint", SPRINT_SPEED / 60, true, 1 / 60, true, reusedBob);
  assert.ok(Number.isFinite(reusedBob.x) && Number.isFinite(reusedBob.y));
  assert.ok(Math.abs(reusedBob.x) <= 0.016 + Number.EPSILON, "horizontal bob is globally bounded");
  assert.ok(reusedBob.y <= 0 && reusedBob.y >= -0.026 - Number.EPSILON, "vertical bob is globally bounded");
}
const resetBob = resetHeadBob(reusedBob);
assert.equal(resetBob, reusedBob);
assert.deepEqual(resetBob, createHeadBobState());

assert.equal(clampSneakAxisMovement(0.08, () => true), 0.08, "supported walking keeps its full step");
const positiveEdge = clampSneakAxisMovement(0.08, (offset) => offset <= 0.03);
assert.ok(positiveEdge <= 0.03 && positiveEdge >= 0.029, "positive motion stops at the last supported footprint");
const negativeEdge = clampSneakAxisMovement(-0.08, (offset) => offset >= -0.025);
assert.ok(negativeEdge >= -0.025 && negativeEdge <= -0.024, "negative motion stops at the last supported footprint");
assert.equal(clampSneakAxisMovement(Number.NaN, () => true), 0);

console.log("lakecraft player movement tests: ok");
