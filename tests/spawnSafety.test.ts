import assert from "node:assert/strict";
import { resolveSafeSpawnY } from "../client/game/voxelEngine.ts";

assert.equal(resolveSafeSpawnY(8, 7.02, () => false), 8, "a clear resumed pose is preserved");
assert.equal(resolveSafeSpawnY(1, 7.02, () => false), 7.02, "an underground reconnect returns to the local surface");
assert.equal(
  resolveSafeSpawnY(4, 7.02, (y) => y < 9),
  9.02,
  "a pose embedded in terrain is lifted to the first half-block clearance",
);
assert.equal(
  resolveSafeSpawnY(Number.NaN, 7.02, (y) => y < 7),
  7.02,
  "invalid saved height falls back to the surface",
);

console.log("lakecraft safe spawn tests: ok");
