import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_WORLD_BLOCK_OPERATION_RECEIPTS_PER_USER,
  decodeWorldBlockOperationReceipt,
  encodeWorldBlockOperationReceipt,
  selectWorldBlockOperationReceiptOverflow,
  validateWorldBlockActionPose,
  worldBlockOperationPoseFingerprint,
  type WorldBlockOperationReceiptResult,
} from "../server/worldBlockOperationReceipts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = fs.readFileSync(path.join(root, "server/index.ts"), "utf8");
const mutationStart = server.indexOf("editWorldBlock: mutation(async");
const mutationEnd = server.indexOf("authorizeRespawn: mutation(", mutationStart);
assert.ok(mutationStart >= 0 && mutationEnd > mutationStart, "authoritative mutation must be registered");
const editMutation = server.slice(mutationStart, mutationEnd);

assert.match(server, /worldChunks: table\(\{[\s\S]*?revision: string\(\)\.default\("0"\)/);
assert.match(server, /inventories: table\(\{[\s\S]*?revision: string\(\)\.default\("0"\)/);
assert.match(server, /worldBlockOperationReceipts: table\(\{[\s\S]*?\.index\("by_user_operation", \["userId", "operationId"\]\)[\s\S]*?\.index\("by_user_created", \["userId", "receiptCreatedAt"\]\)/);
assert.match(server, /revision: storedRevision\(row\.revision\) \?\? "0"/);
assert.match(server, /revision: "0", updatedAt: "0"/);

const receiptRead = editMutation.indexOf("ctx.db.worldBlockOperationReceipts");
for (const laterRead of ["ctx.db.profiles", "ctx.db.playerPresence", "ctx.db.inventories", "ctx.db.worldChunks", "ctx.db.worldEdits"]) {
  assert.ok(receiptRead >= 0 && receiptRead < editMutation.indexOf(laterRead), `receipt lookup must precede ${laterRead}`);
}
assert.ok(editMutation.indexOf("decodeWorldBlockOperationReceipt") < editMutation.indexOf("ctx.db.profiles"));
const replayBranch = editMutation.slice(
  editMutation.indexOf("if (existingReceipt)"),
  editMutation.indexOf("const serverNow = Date.now()"),
);
assert.doesNotMatch(replayBranch, /\.insert\(|\.update\(|\.delete\(/, "receipt replay performs zero writes");
assert.match(replayBranch, /replayInventories[\s\S]*?\.take\(2\)/);
assert.match(replayBranch, /replayChunks[\s\S]*?\.take\(2\)/);
assert.match(replayBranch, /inventory: replayInventories\[0\], currentChunkRevision/);
assert.match(editMutation, /worldBlockOperationPoseFingerprint\(validation\.fingerprint, pose\)/);
assert.match(editMutation, /validateWorldBlockActionPose\(/);
assert.match(editMutation, /naturalWorldBlockAt\(request\.x, request\.y, request\.z\)/);
assert.match(editMutation, /applyWorldChunkEdit\(chunkKey, chunkRow\.snapshotJson, worldEditValue\)/);
assert.match(editMutation, /createWorldChunkSnapshot\(chunkKey, \[worldEditValue\]\)/);
assert.doesNotMatch(editMutation, /maintainWorldChunkSnapshot/);
assert.doesNotMatch(editMutation, /worldEdits[\s\S]*?\.collect\(\)/);
assert.match(editMutation, /ctx\.db\.playerPresence\.update\(presence\.id, presenceValue\)/);
assert.match(editMutation, /effect\.inventoryChanged[\s\S]*?ctx\.db\.inventories\.update/);
assert.match(editMutation, /effect\.kind,[\s\S]*?effect\.nextBlock/);
assert.match(editMutation, /inventory: persistedInventory,[\s\S]*?currentChunkRevision: effect\.chunkRevision/);
assert.equal((editMutation.match(/\.take\(2\)/g) ?? []).length, 7,
  "receipt/replay inventory/replay chunk/current inventory/current chunk/current edit/current furnace all fail closed on duplicates");

// Every pre-migration inventory writer and the legacy chunk writer now advances
// a monotonic revision as well; authoritative writes use resolver revisions.
assert.equal((server.match(/revision: incrementStoredRevision\(/g) ?? []).length, 9,
  "legacy saves plus atomic block, drop, chest, furnace, mob-loot, PvP, and mob-damage writers advance inventory revisions");
assert.equal((editMutation.match(/revision: effect\.(?:chunk|inventory)Revision/g) ?? []).length, 2);

const storedPresence = {
  userId: "user-1",
  x: "10",
  y: "4",
  z: "10",
  heartbeatAt: "1000",
  online: true,
};
const actionPose = { x: 11, y: 4, z: 10, yaw: 0.25, pitch: -0.1 };
assert.deepEqual(validateWorldBlockActionPose(
  storedPresence,
  "user-1",
  actionPose,
  { x: 12, y: 5, z: 10 },
  1_100,
), { ok: true, elapsedMs: 100 });
assert.deepEqual(validateWorldBlockActionPose(
  storedPresence,
  "user-1",
  { ...actionPose, x: 20 },
  { x: 20, y: 4, z: 10 },
  1_100,
), { ok: false, reason: "implausible_pose" });
assert.deepEqual(validateWorldBlockActionPose(
  storedPresence,
  "user-1",
  actionPose,
  { x: 18, y: 4, z: 10 },
  1_100,
), { ok: false, reason: "out_of_reach" });
assert.deepEqual(validateWorldBlockActionPose(
  storedPresence,
  "user-1",
  actionPose,
  { x: 12, y: 5, z: 10 },
  100_000,
), { ok: false, reason: "active_presence_required" });
const crouchBoundaryPose = { x: 0.6, y: 0, z: 0.5, yaw: 0, pitch: 0 };
assert.deepEqual(validateWorldBlockActionPose(
  { userId: "user-1", x: "0.6", y: "0", z: "0.5", heartbeatAt: "1000", online: true },
  "user-1",
  crouchBoundaryPose,
  { x: 6, y: 0, z: 0 },
  1_000,
), { ok: true, elapsedMs: 0 }, "Lakebed accepts the crouched eye at the survival reach boundary");

const operationFingerprint = "[1,\"operation\"]";
const fingerprint = worldBlockOperationPoseFingerprint(operationFingerprint, actionPose);
assert.equal(fingerprint, worldBlockOperationPoseFingerprint(operationFingerprint, { ...actionPose }));
assert.notEqual(fingerprint, worldBlockOperationPoseFingerprint(operationFingerprint, { ...actionPose, x: 11.01 }));

const receiptResult: WorldBlockOperationReceiptResult = {
  ok: true,
  replayed: false,
  operationId: "mine_operation_0001",
  kind: "mine",
  x: 12,
  y: 5,
  z: 10,
  previousBlock: "stone",
  nextBlock: "air",
  inventoryRevision: "8",
  chunkKey: "1:1",
  chunkRevision: "3",
  inventoryChanged: true,
  drop: { itemId: "cobblestone", count: 1 },
  consumed: null,
  toolUse: { used: true, broke: false, itemId: "wooden_pickaxe", remainingDurability: 58 },
};
assert.deepEqual(decodeWorldBlockOperationReceipt(encodeWorldBlockOperationReceipt(receiptResult)), {
  ...receiptResult,
  replayed: true,
});
assert.equal(decodeWorldBlockOperationReceipt("not-json"), null);

const receiptRows = Array.from(
  { length: MAX_WORLD_BLOCK_OPERATION_RECEIPTS_PER_USER + 8 },
  (_, index) => ({ id: `receipt-${index}` }),
);
assert.deepEqual(selectWorldBlockOperationReceiptOverflow(receiptRows, "receipt-0"),
  receiptRows.slice(MAX_WORLD_BLOCK_OPERATION_RECEIPTS_PER_USER).map((row) => row.id));

console.log("world block operation server integration tests passed");
console.log(JSON.stringify({
  benchmark: "authoritative world operation Lakebed row envelope",
  typicalSuccessReads: 8,
  typicalSuccessWrites: 5,
  unchangedInventoryWrites: 4,
  exactReplayReads: 3,
  exactReplayWrites: 0,
  retainedReceiptsPerUser: MAX_WORLD_BLOCK_OPERATION_RECEIPTS_PER_USER,
}));
