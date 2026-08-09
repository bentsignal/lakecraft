import type { VoxelPerformanceStats } from "./types.ts";

export const PERFORMANCE_BENCHMARK_WARMUP_MS = 2_000;
export const PERFORMANCE_BENCHMARK_IDLE_MS = 5_000;
export const PERFORMANCE_BENCHMARK_TURN_MS = 5_000;
export const PERFORMANCE_BENCHMARK_SPRINT_MS = 15_000;
export const PERFORMANCE_BENCHMARK_DURATION_MS = PERFORMANCE_BENCHMARK_IDLE_MS
  + PERFORMANCE_BENCHMARK_TURN_MS
  + PERFORMANCE_BENCHMARK_SPRINT_MS;

export type PerformanceBenchmarkPhase = "warmup" | "idle" | "turn" | "sprint" | "complete";

export interface PerformanceFrameSample {
  phase: Exclude<PerformanceBenchmarkPhase, "warmup" | "complete">;
  frameTimeMs: number;
}

export interface PerformanceEngineSample {
  phase: Exclude<PerformanceBenchmarkPhase, "warmup" | "complete">;
  stats: VoxelPerformanceStats;
}

export interface PerformanceFrameSummary {
  samples: number;
  elapsedMs: number;
  meanFps: number;
  onePercentLowFps: number;
  medianFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  framesOver16_7Ms: number;
  framesOver25Ms: number;
  framesOver50Ms: number;
}

export interface PerformanceEngineSummary {
  samples: number;
  meanUpdateMs: number;
  p95UpdateMs: number;
  meanRenderMs: number;
  p95RenderMs: number;
  meanTerrainStreamingMs: number;
  p95TerrainStreamingMs: number;
  meanMeshRebuildMs: number;
  p95MeshRebuildMs: number;
  maxPendingTerrainLoads: number;
  maxPendingTerrainUnloads: number;
  maxPendingMeshRebuilds: number;
  meanDrawCalls: number;
  meanVisibleChunks: number;
  maxLoadedChunks: number;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

export function performanceBenchmarkPhase(elapsedMs: number): PerformanceBenchmarkPhase {
  if (elapsedMs < 0) return "warmup";
  if (elapsedMs < PERFORMANCE_BENCHMARK_IDLE_MS) return "idle";
  if (elapsedMs < PERFORMANCE_BENCHMARK_IDLE_MS + PERFORMANCE_BENCHMARK_TURN_MS) return "turn";
  if (elapsedMs < PERFORMANCE_BENCHMARK_DURATION_MS) return "sprint";
  return "complete";
}

export function summarizePerformanceFrames(samples: readonly PerformanceFrameSample[]): PerformanceFrameSummary {
  const values = samples.map(({ frameTimeMs }) => frameTimeMs).filter((value) => value > 0 && Number.isFinite(value));
  const sorted = [...values].sort((left, right) => left - right);
  const average = mean(values);
  const worstOnePercent = sorted.slice(Math.floor(sorted.length * 0.99));
  return {
    samples: values.length,
    elapsedMs: rounded(values.reduce((total, value) => total + value, 0)),
    meanFps: rounded(average > 0 ? 1_000 / average : 0),
    onePercentLowFps: rounded(worstOnePercent.length ? 1_000 / mean(worstOnePercent) : 0),
    medianFrameMs: rounded(percentile(sorted, 0.5)),
    p95FrameMs: rounded(percentile(sorted, 0.95)),
    p99FrameMs: rounded(percentile(sorted, 0.99)),
    maxFrameMs: rounded(sorted.at(-1) ?? 0),
    framesOver16_7Ms: values.filter((value) => value > 16.7).length,
    framesOver25Ms: values.filter((value) => value > 25).length,
    framesOver50Ms: values.filter((value) => value > 50).length,
  };
}

export function summarizePerformanceEngine(samples: readonly PerformanceEngineSample[]): PerformanceEngineSummary {
  const stats = samples.map((sample) => sample.stats);
  const summary = (select: (value: VoxelPerformanceStats) => number) => {
    const values = stats.map(select);
    const sorted = [...values].sort((left, right) => left - right);
    return [rounded(mean(values)), rounded(percentile(sorted, 0.95))] as const;
  };
  const [meanUpdateMs, p95UpdateMs] = summary((value) => value.lastUpdateMs);
  const [meanRenderMs, p95RenderMs] = summary((value) => value.lastRenderMs);
  const [meanTerrainStreamingMs, p95TerrainStreamingMs] = summary((value) => value.lastTerrainStreamingMs);
  const [meanMeshRebuildMs, p95MeshRebuildMs] = summary((value) => value.lastMeshRebuildMs);
  return {
    samples: stats.length,
    meanUpdateMs,
    p95UpdateMs,
    meanRenderMs,
    p95RenderMs,
    meanTerrainStreamingMs,
    p95TerrainStreamingMs,
    meanMeshRebuildMs,
    p95MeshRebuildMs,
    maxPendingTerrainLoads: Math.max(0, ...stats.map((value) => value.pendingTerrainLoads)),
    maxPendingTerrainUnloads: Math.max(0, ...stats.map((value) => value.pendingTerrainUnloads)),
    maxPendingMeshRebuilds: Math.max(0, ...stats.map((value) => value.pendingMeshRebuilds)),
    meanDrawCalls: rounded(mean(stats.map((value) => value.drawCalls))),
    meanVisibleChunks: rounded(mean(stats.map((value) => value.visibleChunkCount))),
    maxLoadedChunks: Math.max(0, ...stats.map((value) => value.chunkCount)),
  };
}
