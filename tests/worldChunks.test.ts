import assert from "node:assert/strict";
import {
  MAX_VISIBLE_WORLD_CHUNKS,
  MAX_WORLD_CHUNK_SNAPSHOT_BYTES,
  WORLD_CHUNK_CODEC_BITS_PER_CELL,
  WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES,
  WORLD_CHUNK_CODEC_VERSION,
  WORLD_CHUNK_BLOCK_TYPES,
  WORLD_EDIT_MAX_Y,
  WORLD_EDIT_MIN_Y,
  applyWorldChunkEdit,
  applyWorldChunkEdits,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
  validateVisibleWorldChunkKeys,
  worldEditChunkCoordinate,
  worldEditChunkKey,
  type WorldChunkEditInput,
} from "../shared/worldChunks.ts";

function setPackedCode(packed: Uint8Array, index: number, code: number, bitsPerCell: number): void {
  const bitIndex = index * bitsPerCell;
  for (let bit = 0; bit < bitsPerCell; bit += 1) {
    if ((code & (1 << bit)) !== 0) packed[(bitIndex + bit) >> 3] |= 1 << ((bitIndex + bit) & 7);
  }
}

assert.equal(WORLD_CHUNK_CODEC_VERSION, 7);
assert.equal(WORLD_CHUNK_CODEC_BITS_PER_CELL, 10);
assert.equal(WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES, 1023, "ten-bit snapshots reserve zero and expose 1,023 block codes");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.length, 377, "the append-only catalog includes both expanded decorative passes");
assert.ok(WORLD_CHUNK_BLOCK_TYPES.length <= WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES);
assert.deepEqual(
  WORLD_CHUNK_BLOCK_TYPES.slice(247, 253),
  ["oak_door_closed_east", "oak_door_closed_south", "oak_door_closed_west", "oak_door_open_east", "oak_door_open_south", "oak_door_open_west"],
  "new persisted block codes append without renumbering deployed materials",
);

const legacyCells = new Uint8Array(512);
setPackedCode(legacyCells, 2 * 64 + 1 + 2 * 8, 253, 8);
const legacySnapshot = JSON.stringify({ v: 6, sections: [{ y: 0, cells: Buffer.from(legacyCells).toString("base64") }] });
assert.deepEqual(decodeWorldChunkSnapshot("0:0", legacySnapshot), { ok: true, edits: [{
  coordKey: "1:2:2", x: "1", y: "2", z: "2", blockType: "oak_door_open_west",
}] }, "deployed byte snapshots decode without renumbering");
const migratedLegacy = applyWorldChunkEdit("0:0", legacySnapshot, { x: 2, y: 2, z: 2, blockType: "glowstone" });
assert.equal(migratedLegacy.ok, true);
if (migratedLegacy.ok) assert.equal(JSON.parse(migratedLegacy.snapshotJson).v, 7, "a touched legacy chunk rewrites once into v7");

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
assert.equal(validateVisibleWorldChunkKeys(["125001:0"]).ok, false);
assert.equal(validateVisibleWorldChunkKeys("0:0").ok, false);
assert.deepEqual(
  validateVisibleWorldChunkKeys(Array.from({ length: MAX_VISIBLE_WORLD_CHUNKS + 1 }, (_, index) => `${index % 3}:0`)),
  { ok: false, reason: "too_many_chunks" },
);

const blockTypes = WORLD_CHUNK_BLOCK_TYPES.filter((block) => block !== "air");
const edits: WorldChunkEditInput[] = [];
for (let y = WORLD_EDIT_MIN_Y + 1; y <= WORLD_EDIT_MAX_Y && edits.length < 1_500; y += 1) {
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
assert.deepEqual(
  [...new Set(reconstructed.values())].sort(),
  [...blockTypes].sort(),
  "the current codec round trips every supported non-air block type",
);

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

  const blastEdits: WorldChunkEditInput[] = [
    { x: 1, y: 2, z: 3, blockType: "air" },
    { x: 2, y: 2, z: 3, blockType: "air" },
    { x: 3, y: 2, z: 3, blockType: "cobblestone" },
  ];
  const batched = applyWorldChunkEdits("0:0", ordering.snapshotJson, blastEdits);
  let sequential = ordering;
  for (const edit of blastEdits) {
    if (!sequential.ok) break;
    sequential = applyWorldChunkEdit("0:0", sequential.snapshotJson, edit);
  }
  assert.deepEqual(batched, sequential, "one-pass explosion edits must match serial chunk semantics byte-for-byte");
}

