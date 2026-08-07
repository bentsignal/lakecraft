import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as BS from "../shared/bundleStrings.ts";
import {
  newestUserRows,
  type IndexedTable,
  type OrderedIndexQuery,
} from "../server/queryOrder.ts";
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
const existingReceiptAt = publishHandler.indexOf("const existingReceipt = matchingReceipts[0]");
const replayGateOffsets = [
  "const presenceRows = await newestUserRows(ctx.db.playerPresence, ctx.auth.userId)",
  "const activeRows = await newestByIndex(ctx.db.playerPresence",
  "const acceptanceRows = await newestUserRows(ctx.db.motionAcceptance, ctx.auth.userId)",
  'const budgetRows = await newestMatchingRows(ctx.db.motionDailyBudgets, "by_key", "budgetKey", "motion")',
].map((marker) => publishHandler.indexOf(marker));
assert.ok(
  existingReceiptAt >= 0 && replayGateOffsets.every((offset) => offset > existingReceiptAt),
  "exact retry must resolve before liveness/quota gates",
);

const helperCalls: unknown[][] = [];
const helperRows = [{ id: "newest" }, { id: "duplicate" }];
const helperQuery: OrderedIndexQuery<{ id: string }> = {
  order(direction) { helperCalls.push(["order", direction]); return this; },
  async collect() { return helperRows; },
  async first() { return helperRows[0]; },
  async take(count) { helperCalls.push(["take", count]); return helperRows.slice(0, count); },
};
const helperTable: IndexedTable<{ id: string }> = {
  withIndex(index, range) {
    helperCalls.push(["withIndex", index]);
    range?.({
      eq(field, value) { helperCalls.push(["eq", field, value]); return this; },
      gt() { return this; },
      gte() { return this; },
      lt() { return this; },
      lte() { return this; },
    });
    return helperQuery;
  },
};
assert.deepEqual(await newestUserRows(helperTable, "user_server_01"), helperRows);
assert.deepEqual(helperCalls, [
  ["withIndex", BS.byUser],
  ["eq", BS.userId, "user_server_01"],
  ["order", "desc"],
  ["take", 2],
], "newestUserRows preserves the reviewed newest-by-user duplicate-detection semantics");
const compositeHandler = server.slice(
  server.indexOf("multiplayerComposite: query"),
  server.indexOf("myPresence: query"),
);
assert.ok(
  publishHandler.includes("if (!hasAuthenticatedUser(ctx))")
  && compositeHandler.includes("if (!hasAuthenticatedUser(ctx))"),
  "both multiplayer APIs retain the shared signed-in-only guard at their operation sites",
);
assert.match(
  server,
  /function hasAuthenticatedUser\(ctx:[^)]*\): boolean \{[\s\S]{0,120}return ctx\.auth\.isAuthenticated && !ctx\.auth\.isGuest;[\s\S]{0,20}\}/,
  "the shared guard means exactly authenticated and non-guest",
);
const authenticatedUserDecision = (isAuthenticated: boolean, isGuest: boolean): boolean => (
  isAuthenticated && !isGuest
);
assert.deepEqual(
  [
    authenticatedUserDecision(false, false),
    authenticatedUserDecision(false, true),
    authenticatedUserDecision(true, true),
    authenticatedUserDecision(true, false),
  ],
  [false, false, false, true],
  "only a signed-in non-guest identity passes the multiplayer auth guard",
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
