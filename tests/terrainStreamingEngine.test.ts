import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  DEFAULT_STREAMING_CHUNK_RADIUS,
  MAX_LOCAL_STREAMING_CHUNK_RADIUS,
  MAX_STREAMING_CHUNK_COUNT,
  chunkKey,
  planChunkWindow,
} from "../client/game/chunks.ts";
import { blockKey, terrainHeight } from "../client/game/terrain.ts";
import { materializeTerrainChunk } from "../client/game/voxelEngine.ts";
import { BLOCK, type WorldEdit } from "../client/game/types.ts";

const SEED = 7_319;
const removedSurface: WorldEdit = {
  x: 1,
  y: terrainHeight(1, 1, SEED),
  z: 1,
  block: BLOCK.AIR,
};
const placedTorch: WorldEdit = { x: 2, y: 18, z: 2, block: BLOCK.TORCH };
const foreignEdit: WorldEdit = { x: 8, y: 18, z: 2, block: BLOCK.TORCH };
const edited = materializeTerrainChunk(SEED, 0, 0, [removedSurface, placedTorch, foreignEdit]);
assert.equal(edited.has(blockKey(removedSurface.x, removedSurface.y, removedSurface.z)), false);
assert.equal(edited.get(blockKey(placedTorch.x, placedTorch.y, placedTorch.z)), BLOCK.TORCH);
assert.equal(edited.has(blockKey(foreignEdit.x, foreignEdit.y, foreignEdit.z)), false);
assert.deepEqual(
  [...materializeTerrainChunk(SEED, 0, 0, [removedSurface, placedTorch])],
  [...edited],
  "unloaded chunks must deterministically reconstruct with their remembered edits",
);

const loaded = new Set<string>();
const initialPlan = planChunkWindow(0.5, 0.5, loaded, DEFAULT_STREAMING_CHUNK_RADIUS);
const initialStartedAt = performance.now();
let initialBlockCount = 0;
for (const coordinate of initialPlan.load) {
  loaded.add(chunkKey(coordinate.x, coordinate.z));
  initialBlockCount += materializeTerrainChunk(SEED, coordinate.x, coordinate.z).size;
}
const initialGenerationMs = performance.now() - initialStartedAt;
assert.equal(loaded.size, MAX_STREAMING_CHUNK_COUNT);
assert.ok(initialBlockCount > 70_000, "the active window should include deep mineable strata");

const oneChunkTravel = planChunkWindow(8.5, 0.5, loaded, DEFAULT_STREAMING_CHUNK_RADIUS);
assert.equal(oneChunkTravel.load.length, 7, "crossing one chunk should load one new edge only");
assert.equal(oneChunkTravel.unload.length, 7, "crossing one chunk should unload one old edge only");
const expandedLocalPlan = planChunkWindow(
  0.5,
  0.5,
  loaded,
  MAX_LOCAL_STREAMING_CHUNK_RADIUS,
  8,
  MAX_LOCAL_STREAMING_CHUNK_RADIUS,
);
assert.equal(expandedLocalPlan.active.length, 169, "the explicit offline ceiling exposes a bounded 13x13 window");
assert.equal(expandedLocalPlan.load.length, 120, "expanding from the default window loads only the additional ring");
const incrementalStartedAt = performance.now();
let incrementalBlockCount = 0;
for (const coordinate of oneChunkTravel.load) {
  incrementalBlockCount += materializeTerrainChunk(SEED, coordinate.x, coordinate.z).size;
}
const incrementalGenerationMs = performance.now() - incrementalStartedAt;

const farPlan = planChunkWindow(800_000.5, -800_000.5, loaded, DEFAULT_STREAMING_CHUNK_RADIUS);
assert.equal(farPlan.load.length, MAX_STREAMING_CHUNK_COUNT);
assert.equal(farPlan.unload.length, MAX_STREAMING_CHUNK_COUNT);
const farStartedAt = performance.now();
let farBlockCount = 0;
for (const coordinate of farPlan.load) {
  farBlockCount += materializeTerrainChunk(SEED, coordinate.x, coordinate.z).size;
}
const farGenerationMs = performance.now() - farStartedAt;
assert.ok(farBlockCount > 70_000);

// Generous CI guardrails catch accidental unbounded generation without making
// normal machine variance flaky. Browser mesh upload is tracked separately by
// the engine's existing lastMeshRebuildMs performance statistic.
assert.ok(initialGenerationMs < 750, `initial 49-chunk generation took ${initialGenerationMs.toFixed(1)}ms`);
assert.ok(incrementalGenerationMs < 160, `incremental 7-chunk generation took ${incrementalGenerationMs.toFixed(1)}ms`);
assert.ok(farGenerationMs < 750, `far 49-chunk generation took ${farGenerationMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  benchmark: "engine terrain streaming materialization",
  initial: { chunks: initialPlan.load.length, blocks: initialBlockCount, ms: Number(initialGenerationMs.toFixed(2)) },
  incremental: { chunks: oneChunkTravel.load.length, blocks: incrementalBlockCount, ms: Number(incrementalGenerationMs.toFixed(2)) },
  far: { chunks: farPlan.load.length, blocks: farBlockCount, ms: Number(farGenerationMs.toFixed(2)) },
}));
console.log("lakecraft terrain streaming engine tests: ok");