const fullChunk: WorldChunkEditInput[] = [];
for (let y = WORLD_EDIT_MIN_Y + 1; y <= WORLD_EDIT_MAX_Y; y += 1) {
  for (let z = 0; z < 8; z += 1) {
    for (let x = 0; x < 8; x += 1) fullChunk.push({ x, y, z, blockType: "stone" });
  }
}
const fullSnapshot = createWorldChunkSnapshot("0:0", fullChunk);
assert.equal(fullSnapshot.ok, true);
if (fullSnapshot.ok) {
  assert.ok(fullSnapshot.snapshotJson.length < MAX_WORLD_CHUNK_SNAPSHOT_BYTES, `dense snapshot was ${fullSnapshot.snapshotJson.length} bytes`);
  assert.equal(JSON.parse(fullSnapshot.snapshotJson).v, 7, "new snapshots use ten-bit sparse vertical sections");
  const decoded = decodeWorldChunkSnapshot("0:0", fullSnapshot.snapshotJson);
  assert.equal(decoded.ok && decoded.edits.length, fullChunk.length);
}

const highestCode = createWorldChunkSnapshot("0:0", [
  { x: 0, y: 2, z: 0, blockType: "cobblestone" },
  { x: 1, y: 2, z: 0, blockType: "sand" },
  { x: 2, y: 2, z: 0, blockType: "glass" },
  { x: 3, y: 2, z: 0, blockType: "gold_ore" },
  { x: 4, y: 2, z: 0, blockType: "diamond_ore" },
  { x: 5, y: 2, z: 0, blockType: "tnt" },
  { x: 6, y: 2, z: 0, blockType: "gravel" },
]);
assert.equal(highestCode.ok, true);
if (highestCode.ok) {
  const decoded = decodeWorldChunkSnapshot("0:0", highestCode.snapshotJson);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(
    decoded.edits.map(({ blockType }) => blockType),
    ["cobblestone", "sand", "glass", "gold_ore", "diamond_ore", "tnt", "gravel"],
  );
}

const currentSectionProbe = createWorldChunkSnapshot("0:0", [
  { x: 0, y: 2, z: 0, blockType: "bricks" },
]);
assert.equal(currentSectionProbe.ok, true);
if (currentSectionProbe.ok) {
  const parsed = JSON.parse(currentSectionProbe.snapshotJson) as {
    v: number;
    sections: Array<{ y: number; cells: string }>;
  };
  assert.equal(parsed.v, 7);
  assert.equal(parsed.sections.length, 1);
  assert.equal(Buffer.from(parsed.sections[0].cells, "base64").length, 640, "v7 sections allocate ten bits for each of 512 cells");
}

const unregisteredCapacityCode = new Uint8Array((8 * 8 * 8 * WORLD_CHUNK_CODEC_BITS_PER_CELL) / 8);
setPackedCode(unregisteredCapacityCode, 0, WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES, WORLD_CHUNK_CODEC_BITS_PER_CELL);
const unregisteredCapacitySnapshot = JSON.stringify({
  v: WORLD_CHUNK_CODEC_VERSION,
  sections: [{ y: 0, cells: Buffer.from(unregisteredCapacityCode).toString("base64") }],
});
assert.deepEqual(
  decodeWorldChunkSnapshot("0:0", unregisteredCapacitySnapshot),
  { ok: false, reason: "invalid_snapshot" },
  "the byte format rejects codes until their append-only palette entry exists",
);
assert.deepEqual(
  decodeWorldChunkSnapshot("0:0", JSON.stringify({
    v: 8,
    sections: [{ y: 0, cells: Buffer.from(new Uint8Array(640)).toString("base64") }],
  })),
  { ok: false, reason: "invalid_snapshot" },
  "future version numbers stay behind an explicit compatibility fence",
);

const deterministicEdits: WorldChunkEditInput[] = [
  { x: 7, y: 192, z: 7, blockType: "bricks" },
  { x: 0, y: 2, z: 0, blockType: "air" },
  { x: 4, y: 17, z: 2, blockType: "diamond_ore" },
  { x: 3, y: 3, z: 6, blockType: "torch" },
];
const deterministicForward = createWorldChunkSnapshot("0:0", deterministicEdits);
const deterministicReverse = createWorldChunkSnapshot("0:0", [...deterministicEdits].reverse());
assert.deepEqual(deterministicForward, deterministicReverse, "v7 encoding is byte-for-byte deterministic across input order");

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
  codecVersion: WORLD_CHUNK_CODEC_VERSION,
  bitsPerCell: WORLD_CHUNK_CODEC_BITS_PER_CELL,
  blockCodeCapacity: WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES,
  distinctEdits: edits.length,
  chunkRows: byChunk.size,
  denseChunkEdits: fullChunk.length,
  denseSnapshotBytes: fullSnapshot.ok ? fullSnapshot.snapshotJson.length : null,
  denseSnapshotHeadroomBytes: fullSnapshot.ok
    ? MAX_WORLD_CHUNK_SNAPSHOT_BYTES - fullSnapshot.snapshotJson.length
    : null,
}));
console.log("lakecraft world chunk snapshot tests: ok");
