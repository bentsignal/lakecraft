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

assert.equal(WORLD_CHUNK_CODEC_VERSION, 4);
assert.equal(WORLD_CHUNK_CODEC_BITS_PER_CELL, 6);
assert.equal(WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES, 63, "six-bit snapshots reserve zero and expose 63 block codes");
assert.equal(WORLD_CHUNK_BLOCK_TYPES.length, 31, "the deployed append-only palette remains unchanged during the codec upgrade");
assert.ok(WORLD_CHUNK_BLOCK_TYPES.length <= WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES);
assert.deepEqual(
  WORLD_CHUNK_BLOCK_TYPES.slice(-15),
  ["ladder", "cobblestone", "sand", "glass", "gold_ore", "diamond_ore", "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence", "oak_fence_gate_closed", "oak_fence_gate_open", "stone_brick_slab"],
  "new persisted block codes append without renumbering deployed materials",
);

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
for (let y = WORLD_EDIT_MIN_Y; y <= WORLD_EDIT_MAX_Y; y += 1) {
  for (let z = 0; z < 8; z += 1) {
    for (let x = 0; x < 8; x += 1) fullChunk.push({ x, y, z, blockType: "stone" });
  }
}
const fullSnapshot = createWorldChunkSnapshot("0:0", fullChunk);
assert.equal(fullSnapshot.ok, true);
if (fullSnapshot.ok) {
  assert.ok(fullSnapshot.snapshotJson.length < MAX_WORLD_CHUNK_SNAPSHOT_BYTES, `dense snapshot was ${fullSnapshot.snapshotJson.length} bytes`);
  assert.equal(JSON.parse(fullSnapshot.snapshotJson).v, 4, "new snapshots use six-bit sparse vertical sections");
  const decoded = decodeWorldChunkSnapshot("0:0", fullSnapshot.snapshotJson);
  assert.equal(decoded.ok && decoded.edits.length, fullChunk.length);
}

// Production rows written before ore/furnace support used two four-bit cells
// per byte. They must remain readable and upgrade on the next edit.
const legacyPacked = new Uint8Array(Math.ceil((69 * 8 * 8) / 2));
const legacyStoneIndex = (0 - -4) * 64;
legacyPacked[legacyStoneIndex >> 1] = 4; // v1 code 4 = stone
const legacySnapshot = JSON.stringify({ v: 1, cells: Buffer.from(legacyPacked).toString("base64") });
const legacyDecoded = decodeWorldChunkSnapshot("0:0", legacySnapshot);
assert.equal(legacyDecoded.ok, true);
if (legacyDecoded.ok) assert.equal(legacyDecoded.edits.find((edit) => edit.coordKey === "0:0:0")?.blockType, "stone");
const migrated = applyWorldChunkEdit("0:0", legacySnapshot, { x: 1, y: 0, z: 0, blockType: "furnace" });
assert.equal(migrated.ok, true);
if (migrated.ok) {
  assert.equal(JSON.parse(migrated.snapshotJson).v, 4, "editing a legacy row migrates it to the current codec");
  const decoded = decodeWorldChunkSnapshot("0:0", migrated.snapshotJson);
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.edits.find((edit) => edit.coordKey === "0:0:0")?.blockType, "stone");
    assert.equal(decoded.edits.find((edit) => edit.coordKey === "1:0:0")?.blockType, "furnace");
  }
}

// Production v2 rows used one fixed-height, five-bit stream. Keep the byte
// layout readable, then upgrade it only when a write occurs.
const legacyV2Packed = new Uint8Array(Math.ceil((69 * 8 * 8 * 5) / 8));
const legacyV2OriginIndex = (0 - -4) * 64;
setPackedCode(legacyV2Packed, legacyV2OriginIndex, 16, 5); // code 16 = furnace
const legacyV2Snapshot = JSON.stringify({ v: 2, cells: Buffer.from(legacyV2Packed).toString("base64") });
const legacyV2Decoded = decodeWorldChunkSnapshot("0:0", legacyV2Snapshot);
assert.equal(legacyV2Decoded.ok, true);
if (legacyV2Decoded.ok) {
  assert.equal(legacyV2Decoded.edits.find((edit) => edit.coordKey === "0:0:0")?.blockType, "furnace");
}
const migratedV2 = applyWorldChunkEdit("0:0", legacyV2Snapshot, { x: 1, y: 0, z: 0, blockType: "glass" });
assert.equal(migratedV2.ok, true);
if (migratedV2.ok) {
  assert.equal(JSON.parse(migratedV2.snapshotJson).v, 4, "v2 upgrades lazily on write");
  const decoded = decodeWorldChunkSnapshot("0:0", migratedV2.snapshotJson);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(
    decoded.edits.map(({ blockType }) => blockType),
    ["furnace", "glass"],
  );
}

