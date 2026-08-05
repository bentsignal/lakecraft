import assert from "node:assert/strict";
import {
  nextPlayerCameraMode,
  writePlayerCamera,
  type PlayerCameraMode,
} from "../client/game/playerCamera.ts";

let mode: PlayerCameraMode = "first_person";
mode = nextPlayerCameraMode(mode); assert.equal(mode, "third_person_back");
mode = nextPlayerCameraMode(mode); assert.equal(mode, "third_person_front");
mode = nextPlayerCameraMode(mode); assert.equal(mode, "first_person");

const eye: [number, number, number] = [0, 0, 0];
const facing: [number, number, number] = [0, 0, 0];
writePlayerCamera(eye, facing, "first_person", [2, 3, 4], [0, 0, -1], () => false);
assert.deepEqual(eye, [2, 3, 4]); assert.deepEqual(facing, [0, 0, -1]);

writePlayerCamera(eye, facing, "third_person_back", [0, 2, 0], [0, 0, -1], () => false);
assert.deepEqual(eye, [0, 1.8, 4]);
assert.ok(facing[2] < -0.99, "rear camera looks back toward the player");

writePlayerCamera(eye, facing, "third_person_front", [0, 2, 0], [0, 0, -1], () => false);
assert.deepEqual(eye, [0, 1.8, -4]);
assert.ok(facing[2] > 0.99, "front camera looks at the player's face");

writePlayerCamera(eye, facing, "third_person_back", [0, 2, 0], [0, 0, -1], (_x, _y, z) => z >= 2);
assert.ok(eye[2] > 1.5 && eye[2] < 2, "camera stops in front of a blocking wall");
assert.ok(Math.abs(Math.hypot(...facing) - 1) < 1e-6);
console.log("three-state player camera tests passed");
