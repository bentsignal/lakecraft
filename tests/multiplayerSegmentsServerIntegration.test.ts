import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canonicalMotionBatchPayload,
  decodeMotionBatch,
  motionBatchFingerprint,
  type MotionBatchV1,
} from "../shared/multiplayerSegments.ts";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

for (const required of [
  "motionAcceptance: table({",
  "motionSegments: table({",
  "motionSegmentReceipts: table({",
  "motionDailyBudgets: table({",
  'publishMotionSegments: mutation(async (ctx, requestJson: string)',
  'multiplayerComposite: query(async (ctx, requestJson: string)',
  "decodeMotionBatch(rawBatch)",
  "canonicalMotionBatchPayload(batch)",
  'presence.sessionId !== batch.sessionId',
  'reason: "no_peers"',
  "SEGMENT_MOTION_MUTATION_BUDGET",
  "MOTION_RECEIPT_LIMIT - 1",
  "MOTION_ROWS_PER_PLAYER - 1",
  "returnedBatchCount + batches.length >= MOTION_COMPOSITE_MAX_BATCHES",
  "returnedBatchChars + chars > MOTION_COMPOSITE_MAX_BATCH_CHARS",
  "mobIds: mobValidation.mobIds",
  "const mobWorld = await (async () =>",
  "x: peer.pose.x",
  "heartbeatAt: peer.heartbeatAt",
  'reason: "daily_budget_exhausted"',
]) assert.ok(server.includes(required), `missing motion server integration: ${required}`);

const publishHandler = server.slice(
  server.indexOf("publishMotionSegments: mutation"),
  server.indexOf("authorizeRespawn: mutation"),
);
assert.ok(
  publishHandler.indexOf("const existingReceipt = matchingReceipts[0]")
    < publishHandler.indexOf("const presenceRows = await newestByIndex(ctx.db.playerPresence"),
  "exact retry must resolve before liveness/quota gates",
);
assert.ok(
  server.includes('if (!ctx.auth.isAuthenticated || ctx.auth.isGuest)'),
  "both APIs must reject guests",
);
assert.ok(
  server.includes('Math.hypot(pose.x - callerPose.x, pose.y - callerPose.y, pose.z - callerPose.z) > request.radius'),
  "composite proximity must use the caller's persisted pose, not request coordinates",
);
assert.equal(
  /request\.(x|y|z|yaw|pitch)/.test(publishHandler),
  false,
  "motion mutation must not treat client visual poses as authoritative fields",
);

const batch: MotionBatchV1 = {
  version: 1,
  sessionId: "session_server_01",
  batchId: "batch_server_0001",
  firstSequence: 0,
  lastSequence: 1,
  durationTicks: 2,
  keyframes: [
    [0, 0, 0, 320, 0, 0, 0],
    [1, 2, 32, 320, 0, 8, 0],
  ],
  actions: [[1, 2, "swing"]],
};
const reordered = {
  actions: batch.actions,
  keyframes: batch.keyframes,
  durationTicks: batch.durationTicks,
  lastSequence: batch.lastSequence,
  firstSequence: batch.firstSequence,
  batchId: batch.batchId,
  sessionId: batch.sessionId,
  version: batch.version,
};
const decoded = decodeMotionBatch(reordered);
assert.equal(decoded.ok, true);
if (!decoded.ok) throw new Error("valid reordered fixture rejected");
assert.equal(canonicalMotionBatchPayload(decoded.batch), canonicalMotionBatchPayload(batch));
assert.equal(motionBatchFingerprint(decoded.batch), motionBatchFingerprint(batch));

console.log("Lakebed batched multiplayer server integration tests passed");
