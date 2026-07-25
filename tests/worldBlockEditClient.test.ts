import assert from "node:assert/strict";
import {
  buildWorldBlockOperationRequest,
  createWorldBlockOperationId,
  invokeWorldBlockEditWithOneRetry,
  isDecimalRevisionAtLeast,
  overlayPendingWorldBlockEdit,
  serializeWorldBlockEditPose,
} from "../client/worldBlockEditClient.ts";

const base = {
  operationId: "block_request_0001",
  x: -4,
  y: 7,
  z: 12,
  selectedHotbar: 2,
  expectedHeldItem: "wooden_pickaxe" as const,
  expectedInventoryRevision: "8",
  expectedChunkRevision: "3",
};

assert.deepEqual(buildWorldBlockOperationRequest({ ...base, previousBlock: "stone", nextBlock: "air" }), {
  operationId: "block_request_0001",
  kind: "mine",
  x: -4,
  y: 7,
  z: 12,
  expectedBlock: "stone",
  selectedHotbar: 2,
  expectedHeldItem: "wooden_pickaxe",
  expectedInventoryRevision: "8",
  expectedChunkRevision: "3",
});

assert.deepEqual(buildWorldBlockOperationRequest({
  ...base,
  previousBlock: "air",
  nextBlock: "wood",
  expectedHeldItem: "log",
}), {
  operationId: "block_request_0001",
  kind: "place",
  x: -4,
  y: 7,
  z: 12,
  expectedBlock: "air",
  placedBlock: "wood",
  selectedHotbar: 2,
  expectedHeldItem: "log",
  expectedInventoryRevision: "8",
  expectedChunkRevision: "3",
});

assert.deepEqual(buildWorldBlockOperationRequest({
  ...base,
  previousBlock: "door_closed",
  nextBlock: "door_open",
}), {
  operationId: "block_request_0001",
  kind: "toggle",
  x: -4,
  y: 7,
  z: 12,
  expectedBlock: "door_closed",
  expectedChunkRevision: "3",
});
assert.deepEqual(buildWorldBlockOperationRequest({
  ...base,
  previousBlock: "oak_fence_gate_closed",
  nextBlock: "oak_fence_gate_open",
}), {
  operationId: "block_request_0001",
  kind: "toggle",
  x: -4,
  y: 7,
  z: 12,
  expectedBlock: "oak_fence_gate_closed",
  expectedChunkRevision: "3",
});
assert.deepEqual(buildWorldBlockOperationRequest({
  ...base,
  previousBlock: "oak_fence_gate_open",
  nextBlock: "oak_fence_gate_closed",
})?.expectedBlock, "oak_fence_gate_open", "open gates close through the same bounded toggle request");
assert.equal(buildWorldBlockOperationRequest({
  ...base,
  previousBlock: "door_closed",
  nextBlock: "oak_fence_gate_open",
}), null, "cross-family toggle transitions are never serialized");
assert.equal(buildWorldBlockOperationRequest({
  ...base,
  previousBlock: "oak_fence_gate_closed",
  nextBlock: "door_open",
}), null, "a gate cannot be transformed into a door by a forged optimistic edit");
assert.equal(buildWorldBlockOperationRequest({ ...base, previousBlock: "stone", nextBlock: "dirt" }), null);

const operationId = createWorldBlockOperationId(7, 123_456, "stable-random-value");
assert.equal(operationId, createWorldBlockOperationId(7, 123_456, "stable-random-value"));
assert.match(operationId, /^[A-Za-z0-9_-]{16,64}$/);
assert.equal(createWorldBlockOperationId(1, 1, "!*"), "block_1_1_0000000000000000");

assert.deepEqual(serializeWorldBlockEditPose({ x: 1.5, y: 8, z: -2.25, yaw: 0.4, pitch: -0.2 }), [
  "1.5", "8", "-2.25", "0.4", "-0.2",
]);

const authoritative = [{ x: 1, y: 2, z: 3, block: 4 }];
const optimistic = { x: 1, y: 2, z: 3, block: 0 };
assert.deepEqual(overlayPendingWorldBlockEdit(authoritative, optimistic), [authoritative[0], optimistic]);
assert.deepEqual(overlayPendingWorldBlockEdit(authoritative, null), authoritative);
assert.notEqual(overlayPendingWorldBlockEdit(authoritative, null), authoritative);

assert.equal(isDecimalRevisionAtLeast("10", "9"), true);
assert.equal(isDecimalRevisionAtLeast("10", "10"), true);
assert.equal(isDecimalRevisionAtLeast("9", "10"), false);
assert.equal(isDecimalRevisionAtLeast("01", "1"), false);
assert.equal(isDecimalRevisionAtLeast("9007199254740992", "1"), false);

const calls: string[][] = [];
const args = ["request", "1", "2", "3", "4", "5"] as const;
const retried = await invokeWorldBlockEditWithOneRetry(async (...received) => {
  calls.push(received);
  if (calls.length === 1) throw new Error("transport");
  return "canonical";
}, args);
assert.deepEqual(retried, { result: "canonical", attempts: 2 });
assert.deepEqual(calls, [args, args], "the retry must preserve request and pose byte-for-byte");

let successCalls = 0;
const immediate = await invokeWorldBlockEditWithOneRetry(async () => {
  successCalls += 1;
  return 42;
}, args);
assert.deepEqual(immediate, { result: 42, attempts: 1 });
assert.equal(successCalls, 1);

let failureCalls = 0;
await assert.rejects(() => invokeWorldBlockEditWithOneRetry(async () => {
  failureCalls += 1;
  throw new Error("offline");
}, args), /offline/);
assert.equal(failureCalls, 2, "a second transport failure must escape without a third attempt");

console.log("world block edit client model tests passed");
