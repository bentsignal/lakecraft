import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  performanceHudCoreText,
  performanceHudFpsText,
} from "../client/game/performanceHud.ts";
import type { VoxelPerformanceStats } from "../client/game";

const stats: VoxelPerformanceStats = {
  fps: 59.6,
  averageFrameTimeMs: 16.8,
  p95FrameTimeMs: 21.25,
  frameSampleCount: 120,
  lastUpdateMs: 2.5,
  lastRenderMs: 4.75,
  lastTerrainStreamingMs: 1.25,
  pendingTerrainLoads: 3,
  pendingTerrainUnloads: 2,
  pendingMeshRebuilds: 4,
  lastMeshRebuildMs: 1.5,
  totalMeshRebuildMs: 12,
  lastRebuiltChunkCount: 1,
  totalRebuiltChunkCount: 4,
  worldVertexCount: 42_000,
  blockCount: 7_000,
  chunkCount: 25,
  visibleChunkCount: 13,
  drawCalls: 8,
  avatarDrawCalls: 0,
  avatarVertexCount: 0,
  nameplateVertexCount: 0,
  remoteMeshMs: 2.25,
  remoteUploadBytes: 4_096,
  remoteMeshUpdates: 0,
  remoteVisiblePlayers: 2,
  mobDrawCalls: 1,
  mobVertexCount: 9_000,
  mobVisibleCount: 7,
  mobCount: 12,
  mobSimulationMs: 0.4,
  droppedItemDrawCalls: 1,
  droppedItemVertexCount: 120,
  droppedItemVisibleCount: 2,
  droppedItemCount: 3,
  droppedItemMeshMs: 0.1,
  droppedItemUploadBytes: 2_048,
  primedTntVertexCount: 0,
  primedTntVisibleCount: 0,
  primedTntUploadBytes: 512,
  particleDrawCalls: 1,
  particleVertexCount: 48,
  activeParticleCount: 16,
  particleUploadBytes: 1_024,
  torchCount: 3,
  activeTorchLights: 2,
  firstPersonDrawCalls: 2,
  firstPersonVertexCount: 240,
  firstPersonLastUploadBytes: 4_096,
  firstPersonTotalUploadBytes: 20_000,
  firstPersonMeshUpdates: 4,
  firstPersonBufferBytes: 16_416,
  estimatedMeshBytes: 1_572_864,
};

assert.equal(performanceHudCoreText(stats), `FPS 60  p95 21.3ms
DRAW 8  CHUNKS 13/25
PLAYERS 2  REMOTE 2.25ms / 4KB
DROPS 2/3  0.10ms / 2KB
MOBS 7/12  AI 0.40ms
PFX 16  DRAW 1  1KB
LIGHT 2/3 torches
VERT 42,000  MESH 1.5ms`);
assert.equal(performanceHudFpsText(stats), "FPS 60", "the compact counter rounds the existing bounded sample");
assert.equal(performanceHudCoreText(stats, [12.25, 64, -8.75, "healthy"]), `FPS 60  p95 21.3ms
XYZ 12.3 / 64.0 / -8.8
DRAW 8  CHUNKS 13/25
PLAYERS 2  REMOTE 2.25ms / 4KB
SYNC healthy
DROPS 2/3  0.10ms / 2KB
MOBS 7/12  AI 0.40ms
PFX 16  DRAW 1  1KB
LIGHT 2/3 torches
VERT 42,000  MESH 1.5ms`);

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.ok(app.includes("GameplayDiagnostics") && multiplayer.includes("GameplayDiagnostics"),
  "both gameplay modes render the same coordinates and FPS surface");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.equal(styles.includes(".lc-local-fps"), false,
  "retired FPS-only CSS does not consume the production capsule reserve");
assert.equal(app.includes("useQuery") || app.includes("useMutation"), false,
  "the single-player path adds no Lakebed query or mutation");
assert.equal(multiplayer.includes("performanceHudCoreText"), false,
  "shared diagnostics stay compact instead of duplicating the retired debug-detail surface");

console.log("production performance debug-surface boundary tests passed");
