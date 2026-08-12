import type { DayNightConfig } from "./dayNight.ts";
import {
  validateMobSimulationSnapshot,
  type MobDamageResult,
  type MobKind,
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
import type { PlayerCameraMode } from "./playerCamera.ts";
import type { PlayerSkinModel } from "./playerSkin.ts";
import type { PlayerArmorAppearance } from "./playerArmorGeometry.ts";

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
  BEDROCK: 33,
} as const;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];

export type BedDirection = "north" | "south" | "east" | "west";

export interface BlockCoordinate {
  x: number;
  y: number;
  z: number;
}

/**
 * Directional metadata for the two ordinary BED cells that make one local bed.
 * The block palette remains append-only: neither half consumes a new block ID.
 */
export interface BedStructure {
  foot: BlockCoordinate;
  head: BlockCoordinate;
  direction: BedDirection;
}

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

type RuntimePoseValidation =
  | { ok: true; pose: PlayerPose }
  | { ok: false; path: string };

export type VoxelRuntimeSnapshotValidation =
  | { ok: true; snapshot: VoxelRuntimeSnapshot }
  | { ok: false; path: string };

function validateRuntimePose(value: unknown, path: string): RuntimePoseValidation {
  const pose = runtimeSnapshotRecord(value);
  if (!pose || !runtimeSnapshotHasKeys(pose, ["x", "y", "z", "yaw", "pitch"])) {
    return { ok: false, path };
  }
  for (const key of ["x", "y", "z", "yaw", "pitch"] as const) {
    if (typeof pose[key] !== "number" || !Number.isFinite(pose[key])) {
      return { ok: false, path: `${path}.${key}` };
    }
  }
  if (Math.abs(pose.x as number) > 1_000_000) return { ok: false, path: `${path}.x` };
  if ((pose.y as number) < 1 || (pose.y as number) > 192) return { ok: false, path: `${path}.y` };
  if (Math.abs(pose.z as number) > 1_000_000) return { ok: false, path: `${path}.z` };
  if (Math.abs(pose.yaw as number) > Math.PI * 4) return { ok: false, path: `${path}.yaw` };
  if (Math.abs(pose.pitch as number) > 1.52) return { ok: false, path: `${path}.pitch` };
  return {
    ok: true,
    pose: {
      x: pose.x as number,
      y: pose.y as number,
      z: pose.z as number,
      yaw: pose.yaw as number,
      pitch: pose.pitch as number,
    },
  };
}

