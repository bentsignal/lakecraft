import assert from "node:assert/strict";
import {
  MAX_PLAYER_NAME_LENGTH,
  advanceRemoteAvatarMotion,
  applyRemoteAvatarSnapshot,
  createRemoteAvatarMotion,
  resolveRemoteAvatarRigPose,
  sanitizePlayerName,
  sanitizeRemoteArmor,
  sanitizeRemoteHeldItem,
  shortestAngleDelta,
} from "../client/game/avatar.ts";
import { playerRigCycleMilliseconds } from "../client/game/playerRig.ts";
import { PRESENCE_MAX_EXTRAPOLATION_MS, PRESENCE_MAX_HORIZONTAL_SPEED, PRESENCE_MAX_VERTICAL_EXTRAPOLATION_MS, PRESENCE_MAX_VERTICAL_SPEED, PRESENCE_MAX_X } from "../shared/presenceMotion.ts";
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
assert.equal(sanitizeRemoteHeldItem("iron_pickaxe"), "iron_pickaxe");
assert.equal(sanitizeRemoteHeldItem("sand"), "sand");
assert.equal(sanitizeRemoteHeldItem("constructor"), null, "prototype keys are not item IDs");
assert.equal(sanitizeRemoteHeldItem("obsidian_sword"), null);
assert.equal(sanitizeRemoteArmor("iron_helmet", "head"), "iron_helmet");
assert.equal(sanitizeRemoteArmor("leather_chestplate", "chest"), "leather_chestplate");
assert.equal(sanitizeRemoteArmor("iron_chestplate", "head"), null, "armor must match the exact remote slot");
assert.equal(sanitizeRemoteArmor("stone", "head"), null);
assert.ok(Math.abs(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 0.0001);

const motion = createRemoteAvatarMotion(player(), 0);
assert.deepEqual(
  [motion.heldItem, motion.armorHead, motion.armorChest, motion.armorLegs, motion.armorFeet],
  [null, null, null, null, null],
  "legacy presence snapshots render an ungeared Steve",
);
applyRemoteAvatarSnapshot(motion, player({ x: 4, z: -2, yaw: Math.PI / 2 }), 200);
assert.equal(motion.rendered.x, 0, "a sparse snapshot must not teleport the rendered avatar");
advanceRemoteAvatarMotion(motion, 216, 0.016);
assert.ok(motion.rendered.x > 0 && motion.rendered.x < 4, "interpolation should advance without snapping");
assert.ok(motion.horizontalSpeed > 0, "interpolated velocity should drive a walk cycle");
assert.notEqual(motion.walkPhase, 0);

for (let frame = 0; frame < 300; frame += 1) {
  advanceRemoteAvatarMotion(motion, 232 + frame * 16, 0.016);
}
assert.ok(motion.rendered.x <= motion.target.x + PRESENCE_MAX_HORIZONTAL_SPEED * PRESENCE_MAX_EXTRAPOLATION_MS / 1_000, "stale motion stays inside the extrapolation budget");
assert.ok(Number.isFinite(motion.bodyYaw));

const explicit = createRemoteAvatarMotion(player({ vx: 4, vy: 2, vz: 0 }), 0);
advanceRemoteAvatarMotion(explicit, 2_000, 0.1);
assert.ok(explicit.rendered.x > 0, "explicit velocity extrapolates sparse Lakebed snapshots");
assert.ok(explicit.rendered.y > 8, "explicit vertical velocity is preferred when present");
const beforeCap = explicit.rendered.x;
for (let frame = 0; frame < 100; frame += 1) {
  advanceRemoteAvatarMotion(explicit, 4_000 + frame * 16, 0.016);
}
assert.ok(explicit.rendered.x >= beforeCap);
assert.ok(explicit.rendered.x <= 4 * PRESENCE_MAX_EXTRAPOLATION_MS / 1_000 + 0.001, "extrapolation freezes at the shared time cap");

applyRemoteAvatarSnapshot(explicit, player({ x: 3, y: 8, vx: 0, vy: 0, vz: 0 }), 6_000);
assert.deepEqual([explicit.velocityX, explicit.velocityY, explicit.velocityZ], [0, 0, 0], "an explicit stop correction clears motion immediately");
for (let frame = 0; frame < 90; frame += 1) {
  advanceRemoteAvatarMotion(explicit, 6_016 + frame * 16, 0.016);
}
assert.ok(Math.abs(explicit.rendered.x - 3) < 0.01, "a stop correction promptly settles on the authoritative position");

const bounded = createRemoteAvatarMotion(player({ vx: 1_000, vy: -1_000, vz: 1_000 }), 0);
assert.ok(Math.hypot(bounded.velocityX, bounded.velocityZ) <= PRESENCE_MAX_HORIZONTAL_SPEED + 1e-9);
assert.equal(bounded.velocityY, -PRESENCE_MAX_VERTICAL_SPEED);
advanceRemoteAvatarMotion(bounded, 10_000, 0.1);
assert.ok(
  bounded.rendered.y >= 8 - PRESENCE_MAX_VERTICAL_SPEED * PRESENCE_MAX_VERTICAL_EXTRAPOLATION_MS / 1_000,
  "delayed jump/fall snapshots cannot extrapolate vertically for the full horizontal horizon",
);

const positionBounded = createRemoteAvatarMotion(player({ x: 1_000_001, vx: PRESENCE_MAX_HORIZONTAL_SPEED }), 0);
advanceRemoteAvatarMotion(positionBounded, PRESENCE_MAX_EXTRAPOLATION_MS, 0.1);
assert.equal(positionBounded.rendered.x, PRESENCE_MAX_X, "malicious positions and prediction remain inside server-compatible world bounds");

const malicious = createRemoteAvatarMotion(player({ x: Number.NaN, y: Infinity, name: "\u0000Bob<script>" }), 0);
assert.deepEqual([malicious.rendered.x, malicious.rendered.y], [0, 0]);
assert.equal(malicious.name, "Bob?script?");

const geared = createRemoteAvatarMotion(player({
  heldItem: "iron_pickaxe",
  armorHead: "iron_helmet",
  armorChest: "leather_chestplate",
  armorLegs: "iron_leggings",
  armorFeet: "leather_boots",
}), 0);
assert.deepEqual(
  [geared.heldItem, geared.armorHead, geared.armorChest, geared.armorLegs, geared.armorFeet],
  ["iron_pickaxe", "iron_helmet", "leather_chestplate", "iron_leggings", "leather_boots"],
);
applyRemoteAvatarSnapshot(geared, player({
  heldItem: "sand",
  armorHead: "leather_helmet",
  armorChest: "iron_chestplate",
  armorLegs: "leather_leggings",
  armorFeet: "iron_boots",
}), 100);
assert.deepEqual(
  [geared.heldItem, geared.armorHead, geared.armorChest, geared.armorLegs, geared.armorFeet],
  ["sand", "leather_helmet", "iron_chestplate", "leather_leggings", "iron_boots"],
  "gear changes apply atomically with the sparse pose snapshot",
);
applyRemoteAvatarSnapshot(geared, player({
  heldItem: "constructor",
  armorHead: "iron_chestplate",
  armorChest: "iron_helmet",
  armorLegs: "stone_sword",
  armorFeet: "missing_boots",
} as unknown as Partial<RemotePlayer>), 200);
assert.deepEqual(
  [geared.heldItem, geared.armorHead, geared.armorChest, geared.armorLegs, geared.armorFeet],
  [null, null, null, null, null],
  "malformed and cross-slot equipment is cleared instead of rendered",
);

const acting = createRemoteAvatarMotion(player({
  heldItem: "bow",
  visualActions: [{ sequence: 3, kind: "bow_draw" }, { sequence: 4, kind: "swing" }],
}), 1_000);
assert.equal(acting.bowDrawing, true);
advanceRemoteAvatarMotion(acting, 1_200, 0.016);
assert.ok(acting.armActionPhase > 0, "replayed remote actions drive a visible arm animation");
applyRemoteAvatarSnapshot(acting, player({
  heldItem: "bow",
  visualActions: [{ sequence: 4, kind: "swing" }, { sequence: 5, kind: "bow_release" }],
}), 1_250);
assert.equal(acting.bowDrawing, false);
assert.equal(acting.lastVisualActionSequence, 5, "replayed visual actions apply exactly once by sequence");
assert.doesNotThrow(() => applyRemoteAvatarSnapshot(acting, player({
  visualActions: [null, { sequence: 6, kind: "unknown" }, { sequence: 7, kind: "slot", value: 9 }] as never,
}), 1_300), "malformed community-server actions never reach avatar animation state");
assert.equal(acting.lastVisualActionSequence, 5);

const lookingUp = createRemoteAvatarMotion(player({ pitch: 0.4 }), 0);
assert.ok(Math.abs(resolveRemoteAvatarRigPose(lookingUp).headPitch + 0.4) < 1e-8,
  "positive engine pitch renders the remote head looking up, matching local F5 inversion");
assert.deepEqual(
  [playerRigCycleMilliseconds("walk"), playerRigCycleMilliseconds("sprint"), playerRigCycleMilliseconds("sneak")],
  [600, 420, 900],
  "local and remote rigs share reviewed walk, sprint, and crouch cadence");

console.log("lakecraft avatar tests: ok");
