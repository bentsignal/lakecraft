import type { DayNightConfig } from "./dayNight.ts";
import type { MobCombatStateSnapshot, MobDrop, MobRayTarget } from "./mobs.ts";
import type { ArmorId, ItemId } from "../../shared/game.ts";
import type { DroppedItemRenderItem } from "./droppedItemRenderer.ts";
import type { RemotePlayerRayTarget } from "./remotePlayerTargeting.ts";
import type { MobMotionPose } from "../../shared/mobMotionAuthority.ts";
import type { BlockParticleEvent } from "./blockParticles.ts";

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
  COAL_ORE: 13,
  IRON_ORE: 14,
  FURNACE: 15,
  LADDER: 16,
  COBBLESTONE: 17,
  SAND: 18,
  GLASS: 19,
  GOLD_ORE: 20,
  DIAMOND_ORE: 21,
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
  /** Explicit bounded velocity from the sparse Lakebed presence snapshot. */
  vx?: number;
  vy?: number;
  vz?: number;
  heldItem?: ItemId | null;
  armorHead?: ArmorId | null;
  armorChest?: ArmorId | null;
  armorLegs?: ArmorId | null;
  armorFeet?: ArmorId | null;
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
  droppedItemDrawCalls: number;
  droppedItemVertexCount: number;
  droppedItemVisibleCount: number;
  droppedItemCount: number;
  droppedItemMeshMs: number;
  droppedItemUploadBytes: number;
  particleDrawCalls: number;
  particleVertexCount: number;
  activeParticleCount: number;
  particleUploadBytes: number;
  torchCount: number;
  activeTorchLights: number;
  estimatedMeshBytes: number;
}

export interface VoxelEngineOptions {
  seed?: number;
  worldRadius?: number;
  initialEdits?: readonly WorldEdit[];
  initialPose?: Partial<PlayerPose>;
  /** Preserve a Lakebed-persisted reconnect pose exactly instead of lifting it to local safe-spawn height. */
  preserveInitialPose?: boolean;
  selectedBlock?: BlockId;
  reach?: number;
  /** Shared clock configuration. Defaults to an eight-minute alpha cycle. */
  dayNight?: Partial<DayNightConfig>;
  /** Add a measured server-minus-client clock skew to Date.now(). */
  serverTimeOffsetMs?: number;
  /** previousBlock lets inventory code distinguish mining from placement. */
  onBlockEdit?: (edit: WorldEdit, previousBlock: BlockId) => void;
  /** Prevent a second optimistic world edit while an authoritative one is pending. */
  canEditBlock?: () => boolean;
  /** Seconds the primary action must be held before a block is mined. */
  getMiningDuration?: (block: BlockId) => number;
  /** Combat damage used by either Lakebed authority or the local fallback. */
  getAttackDamage?: () => number;
  /**
   * When configured, attacks are delegated without optimistic local damage or
   * drops. Apply the resulting/query state through `applyMobCombatStates`.
   */
  onMobAttack?: (target: Readonly<MobRayTarget>, damage: number) => void | Promise<void>;
  /** Event-driven PvP attack request for the nearest rendered remote under the crosshair. */
  onRemotePlayerAttack?: (target: Readonly<RemotePlayerRayTarget>, damage: number) => void | Promise<void>;
  /** Normalized held-mining progress for the first-person crack overlay. */
  onMiningProgress?: (progress: number) => void;
  /** Bounded material-aware mining impact, emitted at most about four times per second. */
  onMiningHit?: (target: Readonly<BlockTarget>) => void;
  /** Distance-based grounded step over the block beneath the player. */
  onFootstep?: (block: BlockId) => void;
  /** Discrete first-person swing/use feedback; never emitted from the frame loop. */
  onHandAction?: (action: "mine" | "attack" | "place" | "use") => void;
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
  /** Reconciles the retained renderer against Lakebed's shared fixed-tick mob timeline. */
  applyMobMotionSnapshot(poses: readonly MobMotionPose[], serverTimeOffsetMs?: number): void;
  /** Stable deterministic IDs used by the bounded Lakebed authority query. */
  getMobIds(): string[];
  setSelectedBlock(block: BlockId): void;
  setRemotePlayers(players: readonly RemotePlayer[]): void;
  /** Replaces the bounded Lakebed-authoritative item snapshot rendered in-world. */
  setDroppedItems(items: readonly DroppedItemRenderItem[]): void;
  /** Local-only visual feedback; callers should use this after authoritative confirmation. */
  spawnBlockParticles(event: Readonly<BlockParticleEvent>): number;
  setDayNightClock(config: Partial<DayNightConfig>, serverTimeOffsetMs?: number): void;
  setRespawnPoint(point: RespawnPoint): void;
  adjustPlayerHealth(delta: number): number;
  /** Snap to a Lakebed-authoritative pose without changing health or respawn state. */
  reconcilePose(pose: PlayerPose): void;
  getPose(): PlayerPose;
  getTarget(): BlockTarget | null;
  getPerformanceStats(): VoxelPerformanceStats;
  requestPointerLock(): void;
  respawn(): void;
}
