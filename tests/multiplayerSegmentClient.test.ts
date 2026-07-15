import assert from "node:assert/strict";
import {
  MotionSegmentRecorder,
  SegmentReplayCollection,
  createCompositeRequest,
  decideAndReserveSegmentTraffic,
  segmentQuotaPlan,
  type MultiplayerCompositeResult,
} from "../client/multiplayerSegmentClient.ts";
import { buildMotionBatch, createSegmentBudgetState, decodeMotionBatch } from "../shared/multiplayerSegments.ts";

const pose = (x: number) => ({ x, y: 7, z: 2, yaw: x / 20, pitch: 0 });
const recorder = new MotionSegmentRecorder("session_client_001");
recorder.configurePublishInterval(10_000);
for (let at = 1_000; at <= 11_000; at += 50) recorder.sample(pose((at - 1_000) / 1_000), at);
assert.equal(recorder.action("jump", pose(10.1), 11_010), true);
assert.equal(recorder.action("slot", pose(10.2), 11_020, 4), true);
const first = recorder.prepare(11_100, pose(10.3));
assert.ok(first);
assert.equal(decodeMotionBatch(first).ok, true);
assert.deepEqual(first.actions.map((action) => action[2]), ["jump", "slot"]);
assert.equal(recorder.prepare(12_000, pose(99)), first, "transport retry must retain the exact batch object");
assert.equal(recorder.accept(first.lastSequence - 1), false);
assert.equal(recorder.accept(first.lastSequence), true);
const second = recorder.prepare(12_100, pose(11));
assert.ok(second);
assert.equal(second.firstSequence, first.lastSequence + 1);

const staleActionRecorder = new MotionSegmentRecorder("session_stale_actions");
assert.equal(staleActionRecorder.action("swing", pose(0), 1_000), true);
assert.equal(staleActionRecorder.sample(pose(31), 32_001, true), true);
const staleActionBatch = staleActionRecorder.prepare(32_002, pose(31.1));
assert.ok(staleActionBatch, "a retained action older than the legal history window cannot poison publishing");
assert.deepEqual(staleActionBatch.actions, []);

assert.deepEqual(JSON.parse(createCompositeRequest([
  { userId: "u1", sessionId: "s1", acceptedThrough: 12 },
], 123, ["zombie-mpl-1", "pig-mpl-0", "zombie-mpl-1"])), {
  radius: 96,
  known: [["u1", "s1", 12]],
  mobIds: ["pig-mpl-0", "zombie-mpl-1"],
  sample: "123",
});

const budget = createSegmentBudgetState(Date.UTC(2026, 6, 15));
const plan = segmentQuotaPlan(9);
const discoveryMutation = decideAndReserveSegmentTraffic({
  budget, kind: "mutation", now: Date.UTC(2026, 6, 15), multiplayer: true,
  authenticated: true, visible: true, focused: true, paused: false, nearbyPlayers: 0,
  grant: plan.mutationsPerPlayerPerSession,
});
assert.deepEqual(discoveryMutation, { allow: false, reason: "no_peers" });
assert.equal(budget.mutationAttempts, 0);
const backgroundRead = decideAndReserveSegmentTraffic({
  budget, kind: "request", now: Date.UTC(2026, 6, 15), multiplayer: true,
  authenticated: true, visible: false, focused: true, paused: false, nearbyPlayers: 2,
  grant: plan.requestsPerPlayerPerSession,
});
assert.deepEqual(backgroundRead, { allow: false, reason: "background" });
assert.equal(budget.requestAttempts, 0);
const activeRead = decideAndReserveSegmentTraffic({
  budget, kind: "request", now: Date.UTC(2026, 6, 15), multiplayer: true,
  authenticated: true, visible: true, focused: true, paused: false, nearbyPlayers: 2,
  grant: plan.requestsPerPlayerPerSession,
});
assert.deepEqual(activeRead, { allow: true, mode: "active" });
assert.equal(budget.requestAttempts, 1);

const replay = new SegmentReplayCollection();
const remoteBatch = buildMotionBatch({
  sessionId: "remote_session_1",
  batchId: "remote_batch_0001",
  firstSequence: 0,
  samples: [{ at: 19_000, pose: pose(0) }, { at: 20_000, pose: pose(10) }],
  actions: [{ at: 20_000, kind: "swing" }],
});
const result: MultiplayerCompositeResult = {
  ok: true,
  serverNow: 20_000,
  mobWorld: { ok: false, reason: "fixture", poses: [], states: [], damageClaims: [], serverNow: 20_000 },
  nearbyPlayers: [{
    userId: "remote", displayName: "Steve", color: "#44aa66", sessionId: "remote_session_1",
    x: 10, y: 7, z: 2, yaw: 0.5, pitch: 0, heartbeatAt: 20_000, online: true,
    heldItem: "stick", armorHead: "", armorChest: "", armorLegs: "", armorFeet: "",
    batches: [{ batch: remoteBatch, acceptedAt: 20_000 }],
  }],
};
replay.ingest(result, 20_050, "self");
assert.deepEqual(replay.known(), [{ userId: "remote", sessionId: "remote_session_1", acceptedThrough: remoteBatch.lastSequence }]);
let visuals = replay.step(20_500);
assert.equal(visuals.length, 1);
assert.equal(visuals[0].name, "Steve");
assert.equal(visuals[0].stale, false);
assert.deepEqual(visuals[0].actions.map((action) => action.kind), ["swing"], "replayed actions reach the avatar transport exactly once");
assert.deepEqual(replay.step(20_550)[0].actions, [], "a visual action is not emitted twice");

const reconnectBatch = buildMotionBatch({
  sessionId: "remote_session_2",
  batchId: "remote_batch_0002",
  firstSequence: 0,
  samples: [{ at: 21_000, pose: pose(50) }],
});
replay.ingest({
  ...result,
  serverNow: 21_000,
  nearbyPlayers: [{
    ...result.nearbyPlayers[0],
    sessionId: "remote_session_2",
    x: 50,
    batches: [{ batch: reconnectBatch, acceptedAt: 21_000 }],
  }],
}, 21_050, "self");
visuals = replay.step(21_100);
assert.ok(visuals[0].x > 49, `a new remote session must reset the old replay cursor (x=${visuals[0].x})`);
assert.deepEqual(replay.known(), [{ userId: "remote", sessionId: "remote_session_2", acceptedThrough: reconnectBatch.lastSequence }]);

console.log("multiplayer segment client: recorder/actions, exact retry, gates, cursors, and replay passed");
