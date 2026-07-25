import assert from "node:assert/strict";
import {
  PRESENCE_RELOCATION_MAX_LIFETIME_MS,
  PRESENCE_TRAJECTORY_HORIZONTAL_SLACK,
  PRESENCE_TRAJECTORY_MAX_ELAPSED_MS,
  PRESENCE_TRAJECTORY_VERTICAL_SLACK,
  buildPresenceRelocationGrant,
  decidePresenceTrajectory,
  type PresenceTrajectoryRecord,
  type ValidatedPresencePose,
} from "../server/playerPresence.ts";
import {
  PRESENCE_MAX_HORIZONTAL_SPEED,
  PRESENCE_MAX_VERTICAL_SPEED,
} from "../shared/presenceMotion.ts";

const userId = "user-alex";
const origin: ValidatedPresencePose = { x: 10, y: 8, z: -4, yaw: 0.25, pitch: -0.1 };

function row(overrides: Partial<PresenceTrajectoryRecord> = {}): PresenceTrajectoryRecord {
  return {
    userId,
    x: String(origin.x),
    y: String(origin.y),
    z: String(origin.z),
    yaw: String(origin.yaw),
    pitch: String(origin.pitch),
    heartbeatAt: "10000",
    online: true,
    ...overrides,
  };
}

assert.deepEqual(
  decidePresenceTrajectory(userId, null, origin, 10_000, origin),
  { accept: true, reason: "initial_spawn", relocationGrantUpdate: null },
  "a new player may materialize only at the server-selected initial spawn",
);
assert.deepEqual(
  decidePresenceTrajectory(userId, null, { ...origin, x: 999 }, 10_000, origin),
  { accept: false, reason: "initial_spawn_required" },
  "a first heartbeat cannot spoof an arbitrary initial position",
);

const elapsedMs = 200;
const horizontalLimit = PRESENCE_TRAJECTORY_HORIZONTAL_SLACK
  + PRESENCE_MAX_HORIZONTAL_SPEED * elapsedMs / 1_000;
const verticalLimit = PRESENCE_TRAJECTORY_VERTICAL_SLACK
  + PRESENCE_MAX_VERTICAL_SPEED * elapsedMs / 1_000;
assert.equal(
  decidePresenceTrajectory(
    userId,
    row(),
    { ...origin, x: origin.x + horizontalLimit, y: origin.y + verticalLimit },
    10_000 + elapsedMs,
  ).accept,
  true,
  "the exact elapsed-time displacement envelope is accepted",
);
assert.deepEqual(
  decidePresenceTrajectory(
    userId,
    row(),
    { ...origin, x: origin.x + horizontalLimit + 0.001 },
    10_000 + elapsedMs,
  ),
  { accept: false, reason: "displacement_exceeded" },
  "horizontal teleport spoofing is rejected",
);
assert.deepEqual(
  decidePresenceTrajectory(
    userId,
    row(),
    { ...origin, y: origin.y + verticalLimit + 0.001 },
    10_000 + elapsedMs,
  ),
  { accept: false, reason: "displacement_exceeded" },
  "vertical teleport spoofing is rejected",
);

assert.deepEqual(
  decidePresenceTrajectory(userId, row({ online: false }), origin, 20_000),
  { accept: true, reason: "persisted_reconnect", relocationGrantUpdate: null },
  "offline reconnect resumes at the exact persisted pose",
);
assert.deepEqual(
  decidePresenceTrajectory(userId, row({ online: false }), { ...origin, yaw: 0.5 }, 20_000),
  { accept: false, reason: "persisted_pose_required" },
  "offline reconnect cannot even rewrite orientation before resuming",
);
assert.deepEqual(
  decidePresenceTrajectory(
    userId,
    row(),
    { ...origin, x: origin.x + 1 },
    10_000 + PRESENCE_TRAJECTORY_MAX_ELAPSED_MS + 1,
  ),
  { accept: false, reason: "persisted_pose_required" },
  "a stale online lease becomes an exact-pose reconnect rather than accruing teleport distance",
);
assert.equal(
  decidePresenceTrajectory(userId, row(), origin, 10_000 + PRESENCE_TRAJECTORY_MAX_ELAPSED_MS + 1).accept,
  true,
);

const respawn: ValidatedPresencePose = { x: -32, y: 11, z: 48, yaw: Math.PI, pitch: 0 };
const grant = buildPresenceRelocationGrant(userId, "7", respawn, 50_000, 5_000);
assert.ok(grant);
const approved = decidePresenceTrajectory(userId, row({ online: false }), respawn, 51_000, null, "7", grant);
assert.equal(approved.accept, true);
assert.equal(approved.reason, "approved_relocation");
assert.deepEqual(
  approved.accept && approved.relocationGrantUpdate,
  { ...grant, consumedAt: "51000" },
  "acceptance returns the grant update that must be committed with the pose",
);

assert.deepEqual(
  decidePresenceTrajectory(
    userId,
    row({ online: false }),
    respawn,
    51_001,
    null,
    "7",
    approved.accept ? approved.relocationGrantUpdate : null,
  ),
  { accept: false, reason: "relocation_replayed" },
  "the transactionally consumed grant cannot be replayed",
);
assert.deepEqual(
  decidePresenceTrajectory(userId, row(), respawn, 50_500, null, "8", grant),
  { accept: false, reason: "relocation_epoch_mismatch" },
  "a guessed epoch does not authorize relocation",
);
assert.deepEqual(
  decidePresenceTrajectory(userId, row(), { ...respawn, z: respawn.z + 1 }, 50_500, null, "7", grant),
  { accept: false, reason: "relocation_destination_mismatch" },
  "a valid epoch is bound to the exact server-approved destination",
);
assert.deepEqual(
  decidePresenceTrajectory("user-steve", row({ userId: "user-steve" }), respawn, 50_500, null, "7", grant),
  { accept: false, reason: "relocation_user_mismatch" },
  "another user cannot spend the grant",
);
assert.deepEqual(
  decidePresenceTrajectory(userId, row(), respawn, 55_000, null, "7", grant),
  { accept: false, reason: "relocation_expired" },
  "expiry is exclusive and evaluated from server time",
);
assert.deepEqual(
  decidePresenceTrajectory(userId, row(), respawn, 50_500, null, "7", null),
  { accept: false, reason: "relocation_missing" },
  "deleting the consumed grant row also makes replay fail closed",
);

assert.equal(
  buildPresenceRelocationGrant(userId, "9", respawn, 50_000, PRESENCE_RELOCATION_MAX_LIFETIME_MS + 1),
  null,
  "the primitive cannot mint an unbounded relocation lease",
);
assert.equal(buildPresenceRelocationGrant(userId, "client-picked-token", respawn, 50_000), null);
assert.deepEqual(
  decidePresenceTrajectory(
    userId,
    row(),
    respawn,
    50_500,
    null,
    "7",
    { ...grant, expiresAt: String(50_000 + PRESENCE_RELOCATION_MAX_LIFETIME_MS + 1) },
  ),
  { accept: false, reason: "relocation_invalid" },
  "forged overlong grant rows fail closed even if their epoch matches",
);

console.log("presence trajectory authority tests passed");
