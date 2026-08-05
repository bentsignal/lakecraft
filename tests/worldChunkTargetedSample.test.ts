import assert from "node:assert/strict";
import {
  applyWorldChunkEdit,
  createWorldChunkSnapshot,
  sampleWorldChunkSnapshot,
} from "../shared/worldChunks.ts";

const chunkKey = "-1:0";
const created = createWorldChunkSnapshot(chunkKey, [
  { x: -1, y: 8, z: 0, blockType: "cobblestone" },
  { x: -2, y: 8, z: 0, blockType: "air" },
]);
assert.equal(created.ok, true);
if (!created.ok) throw new Error(created.reason);
const sampled = sampleWorldChunkSnapshot(chunkKey, created.snapshotJson, [
  { x: -1, y: 8, z: 0 },
  { x: -2, y: 8, z: 0 },
  { x: -3, y: 8, z: 0 },
]);
assert.deepEqual(sampled, { ok: true, blocks: ["cobblestone", "air", null] });

const ladder = applyWorldChunkEdit(chunkKey, created.snapshotJson, {
  x: -1,
  y: 9,
  z: 0,
  blockType: "ladder",
});
assert.equal(ladder.ok, true);
if (!ladder.ok) throw new Error(ladder.reason);
assert.deepEqual(
  sampleWorldChunkSnapshot(chunkKey, ladder.snapshotJson, [{ x: -1, y: 9, z: 0 }]),
  { ok: true, blocks: ["ladder"] },
);
assert.equal(sampleWorldChunkSnapshot(chunkKey, ladder.snapshotJson, [{ x: 0, y: 9, z: 0 }]).ok, false);
assert.equal(sampleWorldChunkSnapshot(chunkKey, "{}", [{ x: -1, y: 9, z: 0 }]).ok, false);

console.log("targeted authoritative world chunk sampling tests passed");
