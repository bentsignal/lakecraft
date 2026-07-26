import type { VoxelPerformanceStats } from "./types.ts";

export function performanceHudCoreText(stats: VoxelPerformanceStats): string {
  const upload = stats.remoteUploadBytes + stats.droppedItemUploadBytes + stats.primedTntUploadBytes
    + stats.particleUploadBytes + stats.firstPersonLastUploadBytes;
  return `FPS ${stats.fps.toFixed(0)}  p95 ${stats.p95FrameTimeMs.toFixed(1)}ms
CHUNK ${stats.visibleChunkCount}/${stats.chunkCount}  DRAW ${stats.drawCalls}
MEM ${Math.round(stats.estimatedMeshBytes / 1024)}K  UP ${Math.round(upload / 1024)}K
ENTITY M ${stats.mobVisibleCount}/${stats.mobCount}  I ${stats.droppedItemVisibleCount}/${stats.droppedItemCount}  P ${stats.activeParticleCount}`;
}
