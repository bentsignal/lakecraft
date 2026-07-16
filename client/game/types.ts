import type { DayNightConfig } from "./dayNight.ts";
import {
  validateMobSimulationSnapshot,
  type MobDamageResult,
  type MobCombatStateSnapshot,
  type LocalMobDeathDropEvent,
  type MobRayTarget,
  type MobSimulationSnapshot,
} from "./mobs.ts";
import type { ArmorId, ItemId } from "../../shared/game.ts";
import type { DroppedItemRenderItem } from "./droppedItemRenderer.ts";
import type { PlayerProjectileVisual } from "./playerProjectileRenderer.ts";
import type { RemotePlayerRayTarget } from "./remotePlayerTargeting.ts";
import type { MobMotionPose } from "../../shared/mobMotionAuthority.ts";
import type { BlockParticleEvent } from "./blockParticles.ts";
import type { PlayerMovementMode } from "./playerMovement.ts";
import type { MotionVisualActionKind } from "../../shared/multiplayerSegments.ts";

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
  TNT: 22,
  GRAVEL: 23,
  WOOL: 24,
  SAPLING: 25,
  STONE_BRICKS: 26,
  OAK_FENCE: 27,
  OAK_FENCE_GATE_CLOSED: 28,
  OAK_FENCE_GATE_OPEN: 29,
  STONE_BRICK_SLAB: 30,
  CLAY: 31,
  BRICKS: 32,
} as const;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];

export interface WorldEdit {
  x: number;
  y: number;
  z: number;
  block: BlockId;
}

export type PlayerDamageCause = "mob" | "creeper" | "tnt" | "fall";

/** One locally resolved blast edit. `previousBlock` is evidence for particles/save state, not a mining drop. */
export interface LocalExplosionEdit extends WorldEdit {
  previousBlock: BlockId;
  /** A neighboring TNT remains in terrain and should receive a short secondary fuse. */
  chainPrimed?: true;
}

