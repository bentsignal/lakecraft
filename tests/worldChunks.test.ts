import assert from "node:assert/strict";
import {
  MAX_VISIBLE_WORLD_CHUNKS,
  MAX_WORLD_CHUNK_SNAPSHOT_BYTES,
  WORLD_CHUNK_BLOCK_TYPES,
  WORLD_EDIT_MAX_Y,
  WORLD_EDIT_MIN_Y,
  applyWorldChunkEdit,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
  validateVisibleWorldChunkKeys,
  worldEditChunkCoordinate,
  worldEditChunkKey,
  type WorldChunkEditInput,
} from "../shared/worldChunks.ts";

assert.equal(worldEditChunkCoordinate(0), 0);
assert.equal(worldEditChunkCoordinate(7), 0);
assert.equal(worldEditChunkCoordinate(8), 1);
assert.equal(worldEditChunkCoordinate(-1), -1);
assert.equal(worldEditChunkCoordinate(-8), -1);
assert.equal(worldEditChunkCoordinate(-9), -2);
assert.equal(worldEditChunkKey(-9, 8), "-2:1");

assert.deepEqual(validateVisibleWorldChunkKeys(["0:0", "-1:2", "0:0"]), {
  ok: true,
  chunkKeys: ["-1:2", "0:0"],
});
assert.equal(validateVisibleWorldChunkKeys(["9:0"]).ok, false);
assert.equal(validateVisibleWorldChunkKeys("0:0").ok, false);
assert.deepEqual(
  validateVisibleWorldChunkKeys(Array.from({ length: MAX_VISIBLE_WORLD_CHUNKS + 1 }, (_, index) => `${index % 3}:0`)),
  { ok: false, reason: "too_many_chunks" },
);

const blockTypes = WORLD_CHUNK_BLOCK_TYPES.filter((block) => block !== "air");
const edits: WorldChunkEditInput[] = [];
for (let y = WORLD_EDIT_MIN_Y; y <= WORLD_EDIT_MAX_Y && edits.length < 1_500; y += 1) {
  for (let z = -20; z <= 20 && edits.length < 1_500; z += 1) {
    for (let x = -20; x <= 20 && edits.length < 1_500; x += 1) {
      edits.push({
        id: `e${String(edits.length).padStart(4, "0")}`,
        x,
        y,
        z,
        blockType: blockTypes[edits.length % blockTypes.length],
        editedAt: String(1_000 + edits.length),
      });
    }
  }
}
assert.equal(edits.length, 1_500);

const byChunk = new Map<string, WorldChunkEditInput[]>();
for (const edit of edits) {
  const key = worldEditChunkKey(Number(edit.x), Number(edit.z));
  const chunk = byChunk.get(key) ?? [];
  chunk.push(edit);
  byChunk.set(key, chunk);
}

const reconstructed = new Map<string, string>();
for (const [chunkKey, chunkEdits] of byChunk) {
  const snapshot = createWorldChunkSnapshot(chunkKey, chunkEdits);
  assert.equal(snapshot.ok, true);
  if (!snapshot.ok) continue;
  assert.ok(snapshot.snapshotJson.length < MAX_WORLD_CHUNK_SNAPSHOT_BYTES);
  const decoded = decodeWorldChunkSnapshot(chunkKey, snapshot.snapshotJson);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) continue;
  for (const edit of decoded.edits) reconstructed.set(edit.coordKey, edit.blockType);
}
assert.equal(reconstructed.size, 1_500, "chunk rows must reconstruct more than the legacy 1,000-edit cap");
for (const edit of edits) {
  assert.equal(reconstructed.get(`${edit.x}:${edit.y}:${edit.z}`), edit.blockType);
}

const ordering = createWorldChunkSnapshot("0:0", [
  { id: "z", x: 1, y: 2, z: 3, blockType: "air", editedAt: "20" },
  { id: "a", x: 1, y: 2, z: 3, blockType: "stone", editedAt: "10" },
  { id: "a", x: 2, y: 2, z: 3, blockType: "dirt", editedAt: "20" },
  { id: "b", x: 2, y: 2, z: 3, blockType: "wood", editedAt: "20" },
]);
assert.equal(ordering.ok, true);
if (ordering.ok) {
  const decoded = decodeWorldChunkSnapshot("0:0", ordering.snapshotJson);
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.edits.find((edit) => edit.coordKey === "1:2:3")?.blockType, "air");
    assert.equal(decoded.edits.find((edit) => edit.coordKey === "2:2:3")?.blockType, "wood");
  }

  const overwritten = applyWorldChunkEdit("0:0", ordering.snapshotJson, {
    x: 1,
    y: 2,
    z: 3,
    blockType: "planks",
  });
  assert.equal(overwritten.ok, true);
  if (overwritten.ok) {
    const decoded = decodeWorldChunkSnapshot("0:0", overwritten.snapshotJson);
    assert.equal(decoded.ok, true);
    if (decoded.ok) assert.equal(decoded.edits.find((edit) => edit.coordKey === "1:2:3")?.blockType, "planks");
  }
}

const fullChunk: WorldChunkEditInput[] = [];
for (let y = WORLD_EDIT_MIN_Y; y <= WORLD_EDIT_MAX_Y; y += 1) {
  for (let z = 0; z < 8; z += 1) {
    for (let x = 0; x < 8; x += 1) fullChunk.push({ x, y, z, blockType: "stone" });
  }
}
const fullSnapshot = createWorldChunkSnapshot("0:0", fullChunk);
assert.equal(fullSnapshot.ok, true);
if (fullSnapshot.ok) {
  assert.ok(fullSnapshot.snapshotJson.length < 4_000, `dense snapshot was ${fullSnapshot.snapshotJson.length} bytes`);
  const decoded = decodeWorldChunkSnapshot("0:0", fullSnapshot.snapshotJson);
  assert.equal(decoded.ok && decoded.edits.length, fullChunk.length);
}

const empty = createWorldChunkSnapshot("0:0", []);
assert.equal(empty.ok, true);
if (empty.ok) {
  assert.equal(applyWorldChunkEdit("0:0", empty.snapshotJson, { x: -1, y: 0, z: 0, blockType: "stone" }).ok, false);
  assert.equal(applyWorldChunkEdit("0:0", empty.snapshotJson, { x: 0, y: 0, z: 0, blockType: "lava" }).ok, false);
}
assert.equal(decodeWorldChunkSnapshot("0:0", "not json").ok, false);
assert.deepEqual(
  decodeWorldChunkSnapshot("0:0", "x".repeat(MAX_WORLD_CHUNK_SNAPSHOT_BYTES + 1)),
  { ok: false, reason: "snapshot_too_large" },
);
assert.equal(createWorldChunkSnapshot("broken", edits).ok, false);

console.log(JSON.stringify({
  benchmark: "compact authoritative world chunks",
  distinctEdits: edits.length,
  chunkRows: byChunk.size,
  denseChunkEdits: fullChunk.length,
  denseSnapshotBytes: fullSnapshot.ok ? fullSnapshot.snapshotJson.length : null,
}));
console.log("lakecraft world chunk snapshot tests: ok");
