import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_WORLD_CHUNK_SNAPSHOT_BYTES,
  WORLD_CHUNK_CODEC_VERSION,
  WORLD_CHUNK_SECTION_HEIGHT,
  WORLD_EDIT_MAX_XZ,
  WORLD_EDIT_MAX_Y,
  WORLD_EDIT_MIN_XZ,
  WORLD_EDIT_MIN_Y,
  applyWorldChunkEdit,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
  validateVisibleWorldChunkKeys,
  validateWorldChunkKey,
  worldEditChunkKey,
  type WorldChunkEditInput,
} from "../shared/worldChunks.ts";

assert.equal(WORLD_EDIT_MIN_XZ, -1_000_000);
assert.equal(WORLD_EDIT_MAX_XZ, 1_000_000);
assert.equal(WORLD_EDIT_MIN_Y, -24);
assert.equal(WORLD_EDIT_MAX_Y, 128);
assert.equal(WORLD_CHUNK_SECTION_HEIGHT, 8);
assert.equal(WORLD_CHUNK_CODEC_VERSION, 3);

assert.deepEqual(validateWorldChunkKey("-125000:125000"), {
  ok: true,
  chunkKey: "-125000:125000",
  chunkX: -125_000,
  chunkZ: 125_000,
});
assert.equal(validateWorldChunkKey("-125001:0").ok, false);
assert.equal(validateWorldChunkKey("0:125001").ok, false);
assert.deepEqual(validateVisibleWorldChunkKeys(["125000:-125000"]), {
  ok: true,
  chunkKeys: ["125000:-125000"],
});

const farChunkKey = worldEditChunkKey(WORLD_EDIT_MAX_XZ, WORLD_EDIT_MIN_XZ);
const sparseFar = createWorldChunkSnapshot(farChunkKey, [
  { x: WORLD_EDIT_MAX_XZ, y: WORLD_EDIT_MIN_Y, z: WORLD_EDIT_MIN_XZ, blockType: "diamond_ore" },
  { x: WORLD_EDIT_MAX_XZ, y: WORLD_EDIT_MIN_Y, z: WORLD_EDIT_MIN_XZ + 1, blockType: "gold_ore" },
  { x: WORLD_EDIT_MAX_XZ, y: WORLD_EDIT_MAX_Y, z: WORLD_EDIT_MIN_XZ, blockType: "glass" },
]);
assert.equal(sparseFar.ok, true);
if (!sparseFar.ok) throw new Error(sparseFar.reason);
const sparseJson = JSON.parse(sparseFar.snapshotJson) as { v: number; sections: Array<{ y: number; cells: string }> };
assert.equal(sparseJson.v, 3);
assert.deepEqual(sparseJson.sections.map((section) => section.y), [-3, 16]);
assert.ok(sparseFar.snapshotJson.length < 1_000, `two sparse sections were ${sparseFar.snapshotJson.length} bytes`);
const sparseDecoded = decodeWorldChunkSnapshot(farChunkKey, sparseFar.snapshotJson);
assert.equal(sparseDecoded.ok, true);
if (sparseDecoded.ok) {
  assert.deepEqual(
    sparseDecoded.edits.map(({ coordKey, blockType }) => [coordKey, blockType]),
    [
      [`${WORLD_EDIT_MAX_XZ}:${WORLD_EDIT_MIN_Y}:${WORLD_EDIT_MIN_XZ}`, "diamond_ore"],
      [`${WORLD_EDIT_MAX_XZ}:${WORLD_EDIT_MIN_Y}:${WORLD_EDIT_MIN_XZ + 1}`, "gold_ore"],
      [`${WORLD_EDIT_MAX_XZ}:${WORLD_EDIT_MAX_Y}:${WORLD_EDIT_MIN_XZ}`, "glass"],
    ],
  );
}

const appended = applyWorldChunkEdit(farChunkKey, sparseFar.snapshotJson, {
  x: WORLD_EDIT_MAX_XZ,
  y: 0,
  z: WORLD_EDIT_MIN_XZ,
  blockType: "coal_ore",
});
assert.equal(appended.ok, true);
if (appended.ok) {
  assert.equal(JSON.parse(appended.snapshotJson).v, 3);
  assert.equal(decodeWorldChunkSnapshot(farChunkKey, appended.snapshotJson).ok, true);
}
assert.equal(applyWorldChunkEdit(farChunkKey, sparseFar.snapshotJson, {
  x: WORLD_EDIT_MAX_XZ + 1,
  y: 0,
  z: WORLD_EDIT_MIN_XZ,
  blockType: "stone",
}).ok, false, "the partially in-range edge chunk cannot persist x beyond the world envelope");
assert.equal(applyWorldChunkEdit(farChunkKey, sparseFar.snapshotJson, {
  x: WORLD_EDIT_MAX_XZ,
  y: WORLD_EDIT_MIN_Y - 1,
  z: WORLD_EDIT_MIN_XZ,
  blockType: "stone",
}).ok, false);