/** Read-only fuse timing/position data consumed by the retained world renderer. */
export interface PrimedTntVisualFuse {
  eventId: string;
  x: number;
  y: number;
  z: number;
  ignitedAt: number;
  dueAt: number;
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

export const VOXEL_RUNTIME_SNAPSHOT_VERSION = 1 as const;

/** Engine-owned state required to resume one local world without replaying time. */
export interface VoxelRuntimeSnapshot {
  version: typeof VOXEL_RUNTIME_SNAPSHOT_VERSION;
  pose: PlayerPose;
  respawnPoint: PlayerPose;
  playerHealth: number;
  /** Pause-aware world clock sampled by the day/night cycle. */
  worldTimeMs: number;
  dayNight: DayNightConfig;
  mobAccumulatorSeconds: number;
  mobSimulation: MobSimulationSnapshot;
}

function runtimeSnapshotRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function runtimeSnapshotHasKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function validateRuntimePose(value: unknown): PlayerPose | null {
  const pose = runtimeSnapshotRecord(value);
  if (!pose || !runtimeSnapshotHasKeys(pose, ["x", "y", "z", "yaw", "pitch"])) return null;
  if (![pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every((part) => typeof part === "number" && Number.isFinite(part))) return null;
  if (Math.abs(pose.x as number) > 1_000_000 || Math.abs(pose.z as number) > 1_000_000
    || (pose.y as number) < -24 || (pose.y as number) > 128
    || Math.abs(pose.yaw as number) > Math.PI * 4
    || Math.abs(pose.pitch as number) > 1.52) return null;
  return {
    x: pose.x as number,
    y: pose.y as number,
    z: pose.z as number,
    yaw: pose.yaw as number,
    pitch: pose.pitch as number,
  };
}

/** Strict all-or-nothing validator for the engine-owned portion of a local save. */
export function validateVoxelRuntimeSnapshot(value: unknown): VoxelRuntimeSnapshot | null {
  const snapshot = runtimeSnapshotRecord(value);
  if (!snapshot || !runtimeSnapshotHasKeys(snapshot, [
    "version", "pose", "respawnPoint", "playerHealth", "worldTimeMs", "dayNight",
    "mobAccumulatorSeconds", "mobSimulation",
  ])) return null;
  if (snapshot.version !== VOXEL_RUNTIME_SNAPSHOT_VERSION) return null;
  const pose = validateRuntimePose(snapshot.pose);
  const respawnPoint = validateRuntimePose(snapshot.respawnPoint);
  const dayNight = runtimeSnapshotRecord(snapshot.dayNight);
  const mobSimulation = validateMobSimulationSnapshot(snapshot.mobSimulation);
  if (!pose || !respawnPoint || !mobSimulation || !dayNight
    || !runtimeSnapshotHasKeys(dayNight, ["cycleLengthMs", "epochMs", "epochPhase"])) return null;
  if (typeof snapshot.playerHealth !== "number" || !Number.isFinite(snapshot.playerHealth)
    || snapshot.playerHealth < 0 || snapshot.playerHealth > 20
    || typeof snapshot.worldTimeMs !== "number" || !Number.isFinite(snapshot.worldTimeMs)
    || Math.abs(snapshot.worldTimeMs) > 10_000_000_000_000_000
    || typeof snapshot.mobAccumulatorSeconds !== "number" || !Number.isFinite(snapshot.mobAccumulatorSeconds)
    || snapshot.mobAccumulatorSeconds < 0 || snapshot.mobAccumulatorSeconds > 0.3
    || typeof dayNight.cycleLengthMs !== "number" || !Number.isFinite(dayNight.cycleLengthMs)
    || dayNight.cycleLengthMs <= 0 || dayNight.cycleLengthMs > 1_000_000_000_000
    || typeof dayNight.epochMs !== "number" || !Number.isFinite(dayNight.epochMs)
    || Math.abs(dayNight.epochMs) > 10_000_000_000_000_000
    || typeof dayNight.epochPhase !== "number" || !Number.isFinite(dayNight.epochPhase)
    || Math.abs(dayNight.epochPhase) > 1_000_000) return null;
  return {
    version: VOXEL_RUNTIME_SNAPSHOT_VERSION,
    pose,
    respawnPoint,
    playerHealth: snapshot.playerHealth,
    worldTimeMs: snapshot.worldTimeMs,
    dayNight: {
      cycleLengthMs: dayNight.cycleLengthMs,
      epochMs: dayNight.epochMs,
      epochPhase: dayNight.epochPhase,
    },
    mobAccumulatorSeconds: snapshot.mobAccumulatorSeconds,
    mobSimulation,
  };
}

/** Frame-bounded clock step shared by the live engine and pause regression tests. */
export function advanceVoxelWorldTimeMs(worldTimeMs: number, dtSeconds: number, paused: boolean): number {
  if (!Number.isFinite(worldTimeMs) || paused) return worldTimeMs;
  const dt = Number.isFinite(dtSeconds) ? Math.max(0, Math.min(0.05, dtSeconds)) : 0;
  return worldTimeMs + dt * 1_000;
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
  visualActions?: readonly {
    sequence: number;
    kind: MotionVisualActionKind;
    value?: number;
  }[];
}

export interface BlockTarget {
  block: WorldEdit;
  place: { x: number; y: number; z: number };
  distance: number;
}

export type RangedShotTarget =
  | { kind: "player"; id: string; name: string; distance: number }
  | { kind: "mob"; id: string; mobKind: string; distance: number }
  | { kind: "none"; id: ""; distance: number };

export interface RangedShotIntent {
  /** Client-local charge feedback only; Lakebed clamps and validates it. */
  chargeMs: number;
  target: RangedShotTarget;
  /** Visual launch data. Combat authority derives its own ray from presence. */
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
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
  primedTntVertexCount: number;
  primedTntVisibleCount: number;
  primedTntUploadBytes: number;
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
  /** Local pointer-look coefficient, sampled for each event so Options apply immediately. */
  getMouseLookSensitivity?: () => number;
  /** Shared clock configuration. Defaults to an eight-minute alpha cycle. */
  dayNight?: Partial<DayNightConfig>;
  /** Add a measured server-minus-client clock skew to Date.now(). */
  serverTimeOffsetMs?: number;
  /** previousBlock distinguishes mining from placement; settledEdits are one accepted local falling batch. */
  onBlockEdit?: (edit: WorldEdit, previousBlock: BlockId, settledEdits: readonly WorldEdit[]) => void;
  /** Synchronously reserves a complete local edit batch before any terrain or callback side effect. */
  acceptWorldEdits?: (edits: readonly WorldEdit[]) => boolean;
  /** Prevent a second optimistic world edit while an authoritative one is pending. */
  canEditBlock?: () => boolean;
  /** Local preflight for a completed mining edit, such as bounded drop capacity. */
  canMineBlock?: (block: Readonly<WorldEdit>) => boolean;
  /** Seconds the primary action must be held before a block is mined. */
  getMiningDuration?: (block: BlockId) => number;
  /** Combat damage used by either Lakebed authority or the local fallback. */
  getAttackDamage?: () => number;
  /**
   * When configured, attacks are delegated without optimistic local damage or
   * drops. Apply the resulting/query state through `applyMobCombatStates`.
   */
  onMobAttack?: (target: Readonly<MobRayTarget>, damage: number) => void | Promise<void>;
  /** Return true when secondary use handled the targeted mob (for example, shearing a sheep). */
  onMobUse?: (target: Readonly<MobRayTarget>) => boolean;
  /** Event-driven PvP attack request for the nearest rendered remote under the crosshair. */
  onRemotePlayerAttack?: (target: Readonly<RemotePlayerRayTarget>, damage: number) => void | Promise<void>;
  /** True only while the authoritative inventory says the selected stack is a bow. */
  isRangedWeaponSelected?: () => boolean;
  /** Discrete draw feedback; never emits a Lakebed write. */
  onRangedChargeChange?: (charging: boolean, normalizedCharge: number) => void;
  /** Pointer-lock/menu cancellation clears the matching server draw without firing. */
  onRangedCancel?: () => void | Promise<void>;
  /** One release intent. The caller performs the single authoritative mutation. */
  onRangedRelease?: (intent: Readonly<RangedShotIntent>) => void | Promise<void>;
  /** Pointer-lock-gated physical number-key selection for the canonical nine-slot hotbar. */
  onHotbarSelect?: (index: number) => void;
  /** Pointer-lock-gated wheel selection. Positive cycles right; negative cycles left. */
  onHotbarCycle?: (direction: -1 | 1) => void;
  /** Bounded material-aware mining impact, emitted at most about four times per second. */
  onMiningHit?: (target: Readonly<BlockTarget>) => void;
  /** Distance-based grounded step over the block beneath the player. */
  onFootstep?: (block: BlockId) => void;
  /** Current authoritative hunger gate for initiating a local sprint. */
  canSprint?: () => boolean;
  /** Local posture feedback for survival exertion and UI; never adds a network write. */
  onMovementModeChange?: (mode: PlayerMovementMode, activityMultiplier: number) => void;
  /** Discrete first-person swing/use feedback; never emitted from the frame loop. */
  onHandAction?: (action: "mine" | "attack" | "place" | "use") => void;
  getPlayerProtection?: () => number;
  /**
   * Atomically reserves one client-local death reward before the mob dies.
   * Returning false rejects the fatal hit so a bounded drop pool cannot lose
   * items. Used only when `onMobAttack` is absent.
   */
  onMobDrops?: (event: Readonly<LocalMobDeathDropEvent>) => boolean;
  /** One locally confirmed mob-health reduction; delegated Lakebed attacks never emit it. */
  onLocalMobHit?: () => void;
  /** One completed offline fuse after terrain and player damage resolve locally. */
  onLocalCreeperExplosion?: (event: Readonly<{
    mobId: string;
    x: number;
    y: number;
    z: number;
    damage: number;
    edits: readonly LocalExplosionEdit[];
  }>) => void;
  onPlayerDamage?: (amount: number, cause: PlayerDamageCause) => void;
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
  applyWorldEdits(edits: readonly WorldEdit[]): boolean;
  applyMobCombatStates(states: readonly MobCombatStateSnapshot[], serverTimeOffsetMs?: number): void;
  /** Reconciles the retained renderer against Lakebed's shared fixed-tick mob timeline. */
  applyMobMotionSnapshot(poses: readonly MobMotionPose[], serverTimeOffsetMs?: number): void;
  /** Stable deterministic IDs used by the bounded Lakebed authority query. */
  getMobIds(): string[];
  /** Local-only exact sheep clip; inventory acceptance runs before visual state changes. */
  shearMob(mobId: string, acceptWool: (count: number) => boolean): import("./mobs.ts").LocalMobShearResult;
  /** Resolves one already-paid offline arrow hit; never runs when Lakebed delegates combat. */
  damageLocalMobWithRangedShot(mobId: string, damage: number): MobDamageResult;
  setSelectedBlock(block: BlockId): void;
  setRemotePlayers(players: readonly RemotePlayer[]): void;
  /** Replaces the bounded Lakebed-authoritative item snapshot rendered in-world. */
  setDroppedItems(items: readonly DroppedItemRenderItem[]): void;
  /** Replaces the bounded, event-driven player-arrow visual snapshot. */
  setPlayerProjectiles(projectiles: readonly PlayerProjectileVisual[]): void;
  /** Local-only visual feedback; callers should use this after authoritative confirmation. */
  spawnBlockParticles(event: Readonly<BlockParticleEvent>): number;
  /** Marks a still-rendered TNT block as fused so local mining cannot cancel or duplicate it. */
  setPrimedTnt(x: number, y: number, z: number, primed: boolean): boolean;
  /** Reconciles the bounded visible Lakebed fuse snapshot without producing any writes. */
  setPrimedTntFuses(fuses: readonly PrimedTntVisualFuse[], authoritativeNow?: number): number;
  /** Resolves one bounded local-only TNT crater in a single mesh rebuild. */
  explodeTnt(x: number, y: number, z: number): LocalExplosionEdit[];
  /** Settles sand/gravel after one explicit offline edit; never creates network traffic. */
  settleFallingBlocks(edit: Readonly<WorldEdit>, previousBlock: BlockId): WorldEdit[];
  setDayNightClock(config: Partial<DayNightConfig>, serverTimeOffsetMs?: number): void;
  /** Freezes local movement, simulation, combat, fuses, particles, and world time. */
  setPaused(paused: boolean): boolean;
  isPaused(): boolean;
  setRespawnPoint(point: RespawnPoint): void;
  /** Reconciles local prediction to one Lakebed-authoritative health value. */
  setPlayerHealth(health: number): number;
  adjustPlayerHealth(delta: number): number;
  /** Snap to a Lakebed-authoritative pose without changing health or respawn state. */
  reconcilePose(pose: PlayerPose): void;
  getPose(): PlayerPose;
  getRespawnPoint(): PlayerPose;
  getPlayerHealth(): number;
  getWorldTimeMs(): number;
  /** Returns a detached, bounded snapshot safe to pass to the local save codec. */
  exportRuntimeSnapshot(): VoxelRuntimeSnapshot;
  /** Restores only a completely valid snapshot and leaves the engine unchanged on failure. */
  importRuntimeSnapshot(snapshot: unknown): boolean;
  getTarget(): BlockTarget | null;
  /** Read-only local material lookup for discrete offline authority checks. */
  getBlockAt(x: number, y: number, z: number): BlockId;
  getPerformanceStats(): VoxelPerformanceStats;
  requestPointerLock(): void;
  respawn(): void;
}
