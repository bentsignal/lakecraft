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
assert.ok(app.includes('if (event.code === "F3" && !event.repeat)'), "held F3 cannot repeatedly flip the overlay");
assert.ok(app.indexOf('if (event.code === "F3"') < app.indexOf("consumeSinglePlayerCommandSurfaceEscape("),
  "the debug toggle is independent of pause, inventory, and command focus handling");
assert.ok(app.includes("if (performanceOutputRef.current && !performanceOutputRef.current.hidden)"),
  "hidden performance sampling causes no DOM or React churn");
assert.ok(app.includes("performanceOutputRef.current.hidden = !performanceOutputRef.current.hidden"),
  "the stable output node hides and shows without frame-loop React renders");
assert.ok(app.includes("if (fpsOutputRef.current) fpsOutputRef.current.textContent = performanceHudFpsText(stats)"),
  "the always-visible counter writes the existing performance sample directly without React state");
assert.ok(app.includes('aria-label="Frames per second" className="lc-local-fps"'),
  "the compact counter is exposed as a named output");
assert.ok(app.includes("const fpsOutputRef = useRef<HTMLOutputElement | null>(null)"));
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.ok(engine.includes("if (now - lastPerformanceSent >= 500)"),
  "FPS text reuses the engine's bounded twice-per-second sampling cadence");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.match(styles, /\.lakecraft-perf,.lc-local-perf \{[^}]*font: 11px\/1\.4[^}]*position: fixed;[^}]*top: 12px;/);
assert.ok(styles.includes(".lc-local-perf { right: 8px; top: 38px; }"),
  "local overlay stays in the upper-right, away from crosshair and hotbar at both target widths");
assert.match(styles, /\.lc-local-fps \{[^}]*background:#000b;[^}]*color:#fff;[^}]*right:8px;[^}]*top:8px;/,
  "the always-visible FPS readout is unobtrusive and high-contrast in the top-right");
assert.equal(app.includes("useQuery") || app.includes("useMutation"), false,
  "the single-player path adds no Lakebed query or mutation");
assert.equal(multiplayer.match(/performanceHudCoreText\(/g)?.length, 1,
  "multiplayer preserves its complete detail surface through the shared formatter");

console.log("single-player F3 performance overlay tests passed");
