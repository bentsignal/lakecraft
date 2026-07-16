import assert from "node:assert/strict";
import { resolveSafeSpawnY } from "../client/game/voxelEngine.ts";

assert.equal(resolveSafeSpawnY(8, 7.02, () => false), 8, "a clear resumed pose is preserved");
assert.equal(resolveSafeSpawnY(3.02, 3.02, () => false), 3.02, "a clear underground bed stays underground");
assert.equal(resolveSafeSpawnY(1, 7.02, () => false), 7.02, "an underground reconnect returns to the local surface");
assert.equal(
  resolveSafeSpawnY(4, 7.02, (y) => y < 9),
  9.02,
  "a pose embedded in terrain is lifted to the first half-block clearance",
);
assert.equal(
  resolveSafeSpawnY(7.02, 7.02, (y) => y < 8.02),
  8.02,
  "an obstructed bed lifts in half-block steps to the first clear full-body pose",
);
assert.equal(
  resolveSafeSpawnY(7.02, 7.02, (y) => y === 7.02),
  7.52,
  "a feet/head collision at the saved pose chooses the immediate clear candidate",
);
assert.equal(
  resolveSafeSpawnY(Number.NaN, 7.02, (y) => y < 7),
  7.02,
  "invalid saved height falls back to the surface",
);

console.log("lakecraft safe spawn tests: ok");