/** Strict all-or-nothing validator for the engine-owned portion of a local save. */
export function validateVoxelRuntimeSnapshotDetailed(value: unknown): VoxelRuntimeSnapshotValidation {
  const snapshot = runtimeSnapshotRecord(value);
  if (!snapshot || !runtimeSnapshotHasKeys(snapshot, [
    "version", "pose", "respawnPoint", "playerHealth", "worldTimeMs", "dayNight",
    "mobAccumulatorSeconds", "mobSimulation",
  ])) return { ok: false, path: "$" };
  if (snapshot.version !== VOXEL_RUNTIME_SNAPSHOT_VERSION) return { ok: false, path: "$.version" };
  const pose = validateRuntimePose(snapshot.pose, "$.pose");
  if (!pose.ok) return pose;
  const respawnPoint = validateRuntimePose(snapshot.respawnPoint, "$.respawnPoint");
  if (!respawnPoint.ok) return respawnPoint;
  const dayNight = runtimeSnapshotRecord(snapshot.dayNight);
  const mobSimulation = validateMobSimulationSnapshot(snapshot.mobSimulation);
  if (!dayNight || !runtimeSnapshotHasKeys(dayNight, ["cycleLengthMs", "epochMs", "epochPhase"])) {
    return { ok: false, path: "$.dayNight" };
  }
  if (!mobSimulation) return { ok: false, path: "$.mobSimulation" };
  if (typeof snapshot.playerHealth !== "number" || !Number.isFinite(snapshot.playerHealth)
    || snapshot.playerHealth < 0 || snapshot.playerHealth > 20) {
    return { ok: false, path: "$.playerHealth" };
  }
  if (typeof snapshot.worldTimeMs !== "number" || !Number.isFinite(snapshot.worldTimeMs)
    || Math.abs(snapshot.worldTimeMs) > 10_000_000_000_000_000) {
    return { ok: false, path: "$.worldTimeMs" };
  }
  if (typeof snapshot.mobAccumulatorSeconds !== "number" || !Number.isFinite(snapshot.mobAccumulatorSeconds)
    || snapshot.mobAccumulatorSeconds < 0 || snapshot.mobAccumulatorSeconds > 0.3) {
    return { ok: false, path: "$.mobAccumulatorSeconds" };
  }
  if (typeof dayNight.cycleLengthMs !== "number" || !Number.isFinite(dayNight.cycleLengthMs)
    || dayNight.cycleLengthMs === 0 || Math.abs(dayNight.cycleLengthMs) > 1_000_000_000_000) {
    return { ok: false, path: "$.dayNight.cycleLengthMs" };
  }
  if (typeof dayNight.epochMs !== "number" || !Number.isFinite(dayNight.epochMs)
    || Math.abs(dayNight.epochMs) > 10_000_000_000_000_000) {
    return { ok: false, path: "$.dayNight.epochMs" };
  }
  if (typeof dayNight.epochPhase !== "number" || !Number.isFinite(dayNight.epochPhase)
    || Math.abs(dayNight.epochPhase) > 1_000_000) {
    return { ok: false, path: "$.dayNight.epochPhase" };
  }
  return {
    ok: true,
    snapshot: {
      version: VOXEL_RUNTIME_SNAPSHOT_VERSION,
      pose: pose.pose,
      respawnPoint: respawnPoint.pose,
      playerHealth: snapshot.playerHealth,
      worldTimeMs: snapshot.worldTimeMs,
      dayNight: {
        cycleLengthMs: dayNight.cycleLengthMs,
        epochMs: dayNight.epochMs,
        epochPhase: dayNight.epochPhase,
      },
      mobAccumulatorSeconds: snapshot.mobAccumulatorSeconds,
      mobSimulation,
    },
  };
}

/** Compatibility wrapper for call sites that only need the detached validated snapshot. */
export function validateVoxelRuntimeSnapshot(value: unknown): VoxelRuntimeSnapshot | null {
  const validated = validateVoxelRuntimeSnapshotDetailed(value);
  return validated.ok ? validated.snapshot : null;
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
  crouching?: boolean;
  armorHead?: ArmorId | null;
  armorChest?: ArmorId | null;
  armorLegs?: ArmorId | null;
  armorFeet?: ArmorId | null;
  skinId?: string;
  skinModel?: PlayerSkinModel;
  skinPixels?: Uint8Array | null;
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
  | { kind: "mob"; id: string; mobKind: MobKind; distance: number }
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
  /** Main-thread simulation/update work measured for the latest rendered frame. */
  lastUpdateMs: number;
  /** Main-thread WebGL submission and dynamic-geometry work for the latest frame. */
  lastRenderMs: number;
  /** Terrain materialization/removal work charged to the latest frame. */
  lastTerrainStreamingMs: number;
  pendingTerrainLoads: number;
  pendingTerrainUnloads: number;
  pendingMeshRebuilds: number;
  /** Mesh generation/upload work charged to the latest rendered frame. */
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
  /** Retained first-person model draws stay bounded at one color batch plus one atlas batch. */
  firstPersonDrawCalls: number;
  firstPersonVertexCount: number;
  firstPersonLastUploadBytes: number;
  firstPersonTotalUploadBytes: number;
  firstPersonMeshUpdates: number;
  firstPersonBufferBytes: number;
  estimatedMeshBytes: number;
}

