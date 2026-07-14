import assert from "node:assert/strict";
import {
  MAX_PLAYER_NAME_LENGTH,
  advanceRemoteAvatarMotion,
  applyRemoteAvatarSnapshot,
  createRemoteAvatarMotion,
  sanitizePlayerName,
  shortestAngleDelta,
} from "../client/game/avatar.ts";
import type { RemotePlayer } from "../client/game/types.ts";

function player(overrides: Partial<RemotePlayer> = {}): RemotePlayer {
  return {
    id: "alice",
    name: "Alice",
    x: 0,
    y: 8,
    z: 0,
    yaw: 0,
    pitch: 0,
    ...overrides,
  };
}

assert.equal(sanitizePlayerName("  <b>Alice</b>\n  "), "?b?Alice??b?");
assert.equal(sanitizePlayerName(""), "Player");
assert.equal(sanitizePlayerName("x".repeat(100)).length, MAX_PLAYER_NAME_LENGTH);
assert.ok(Math.abs(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 0.0001);

const motion = createRemoteAvatarMotion(player(), 0);
applyRemoteAvatarSnapshot(motion, player({ x: 4, z: -2, yaw: Math.PI / 2 }), 200);
assert.equal(motion.rendered.x, 0, "a sparse snapshot must not teleport the rendered avatar");
advanceRemoteAvatarMotion(motion, 216, 0.016);
assert.ok(motion.rendered.x > 0 && motion.rendered.x < 4, "interpolation should advance without snapping");
assert.ok(motion.horizontalSpeed > 0, "interpolated velocity should drive a walk cycle");
assert.notEqual(motion.walkPhase, 0);

for (let frame = 0; frame < 120; frame += 1) {
  advanceRemoteAvatarMotion(motion, 232 + frame * 16, 0.016);
}
assert.ok(Math.abs(motion.rendered.x - motion.target.x) < 0.05, "stale motion should settle at the last snapshot");
assert.ok(Number.isFinite(motion.bodyYaw));

const malicious = createRemoteAvatarMotion(player({ x: Number.NaN, y: Infinity, name: "\u0000Bob<script>" }), 0);
assert.deepEqual([malicious.rendered.x, malicious.rendered.y], [0, 0]);
assert.equal(malicious.name, "Bob?script?");

console.log("lakecraft avatar tests: ok");
