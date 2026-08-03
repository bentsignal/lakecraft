import type { VoxelPerformanceStats } from "./types.ts";

const fixed = (value: number, digits: number): string => value.toFixed(digits);

export function performanceHudFpsText(stats: Pick<VoxelPerformanceStats, "fps">): string {
  return `FPS ${fixed(stats.fps, 0)}`;
}

export function performanceHudCoreText(
  stats: VoxelPerformanceStats,
  multiplayer?: readonly [x: number, y: number, z: number, sync: string],
): string {
  return `FPS ${fixed(stats.fps, 0)}  p95 ${fixed(stats.p95FrameTimeMs, 1)}ms
${multiplayer ? `XYZ ${fixed(multiplayer[0], 1)} / ${fixed(multiplayer[1], 1)} / ${fixed(multiplayer[2], 1)}
` : ""}DRAW ${stats.drawCalls}  CHUNKS ${stats.visibleChunkCount}/${stats.chunkCount}
PLAYERS ${stats.remoteVisiblePlayers}  REMOTE ${fixed(stats.remoteMeshMs, 2)}ms / ${fixed(stats.remoteUploadBytes / 1024, 0)}KB
${multiplayer ? `SYNC ${multiplayer[3]}
` : ""}DROPS ${stats.droppedItemVisibleCount}/${stats.droppedItemCount}  ${fixed(stats.droppedItemMeshMs, 2)}ms / ${fixed(stats.droppedItemUploadBytes / 1024, 0)}KB
MOBS ${stats.mobVisibleCount}/${stats.mobCount}  AI ${fixed(stats.mobSimulationMs, 2)}ms
PFX ${stats.activeParticleCount}  DRAW ${stats.particleDrawCalls}  ${fixed(stats.particleUploadBytes / 1024, 0)}KB
LIGHT ${stats.activeTorchLights}/${stats.torchCount} torches
VERT ${stats.worldVertexCount.toLocaleString()}  MESH ${fixed(stats.lastMeshRebuildMs, 1)}ms`;
}