export interface VoxelEngineOptions {
  /** Local worlds simulate mobs in-process; network worlds receive them from their authority. */
  simulateMobs?: boolean;
  seed?: number;
  worldRadius?: number;
  /** Offline-only bounded horizontal chunk radius; omitted callers retain the 7x7 default. */
  streamingChunkRadius?: number;
  initialEdits?: readonly WorldEdit[];
  /** Validated local-save metadata for paired BED cells; omitted by multiplayer. */
  initialBedStructures?: readonly BedStructure[];
  /** Explicit offline-only opt-in for atomic directional two-cell beds. */
  twoBlockBeds?: boolean;
  initialPose?: Partial<PlayerPose>;
  /** Preserve a Lakebed-persisted reconnect pose exactly instead of lifting it to local safe-spawn height. */
  preserveInitialPose?: boolean;
  selectedBlock?: BlockId;
  /** Selected inventory identity for the retained first-person WebGL model. */
  selectedItem?: ItemId | null;
  reach?: number;
  /** Local pointer-look coefficient, sampled for each event so Options apply immediately. */
  getMouseLookSensitivity?: () => number;
  /** Vertical camera FOV in radians, sampled live so Options apply without recreating the engine. */
  getFieldOfViewRadians?: () => number;
  /** Shared clock configuration. Defaults to Minecraft's twenty-minute cycle. */
  dayNight?: Partial<DayNightConfig>;
  /** Add a measured server-minus-client clock skew to Date.now(). */
  serverTimeOffsetMs?: number;
  /** `edit` is the original semantic action; `journalEdits` are the remaining accepted LWW render/save batch. */
  onBlockEdit?: (edit: WorldEdit, previousBlock: BlockId, journalEdits: readonly WorldEdit[]) => void;
  /** Synchronously reserves a complete local edit batch before any terrain or callback side effect. */
  acceptWorldEdits?: (edits: readonly WorldEdit[]) => boolean;
  /** Prevent a second optimistic world edit while an authoritative one is pending. */
  canEditBlock?: () => boolean;
  /** Local inventory preflight proving the selected stack can pay for one placement. */
  canPlaceSelectedBlock?: (block: BlockId) => boolean;
  /** Explicit offline-only opt-in for bounded held secondary-button block placement. */
  continuousBlockPlacement?: boolean;
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
  /** Offline Creative-only movement gate, sampled every input/frame so mode changes fail closed. */
  canCreativeFly?: () => boolean;
  /** Offline Creative players are omitted from hostile AI acquisition and projectile collision. */
  canMobsTargetPlayer?: () => boolean;
  /** Browser-security fallback allowing movement keys while silent pointer recapture is armed. */
  allowUnlockedKeyboardInput?: () => boolean;
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
  onLocalMobHit?: (kind: MobKind, killed: boolean) => void;
  /** Rate-limited ambient cue for one nearby living mob. */
  onMobIdle?: (kind: MobKind, mobId: string, intensity: number, pan: number) => void;
  /** One completed offline fuse after terrain and player damage resolve locally. */
  onLocalCreeperExplosion?: (event: Readonly<{
    mobId: string;
    x: number;
    y: number;
    z: number;
    damage: number;
    edits: readonly LocalExplosionEdit[];
  }>) => void;
  /** Local preflight for survival damage. False leaves health and armor untouched. */
  canTakePlayerDamage?: () => boolean;
  onPlayerDamage?: (amount: number, cause: PlayerDamageCause) => void;
  onPlayerHealthChange?: (health: number, maximumHealth: number) => void;
  /** Return true when the held non-block item handled secondary use (for example, eating food). */
  onUseSelectedItem?: () => boolean;
  /** Return true after handling a chest or bed interaction to suppress block placement. */
  onInteractBlock?: (target: BlockTarget) => boolean;
  onPoseChange?: (pose: PlayerPose) => void;
  onTargetChange?: (target: BlockTarget | null) => void;
  onPointerLockChange?: (locked: boolean) => void;
  /** Offline-only bounded simulation hook; omitted by Lakebed multiplayer. */
  onSimulationStep?: (elapsedSeconds: number) => void;
  /** Emitted at most twice per second for an optional performance HUD/logger. */
  onPerformanceStats?: (stats: VoxelPerformanceStats) => void;
}

