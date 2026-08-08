import assert from "node:assert/strict";
import {
  createThirdPersonFacingState,
  stepThirdPersonFacing,
} from "../client/game/thirdPersonFacing.ts";

const initial = createThirdPersonFacingState(0, 0);
const smallLook = stepThirdPersonFacing(initial, 0.4, -0.2, false, 1 / 60);
assert.equal(smallLook.bodyYaw, 0, "stationary look turns the head before dragging the torso");
assert.ok(Math.abs(smallLook.headYaw - 0.4) < 1e-12);
assert.equal(smallLook.headPitch, -0.2);

let largeLook = initial;
for (let frame = 0; frame < 60; frame += 1) {
  largeLook = stepThirdPersonFacing(largeLook, Math.PI, 0, false, 1 / 60);
}
assert.ok(Math.abs(largeLook.bodyYaw) > 0.5, "the torso catches up when look exceeds the neck limit");
assert.ok(Math.abs(largeLook.headYaw) <= Math.PI * 0.42 + 1e-12, "head yaw remains anatomically bounded");

let moving = createThirdPersonFacingState(0, 0);
for (let frame = 0; frame < 30; frame += 1) {
  moving = stepThirdPersonFacing(moving, Math.PI / 2, 0, true, 1 / 60);
}
assert.ok(Math.abs(moving.bodyYaw - Math.PI / 2) < 0.01, "movement promptly aligns the torso with camera look");
assert.ok(Math.abs(moving.headYaw) < 0.01, "head recenters as the moving torso catches up");

let strafing = createThirdPersonFacingState(0, 0);
for (let frame = 0; frame < 30; frame += 1) {
  strafing = stepThirdPersonFacing(strafing, 0, 0, true, 1 / 60);
}
assert.ok(Math.abs(strafing.bodyYaw) < 0.01,
  "sideways and backward movement never turns the torso away from camera look");
assert.ok(Math.abs(strafing.headYaw) < 0.01, "the head and moving torso share one world-facing convention");

assert.deepEqual(createThirdPersonFacingState(Number.NaN, Number.POSITIVE_INFINITY), {
  bodyYaw: 0,
  headYaw: 0,
  headPitch: 0,
});

console.log("third-person player-facing tests passed");
