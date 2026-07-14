import assert from "node:assert/strict";
import {
  WORLD_CHUNK_SIZE,
  chunkCoordinate,
  chunkKeyForBlock,
  dirtyChunkKeysForEdit,
  dirtyChunkKeysForEdits,
} from "../client/game/chunks.ts";
import { createTerrain } from "../client/game/terrain.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";

assert.equal(chunkCoordinate(0), 0);
assert.equal(chunkCoordinate(7), 0);
assert.equal(chunkCoordinate(8), 1);
assert.equal(chunkCoordinate(-1), -1);
assert.equal(chunkCoordinate(-8), -1);
assert.equal(chunkCoordinate(-9), -2);
assert.deepEqual(dirtyChunkKeysForEdit(2, 3).sort(), ["0,0"]);
assert.deepEqual(dirtyChunkKeysForEdit(0, 3).sort(), ["-1,0", "0,0"]);
assert.deepEqual(dirtyChunkKeysForEdit(-1, -1).sort(), ["-1,-1", "-1,0", "0,-1"]);
assert.deepEqual(
  dirtyChunkKeysForEdits([{ x: 7, z: 2 }, { x: 8, z: 2 }]).sort(),
  ["0,0", "1,0"],
  "batch planning should deduplicate both sides of a shared chunk boundary",
);

const blocks = createTerrain(7319, 20);
const chunks = new Map<string, string[]>();
for (const key of blocks.keys()) {
  const [x, , z] = key.split(",").map(Number);
  const owner = chunkKeyForBlock(x, z);
  const owned = chunks.get(owner) ?? [];
  owned.push(key);
  chunks.set(owner, owned);
}

function exposedVertexCount(keys: readonly string[], world: ReadonlyMap<string, BlockId>): number {
  const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  let faces = 0;
  for (const key of keys) {
    const block = world.get(key) ?? BLOCK.AIR;
    if (block === BLOCK.AIR) continue;
    const [x, y, z] = key.split(",").map(Number);
    for (const [dx, dy, dz] of neighbors) {
      if ((world.get(`${x + dx},${y + dy},${z + dz}`) ?? BLOCK.AIR) === BLOCK.AIR) faces += 1;
    }
  }
  return faces * 6;
}

const edit = { x: 2, z: 2 };
const dirtyKeys = dirtyChunkKeysForEdit(edit.x, edit.z);
const dirtyBlocks = dirtyKeys.flatMap((key) => chunks.get(key) ?? []);
const allKeys = [...blocks.keys()];
const fullVertices = exposedVertexCount(allKeys, blocks);
const dirtyVertices = exposedVertexCount(dirtyBlocks, blocks);
const scanReduction = allKeys.length / dirtyBlocks.length;
const uploadReduction = fullVertices / dirtyVertices;

assert.equal(WORLD_CHUNK_SIZE, 8);
assert.equal(dirtyKeys.length, 1);
assert.ok(scanReduction > 20, `expected >20x candidate scan reduction, got ${scanReduction.toFixed(1)}x`);
assert.ok(uploadReduction > 15, `expected >15x vertex upload reduction, got ${uploadReduction.toFixed(1)}x`);

console.log(JSON.stringify({
  benchmark: "single interior block edit",
  worldBlocks: allKeys.length,
  dirtyChunkBlocks: dirtyBlocks.length,
  fullVertices,
  dirtyChunkVertices: dirtyVertices,
  scanReduction: Number(scanReduction.toFixed(1)),
  uploadReduction: Number(uploadReduction.toFixed(1)),
}));
console.log("lakecraft chunk performance tests: ok");
