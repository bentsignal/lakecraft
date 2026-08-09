import assert from "node:assert/strict";
import {
  PERFORMANCE_BENCHMARK_DURATION_MS,
  performanceBenchmarkPhase,
  summarizePerformanceEngine,
  summarizePerformanceFrames,
} from "../client/game/performanceBenchmark.ts";
import type { VoxelPerformanceStats } from "../client/game/types.ts";

assert.equal(PERFORMANCE_BENCHMARK_DURATION_MS, 25_000);
assert.equal(performanceBenchmarkPhase(-1), "warmup");
assert.equal(performanceBenchmarkPhase(0), "idle");
assert.equal(performanceBenchmarkPhase(4_999), "idle");
assert.equal(performanceBenchmarkPhase(5_000), "turn");
assert.equal(performanceBenchmarkPhase(9_999), "turn");
assert.equal(performanceBenchmarkPhase(10_000), "sprint");
assert.equal(performanceBenchmarkPhase(24_999), "sprint");
assert.equal(performanceBenchmarkPhase(25_000), "complete");

const frames = summarizePerformanceFrames([
  { phase: "idle", frameTimeMs: 10 },
  { phase: "idle", frameTimeMs: 20 },
  { phase: "idle", frameTimeMs: 30 },
  { phase: "idle", frameTimeMs: 40 },
]);
assert.equal(frames.samples, 4);
assert.equal(frames.elapsedMs, 100);
assert.equal(frames.meanFps, 40);
assert.equal(frames.medianFrameMs, 20);
assert.equal(frames.p95FrameMs, 40);
assert.equal(frames.framesOver16_7Ms, 3);
assert.equal(frames.framesOver25Ms, 2);
assert.equal(frames.framesOver50Ms, 0);

const base: VoxelPerformanceStats = {
  fps: 60, averageFrameTimeMs: 16.667, p95FrameTimeMs: 17, frameSampleCount: 120,
  lastUpdateMs: 2, lastRenderMs: 4, lastTerrainStreamingMs: 1,
  pendingTerrainLoads: 3, pendingTerrainUnloads: 2, pendingMeshRebuilds: 4,
  lastMeshRebuildMs: 0, totalMeshRebuildMs: 20, lastRebuiltChunkCount: 1, totalRebuiltChunkCount: 4,
  worldVertexCount: 1, blockCount: 1, chunkCount: 49, visibleChunkCount: 20, drawCalls: 21,
  avatarDrawCalls: 0, avatarVertexCount: 0, nameplateVertexCount: 0, remoteMeshMs: 0,
  remoteUploadBytes: 0, remoteMeshUpdates: 0, remoteVisiblePlayers: 0, mobDrawCalls: 1,
  mobVertexCount: 1, mobVisibleCount: 1, mobCount: 1, mobSimulationMs: 0,
  droppedItemDrawCalls: 0, droppedItemVertexCount: 0, droppedItemVisibleCount: 0,
  droppedItemCount: 0, droppedItemMeshMs: 0, droppedItemUploadBytes: 0,
  primedTntVertexCount: 0, primedTntVisibleCount: 0, primedTntUploadBytes: 0,
  particleDrawCalls: 0, particleVertexCount: 0, activeParticleCount: 0, particleUploadBytes: 0,
  torchCount: 0, activeTorchLights: 0, firstPersonDrawCalls: 1, firstPersonVertexCount: 1,
  firstPersonLastUploadBytes: 0, firstPersonTotalUploadBytes: 0, firstPersonMeshUpdates: 1,
  firstPersonBufferBytes: 1, estimatedMeshBytes: 1,
};
const engine = summarizePerformanceEngine([
  { phase: "idle", stats: base },
  { phase: "idle", stats: { ...base, lastUpdateMs: 4, lastRenderMs: 8, pendingTerrainLoads: 8, lastMeshRebuildMs: 6 } },
]);
assert.equal(engine.meanUpdateMs, 3);
assert.equal(engine.p95RenderMs, 8);
assert.equal(engine.meanMeshRebuildMs, 3);
assert.equal(engine.maxPendingTerrainLoads, 8);
assert.equal(engine.meanDrawCalls, 21);

console.log("lakecraft performance benchmark model tests: ok");