export interface VoxelEngine {
  start(): void;
  destroy(): void;
  /** Captures the next complete WebGL frame without releasing pointer lock. */
  captureScreenshot(): Promise<Blob>;
  applyWorldEdits(edits: readonly WorldEdit[]): boolean;
  applyMobCombatStates(states: readonly MobCombatStateSnapshot[], serverTimeOffsetMs?: number): void;
  /** Reconciles the retained renderer against Lakebed's shared fixed-tick mob timeline. */
  applyMobMotionSnapshot(poses: readonly MobMotionPose[], serverTimeOffsetMs?: number): void;
  /** Stable deterministic IDs used by the bounded Lakebed authority query. */
  getMobIds(): string[];
  /** Local-only exact sheep clip; inventory acceptance runs before visual state changes. */
  shearMob(mobId: string, acceptWool: (count: number) => boolean): import("./mobs.ts").LocalMobShearResult;
  /** Resolves one already-paid offline arrow hit; never runs when Lakebed delegates combat. */
  damageLocalMobWithRangedShot(
    mobId: string,
    damage: number,
    eventId: string,
    sourceX: number,
    sourceZ: number,
  ): MobDamageResult;
  /** Applies a bounded reaction only after an exact player-to-mob hit is confirmed. */
  applyConfirmedPlayerHitMobKnockback(
    eventId: string,
    mobId: string,
    sourceX: number,
    sourceZ: number,
    damage: number,
  ): boolean;
  setSelectedBlock(block: BlockId): void;
  /** Updates the retained first-person arm/item model without touching world interaction state. */
  setSelectedItem(itemId: ItemId | null): void;
  /** Applies one browser-local standard skin to both first- and third-person rigs. */
  setPlayerSkin(source: TexImageSource | null, model: PlayerSkinModel): void;
  /** Updates the local third-person armor shells from canonical equipped slot IDs. */
  setPlayerArmor(appearance: PlayerArmorAppearance): void;
  /** Cycles first person, third person behind, then third person facing the player. */
  cycleCameraMode(): PlayerCameraMode;
  /** Selects an exact camera mode for development pose inspection. */
  setCameraMode(mode: PlayerCameraMode): void;
  getCameraMode(): PlayerCameraMode;
  /** Removes the viewmodel for blocking UI, death, screenshots, or other cinematic surfaces. */
  setFirstPersonFeedbackHidden(hidden: boolean): void;
  /** Paused Pose Lab visual override only; null restores ordinary gameplay charge rendering. */
  setPoseLabDrawPreview(drawn: boolean | null): void;
  /** Paused Pose Lab action override only; null restores ordinary gameplay animation. */
  setPoseLabActionPreview(kind: "use" | null, progress?: number): void;
  /** Paused Pose Lab rig override only; live restores ordinary gameplay motion. */
  setPoseLabRigPreview(kind: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10): void;
  /** Development benchmark hook; absent from compact production builds. */
  setBenchmarkLook?(yaw: number, pitch: number): void;
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
  /** Toggles only sky-clock advancement; simulation time and gameplay continue. */
  setDaylightCycle(enabled: boolean): boolean;
  /** Reconciles the offline terrain window immediately and returns the bounded radius. */
  setRenderDistance(radius: number): number;
  /** Freezes local movement, simulation, combat, fuses, particles, and world time. */
  setPaused(paused: boolean): boolean;
  isPaused(): boolean;
  /** Cancels an active bow draw without firing or spending inventory. */
  cancelRangedActionForEscape(): boolean;
  setRespawnPoint(point: RespawnPoint): void;
  /** Reconciles local prediction to one Lakebed-authoritative health value. */
  setPlayerHealth(health: number): number;
  adjustPlayerHealth(delta: number): number;
  /** Applies motion only for one already-confirmed mob damage event; exact retries are ignored. */
  applyConfirmedMobKnockback(eventId: string, attackerX: number, attackerZ: number, damage: number, eventTimeMs?: number): boolean;
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
  /** Bounded local scan used only by the creative cave-testing command. */
  findNearestCave(): readonly [x: number, y: number, z: number] | null;
  /** Returns a detached directional structure when this cell belongs to a paired local bed. */
  getBedAt(x: number, y: number, z: number): BedStructure | null;
  /** Stable detached metadata written beside ordinary BED edits in the local save journal. */
  exportBedStructures(): BedStructure[];
  getPerformanceStats(): VoxelPerformanceStats;
  /** Resolves after the browser either grants or rejects canvas pointer capture. */
  requestPointerLock(): Promise<boolean>;
  respawn(): void;
}
