import type { DayNightConfig } from "./dayNight.ts";

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD: 4,
  LEAVES: 5,
  PLANKS: 6,
  CRAFTING_TABLE: 7,
} as const;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];

export interface WorldEdit {
  x: number;
  y: number;
  z: number;
  block: BlockId;
}

export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface RemotePlayer extends PlayerPose {
  id: string;
  name?: string;
  color?: readonly [number, number, number] | string;
}

export interface BlockTarget {
  block: WorldEdit;
  place: { x: number; y: number; z: number };
  distance: number;
}

/** Rolling runtime and mesh-work counters suitable for a debug HUD. */
export interface VoxelPerformanceStats {
  fps: number;
  averageFrameTimeMs: number;
  p95FrameTimeMs: number;
  frameSampleCount: number;
  lastMeshRebuildMs: number;
  totalMeshRebuildMs: number;
  lastRebuiltChunkCount: number;
  totalRebuiltChunkCount: number;
  worldVertexCount: number;
  blockCount: number;
  chunkCount: number;
  visibleChunkCount: number;
  drawCalls: number;
  /** Avatar and nameplate draws stay batched regardless of player count. */
  avatarDrawCalls: number;
  avatarVertexCount: number;
  nameplateVertexCount: number;
  mobDrawCalls: number;
  mobVertexCount: number;
  mobVisibleCount: number;
  mobCount: number;
  mobSimulationMs: number;
  estimatedMeshBytes: number;
}

export interface VoxelEngineOptions {
  seed?: number;
  worldRadius?: number;
  initialEdits?: readonly WorldEdit[];
  initialPose?: Partial<PlayerPose>;
  selectedBlock?: BlockId;
  reach?: number;
  /** Shared clock configuration. Defaults to an eight-minute alpha cycle. */
  dayNight?: Partial<DayNightConfig>;
  /** Add a measured server-minus-client clock skew to Date.now(). */
  serverTimeOffsetMs?: number;
  /** previousBlock lets inventory code distinguish mining from placement. */
  onBlockEdit?: (edit: WorldEdit, previousBlock: BlockId) => void;
  /** Seconds the primary action must be held before a block is mined. */
  getMiningDuration?: (block: BlockId) => number;
  onPoseChange?: (pose: PlayerPose) => void;
  onTargetChange?: (target: BlockTarget | null) => void;
  onPointerLockChange?: (locked: boolean) => void;
  /** Emitted at most twice per second for an optional performance HUD/logger. */
  onPerformanceStats?: (stats: VoxelPerformanceStats) => void;
}

export interface VoxelEngine {
  start(): void;
  destroy(): void;
  applyWorldEdits(edits: readonly WorldEdit[]): void;
  setSelectedBlock(block: BlockId): void;
  setRemotePlayers(players: readonly RemotePlayer[]): void;
  getPose(): PlayerPose;
  getTarget(): BlockTarget | null;
  getPerformanceStats(): VoxelPerformanceStats;
  requestPointerLock(): void;
}
