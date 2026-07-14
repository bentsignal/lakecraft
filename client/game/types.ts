import type { DayNightConfig } from "./dayNight.ts";
import type { MobCombatStateSnapshot, MobDrop, MobRayTarget } from "./mobs.ts";

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD: 4,
  LEAVES: 5,
  PLANKS: 6,
  CRAFTING_TABLE: 7,
  TORCH: 8,
  CHEST: 9,
  DOOR_CLOSED: 10,
  DOOR_OPEN: 11,
  BED: 12,
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

export interface RespawnPoint {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  pitch?: number;
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
  remoteMeshMs: number;
  remoteUploadBytes: number;
  remoteMeshUpdates: number;
  remoteVisiblePlayers: number;
  mobDrawCalls: number;
  mobVertexCount: number;
  mobVisibleCount: number;
  mobCount: number;
  mobSimulationMs: number;
  torchCount: number;
  activeTorchLights: number;
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
  /** Combat damage used by either Lakebed authority or the local fallback. */
  getAttackDamage?: () => number;
  /**
   * When configured, attacks are delegated without optimistic local damage or
   * drops. Apply the resulting/query state through `applyMobCombatStates`.
   */
  onMobAttack?: (target: Readonly<MobRayTarget>, damage: number) => void | Promise<void>;
  getPlayerProtection?: () => number;
  /** Used only by the client-local fallback when `onMobAttack` is absent. */
  onMobDrops?: (drops: readonly MobDrop[]) => void;
  onPlayerDamage?: (amount: number) => void;
  onPlayerHealthChange?: (health: number, maximumHealth: number) => void;
  /** Return true when the held non-block item handled secondary use (for example, eating food). */
  onUseSelectedItem?: () => boolean;
  /** Return true after handling a chest or bed interaction to suppress block placement. */
  onInteractBlock?: (target: BlockTarget) => boolean;
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
  applyMobCombatStates(states: readonly MobCombatStateSnapshot[], serverTimeOffsetMs?: number): void;
  /** Stable deterministic IDs used by the bounded Lakebed authority query. */
  getMobIds(): string[];
  setSelectedBlock(block: BlockId): void;
  setRemotePlayers(players: readonly RemotePlayer[]): void;
  setDayNightClock(config: Partial<DayNightConfig>, serverTimeOffsetMs?: number): void;
  setRespawnPoint(point: RespawnPoint): void;
  adjustPlayerHealth(delta: number): number;
  getPose(): PlayerPose;
  getTarget(): BlockTarget | null;
  getPerformanceStats(): VoxelPerformanceStats;
  requestPointerLock(): void;
  respawn(): void;
}
