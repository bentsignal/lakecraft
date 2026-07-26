import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  performanceHudCoreText,
} from "../client/game/performanceHud.ts";
import type { VoxelPerformanceStats } from "../client/game";

const stats: VoxelPerformanceStats = {
  fps: 59.6,
  averageFrameTimeMs: 16.8,
  p95FrameTimeMs: 21.25,
  frameSampleCount: 120,
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
  remoteMeshMs: 0,
  remoteUploadBytes: 0,
  remoteMeshUpdates: 0,
  remoteVisiblePlayers: 0,
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
CHUNK 13/25  DRAW 8
MEM 1536K  UP 8K
ENTITY M 7/12  I 2/3  P 16`);

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.ok(app.includes('if (event.code === "F3" && !event.repeat)'), "held F3 cannot repeatedly flip the overlay");
assert.ok(app.indexOf('if (event.code === "F3"') < app.indexOf("if (commandOpen)"),
  "the debug toggle is independent of pause, inventory, and command focus handling");
assert.ok(app.includes("if (showPerformanceRef.current && performanceOutputRef.current)"),
  "hidden performance sampling causes no DOM or React churn");
assert.ok(app.includes("performanceOutputRef.current.hidden = !showPerformanceRef.current"),
  "the stable output node hides and shows without frame-loop React renders");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.match(styles, /\.lakecraft-perf,.lc-local-perf \{[^}]*font: 11px\/1\.4[^}]*position: fixed;[^}]*top: 12px;/);
assert.ok(styles.includes(".lc-local-perf { right: 8px; }"),
  "local overlay stays in the upper-right, away from crosshair and hotbar at both target widths");
assert.equal(app.includes("useQuery") || app.includes("useMutation"), false,
  "the single-player path adds no Lakebed query or mutation");
assert.equal(multiplayer.match(/performanceHudCoreText\(performanceStats\)/g)?.length, 1,
  "multiplayer reuses the same core counter rendering");

console.log("single-player F3 performance overlay tests passed");