const dense: WorldChunkEditInput[] = [];
for (let y = WORLD_EDIT_MIN_Y; y <= WORLD_EDIT_MAX_Y; y += 1) {
  for (let z = 0; z < 8; z += 1) {
    for (let x = 0; x < 8; x += 1) dense.push({ x, y, z, blockType: "stone" });
  }
}
const denseStartedAt = performance.now();
const denseSnapshot = createWorldChunkSnapshot("0:0", dense);
const denseEncodeMs = performance.now() - denseStartedAt;
assert.equal(denseSnapshot.ok, true);
if (!denseSnapshot.ok) throw new Error(denseSnapshot.reason);
const denseParsed = JSON.parse(denseSnapshot.snapshotJson) as { v: number; sections: Array<{ y: number }> };
assert.equal(denseParsed.sections.length, 20, "the -24..128 envelope occupies twenty bounded vertical sections");
assert.ok(denseSnapshot.snapshotJson.length < MAX_WORLD_CHUNK_SNAPSHOT_BYTES);
const denseDecodeStartedAt = performance.now();
const denseDecoded = decodeWorldChunkSnapshot("0:0", denseSnapshot.snapshotJson);
const denseDecodeMs = performance.now() - denseDecodeStartedAt;
assert.equal(denseDecoded.ok && denseDecoded.edits.length, dense.length);
assert.ok(denseEncodeMs < 100, `dense v3 encode took ${denseEncodeMs.toFixed(2)}ms`);
assert.ok(denseDecodeMs < 100, `dense v3 decode took ${denseDecodeMs.toFixed(2)}ms`);

// v1 used four-bit nibbles across the fixed production range y=-4..64.
const legacyCellCount = 69 * 8 * 8;
const legacyV1 = new Uint8Array(Math.ceil(legacyCellCount / 2));
const legacyYZeroIndex = 4 * 64;
legacyV1[legacyYZeroIndex >> 1] = 4; // code 4 = stone
const legacyV1Json = JSON.stringify({ v: 1, cells: Buffer.from(legacyV1).toString("base64") });
assert.equal(decodeWorldChunkSnapshot("0:0", legacyV1Json).ok, true);
const migratedV1 = applyWorldChunkEdit("0:0", legacyV1Json, { x: 1, y: -24, z: 0, blockType: "coal_ore" });
assert.equal(migratedV1.ok, true);
if (migratedV1.ok) {
  assert.equal(JSON.parse(migratedV1.snapshotJson).v, 3);
  const decoded = decodeWorldChunkSnapshot("0:0", migratedV1.snapshotJson);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.edits.map(({ coordKey }) => coordKey), ["1:-24:0", "0:0:0"]);
}

// v2 used the same fixed y range with five-bit palette codes.
const legacyV2 = new Uint8Array(Math.ceil(legacyCellCount * 5 / 8));
function setFiveBit(bytes: Uint8Array, index: number, code: number): void {
  const bitIndex = index * 5;
  const byteIndex = bitIndex >> 3;
  const shift = bitIndex & 7;
  bytes[byteIndex] |= (code << shift) & 0xff;
  if (shift > 3) bytes[byteIndex + 1] |= code >> (8 - shift);
}
setFiveBit(legacyV2, legacyYZeroIndex + 1, 20); // code 20 = glass
const legacyV2Json = JSON.stringify({ v: 2, cells: Buffer.from(legacyV2).toString("base64") });
const legacyV2Decoded = decodeWorldChunkSnapshot("0:0", legacyV2Json);
assert.equal(legacyV2Decoded.ok, true);
if (legacyV2Decoded.ok) assert.equal(legacyV2Decoded.edits[0]?.blockType, "glass");
const migratedV2 = applyWorldChunkEdit("0:0", legacyV2Json, { x: 2, y: 128, z: 0, blockType: "torch" });
assert.equal(migratedV2.ok, true);
if (migratedV2.ok) assert.equal(JSON.parse(migratedV2.snapshotJson).v, 3);

assert.equal(decodeWorldChunkSnapshot("0:0", JSON.stringify({
  v: 3,
  sections: [{ y: 17, cells: "" }],
})).ok, false, "out-of-envelope vertical sections are rejected");

const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.equal(serverSource.includes("setBlock: mutation"), false, "legacy placement bypass is removed");
assert.equal(serverSource.includes("removeBlock: mutation"), false, "legacy mining bypass is removed");
assert.ok(serverSource.includes("editWorldBlock: mutation"), "atomic authoritative world edit mutation exists");

console.log(JSON.stringify({
  benchmark: "v3 vertical-section world persistence",
  denseEdits: dense.length,
  denseSections: denseParsed.sections.length,
  denseSnapshotBytes: denseSnapshot.snapshotJson.length,
  sparseSnapshotBytes: sparseFar.snapshotJson.length,
  denseEncodeMs: Number(denseEncodeMs.toFixed(2)),
  denseDecodeMs: Number(denseDecodeMs.toFixed(2)),
}));
console.log("lakecraft world chunk v3 tests: ok");
