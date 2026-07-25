import assert from "node:assert/strict";
import { raycastRemotePlayers } from "../client/game/remotePlayerTargeting.ts";

const player = (id: string, x: number, y: number, z: number, name = id) => ({
  id,
  name,
  rendered: { x, y, z, yaw: 0, pitch: 0 },
});

assert.deepEqual(
  raycastRemotePlayers([0, 1.62, 0], [0, 0, -1], [player("near", 0, 0, -2), player("far", 0, 0, -4)], 6),
  { id: "near", name: "near", distance: 1.66 },
);
assert.equal(raycastRemotePlayers([0, 1.62, 0], [0, 0, -1], [player("side", 1, 0, -2)], 6), null);
assert.equal(raycastRemotePlayers([0, 1.62, 0], [0, 0, -1], [player("far", 0, 0, -7)], 6), null);
assert.equal(raycastRemotePlayers([0, 3, 0], [0, 0, -1], [player("low", 0, 0, -2)], 6), null);
assert.deepEqual(
  raycastRemotePlayers([0, 1.62, 0], [0, 0, -4], [player("normalized", 0, 0, -3, "Alice")], 6),
  { id: "normalized", name: "Alice", distance: 2.66 },
);
assert.equal(raycastRemotePlayers([0, 1.62, 0], [0, 0, 0], [player("bad", 0, 0, -2)], 6), null);
assert.equal(raycastRemotePlayers([0, 1.62, 0], [0, 0, -1], [player("bad", Number.NaN, 0, -2)], 6), null);

console.log("remote player crosshair targeting tests passed");