// Deployed v3 rows used sparse 8-high sections with 320-byte five-bit cells.
// Code 31 is especially important: it was shipped before v4 and must retain
// its exact stone-brick-slab meaning.
const legacyV3Section = new Uint8Array((8 * 8 * 8 * 5) / 8);
setPackedCode(legacyV3Section, 0, 31, 5); // code 31 = stone_brick_slab
setPackedCode(legacyV3Section, 1, 1, 5); // code 1 = explicit air
const legacyV3Snapshot = JSON.stringify({
  v: 3,
  sections: [{ y: 0, cells: Buffer.from(legacyV3Section).toString("base64") }],
});
const legacyV3Decoded = decodeWorldChunkSnapshot("0:0", legacyV3Snapshot);
assert.equal(legacyV3Decoded.ok, true);
if (legacyV3Decoded.ok) assert.deepEqual(
  legacyV3Decoded.edits.map(({ coordKey, blockType }) => ({ coordKey, blockType })),
  [
    { coordKey: "0:0:0", blockType: "stone_brick_slab" },
    { coordKey: "1:0:0", blockType: "air" },
  ],
);
const migratedV3 = applyWorldChunkEdit("0:0", legacyV3Snapshot, { x: 2, y: 0, z: 0, blockType: "torch" });
assert.equal(migratedV3.ok, true);
if (migratedV3.ok) {
  assert.equal(JSON.parse(migratedV3.snapshotJson).v, 4, "v3 upgrades lazily on write");
  const decoded = decodeWorldChunkSnapshot("0:0", migratedV3.snapshotJson);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(
    decoded.edits.map(({ blockType }) => blockType),
    ["stone_brick_slab", "air", "torch"],
  );
}

const highestCode = createWorldChunkSnapshot("0:0", [
  { x: 0, y: 1, z: 0, blockType: "cobblestone" },
  { x: 1, y: 1, z: 0, blockType: "sand" },
  { x: 2, y: 1, z: 0, blockType: "glass" },
  { x: 3, y: 1, z: 0, blockType: "gold_ore" },
  { x: 4, y: 1, z: 0, blockType: "diamond_ore" },
  { x: 5, y: 1, z: 0, blockType: "tnt" },
  { x: 6, y: 1, z: 0, blockType: "gravel" },
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
  { x: 0, y: 0, z: 0, blockType: "stone_brick_slab" },
]);
assert.equal(currentSectionProbe.ok, true);
if (currentSectionProbe.ok) {
  const parsed = JSON.parse(currentSectionProbe.snapshotJson) as {
    v: number;
    sections: Array<{ y: number; cells: string }>;
  };
  assert.equal(parsed.v, 4);
  assert.equal(parsed.sections.length, 1);
  assert.equal(Buffer.from(parsed.sections[0].cells, "base64").length, 384, "v4 sections allocate six bits for each of 512 cells");
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
  "the six-bit format has code capacity through 63 but rejects codes until their append-only palette entry exists",
);
assert.deepEqual(
  decodeWorldChunkSnapshot("0:0", JSON.stringify({
    v: 5,
    sections: [{ y: 0, cells: Buffer.from(new Uint8Array(384)).toString("base64") }],
  })),
  { ok: false, reason: "invalid_snapshot" },
  "future version numbers stay behind an explicit compatibility fence",
);

const deterministicEdits: WorldChunkEditInput[] = [
  { x: 7, y: 128, z: 7, blockType: "stone_brick_slab" },
  { x: 0, y: -24, z: 0, blockType: "air" },
  { x: 4, y: 17, z: 2, blockType: "diamond_ore" },
  { x: 3, y: -1, z: 6, blockType: "torch" },
];
const deterministicForward = createWorldChunkSnapshot("0:0", deterministicEdits);
const deterministicReverse = createWorldChunkSnapshot("0:0", [...deterministicEdits].reverse());
assert.deepEqual(deterministicForward, deterministicReverse, "v4 encoding is byte-for-byte deterministic across input order");

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
