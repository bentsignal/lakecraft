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

// Production v1/v2 rows used a fixed -4..64 vertical range. Legacy edits at
// y=0 are hidden so the canonical natural bedrock floor cannot be overwritten.
const legacyCellCount = 69 * 8 * 8;
const legacyYZeroIndex = 4 * 64;
const legacyV1 = new Uint8Array(Math.ceil(legacyCellCount / 2));
legacyV1[legacyYZeroIndex >> 1] = 4; // code 4 = stone at 0:0:0
const legacyV1Json = JSON.stringify({ v: 1, cells: Buffer.from(legacyV1).toString("base64") });
assert.deepEqual(sampleWorldChunkSnapshot("0:0", legacyV1Json, [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
]), { ok: true, blocks: [null, null] });

function setFiveBit(bytes: Uint8Array, index: number, code: number): void {
  const bitIndex = index * 5;
  const byteIndex = bitIndex >> 3;
  const shift = bitIndex & 7;
  bytes[byteIndex] |= (code << shift) & 0xff;
  if (shift > 3) bytes[byteIndex + 1] |= code >> (8 - shift);
}
const legacyV2 = new Uint8Array(Math.ceil(legacyCellCount * 5 / 8));
setFiveBit(legacyV2, legacyYZeroIndex + 1, 20); // code 20 = glass at 1:0:0
const legacyV2Json = JSON.stringify({ v: 2, cells: Buffer.from(legacyV2).toString("base64") });
assert.deepEqual(sampleWorldChunkSnapshot("0:0", legacyV2Json, [
  { x: 1, y: 0, z: 0 },
  { x: 1, y: 65, z: 0 },
]), { ok: true, blocks: [null, null] });

const legacyV3 = new Uint8Array(Math.ceil(8 * 8 * 8 * 5 / 8));
setFiveBit(legacyV3, 0, 4); // code 4 = stone at y=0
const legacyV3Json = JSON.stringify({
  v: 3,
  sections: [{ y: 0, cells: Buffer.from(legacyV3).toString("base64") }],
});
assert.deepEqual(sampleWorldChunkSnapshot("0:0", legacyV3Json, [{ x: 0, y: 0, z: 0 }]), {
  ok: true,
  blocks: [null],
}, "explicitly legacy v3 foundation edits are sanitized during targeted migration reads");

console.log("targeted authoritative world chunk sampling tests passed");
