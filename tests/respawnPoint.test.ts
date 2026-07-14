import assert from "node:assert/strict";
import { MAX_RESPAWN_HEIGHT, validateRespawnPoint } from "../client/game/voxelEngine.ts";

assert.deepEqual(validateRespawnPoint({ x: 4.5, y: 12, z: -3.5 }), {
  x: 4.5,
  y: 12,
  z: -3.5,
  yaw: 0,
  pitch: -0.08,
});
assert.deepEqual(validateRespawnPoint({ x: 64, y: MAX_RESPAWN_HEIGHT, z: -64 }), {
  x: 64,
  y: MAX_RESPAWN_HEIGHT,
  z: -64,
  yaw: 0,
  pitch: -0.08,
});
assert.equal(validateRespawnPoint({ x: 64.001, y: 10, z: 0 }), null);
assert.equal(validateRespawnPoint({ x: 0, y: -0.001, z: 0 }), null);
assert.equal(validateRespawnPoint({ x: 0, y: MAX_RESPAWN_HEIGHT + 0.001, z: 0 }), null);
assert.equal(validateRespawnPoint({ x: Number.NaN, y: 10, z: 0 }), null);
assert.equal(validateRespawnPoint({ x: 0, y: 10, z: 0, yaw: Infinity }), null);
assert.equal(validateRespawnPoint({ x: 0, y: 10, z: 0 }, 0), null);

const oriented = validateRespawnPoint({ x: 1, y: 2, z: 3, yaw: Math.PI * 3, pitch: 9 });
assert.ok(oriented);
assert.ok(Math.abs(oriented.yaw + Math.PI) < 1e-12, "yaw should wrap into [-pi, pi)");
assert.equal(oriented.pitch, 1.52, "pitch should clamp to the engine look limit");

console.log("lakecraft respawn point tests: ok");
