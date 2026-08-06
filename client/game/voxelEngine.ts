import {
  TERRAIN_MIN_Y,
  blockKey,
  createTerrainChunk,
  raycastVoxels,
  terrainHeight,
} from "./terrain.ts";
import {
  DEFAULT_STREAMING_CHUNK_RADIUS,
  MAX_LOCAL_STREAMING_CHUNK_RADIUS,
  WORLD_CHUNK_SIZE,
  chunkKey,
  chunkKeyForBlock,
  dirtyChunkKeysForEdits,
  parseChunkKey,
  planChunkWindow,
} from "./chunks.ts";
import {
  MAX_REMOTE_PLAYERS,
  applyRemoteAvatarSnapshot,
  createRemoteAvatarMotion,
  type RemoteAvatarMotion,
} from "./avatar.ts";
import { createRemotePlayerRenderer } from "./remotePlayerRenderer.ts";
import { raycastRemotePlayers } from "./remotePlayerTargeting.ts";
import { createDroppedItemRenderer } from "./droppedItemRenderer.ts";
import { createPlayerProjectileRenderer, type PlayerProjectileVisual } from "./playerProjectileRenderer.ts";
import { createFirstPersonRenderer, usesCanonicalHeldBlock } from "./firstPersonRenderer.ts";
import {
  createFirstPersonSkinRenderer,
  FIRST_PERSON_SKIN_ARM_BUFFER_BYTES,
  FIRST_PERSON_SKIN_ARM_VERTICES,
} from "./firstPersonSkinRenderer.ts";
import { nextPlayerCameraMode, writePlayerCamera, type PlayerCameraMode } from "./playerCamera.ts";
import { createPlayerSkinRenderer } from "./playerSkinRenderer.ts";
import { playerRigInputForMovement } from "./playerRig.ts";
import { BLOCK_MATERIAL_COLORS as BLOCK_COLORS } from "./blockColors.ts";
import {
  blockParticleBufferCapacity,
  createBlockParticleSystem,
  type BlockParticleGeometryStats,
} from "./blockParticles.ts";
import {
  DEFAULT_DAY_NIGHT_CONFIG,
  createDayNightState,
  sampleDayNight,
  type DayNightConfig,
} from "./dayNight.ts";
import {
  ATMOSPHERE_FRAGMENT_SHADER,
  ATMOSPHERE_SCREEN_TRIANGLE,
  ATMOSPHERE_VERTEX_SHADER,
  writeCelestialDirection,
} from "./atmosphere.ts";
import { createMobRenderer } from "./mobRenderer.ts";
import {
  TEXTURED_WORLD_VERTEX_FLOATS,
  blockTextureForFace,
  textureAtlasUv,
  type BlockFace,
} from "./blockTextures.ts";
import { CUBE_FACES as FACE_DEFS } from "./cubeFaces.ts";
import {
  appendSpecialBedMesh,
  appendSpecialChestMesh,
  appendSpecialDoorMesh,
  appendSpecialLadderMesh,
  appendSpecialTorchMesh,
} from "./specialBlockGeometry.ts";
import { writeMatrixProduct } from "./matrixProduct.ts";
export { writeMatrixProduct };
import {
  STONE_BRICK_SLAB_HEIGHT,
  blockCollisionHeight,
  blockContainsSolidPoint,
  blockSupportsPlayerFeet,
  playerIntersectsBlockCollisionHeight,
} from "./blockGeometry.ts";
import {
  bedCellKey,
  bedBreakEdits,
  bedStructureKey,
  createBedStructure,
  planBedPlacement,
  reconcileBedEditBatch,
} from "./localBeds.ts";
import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_ATLAS_ROWS,
  TEXTURE_TILE_SIZE,
} from "./generated/textureAtlas.ts";
import {
  consumeMobContactDamage,
  consumeDueLocalCreeperExplosions,
  consumeMobProjectileDamage,
  applyAuthoritativeMobCombatStates,
  createMobSimulation,
  createMobSpawns,
  damageMob,
  exportMobSimulationSnapshot,
  listMobIds,
  isLocalMobSpawnOutsideView,
  mobTargetHasClickPriority,
  raycastMobs,
  reconcileLocalMobStreaming,
  refreshLocalHostileHabitats,
  respawnExpiredAuthoritativeMobs,
  restoreMobSimulationSnapshot,
  shearLocalMob,
  stepMobSimulation,
  writeMobPoseSnapshots,
  writeMobProjectileSnapshots,
  LOCAL_MOB_HOSTILE_SPAWN_LIGHT_MAX,
  MOB_DEFINITIONS,
  type MobPoseSnapshot,
  type MobProjectileSnapshot,
  type MobSpawnOptions,
  type LocalCreeperExplosionEvent,
  type MobDamageSource,
} from "./mobs.ts";
import {
  MAX_ACTIVE_MOB_KNOCKBACK_REACTIONS,
  MAX_MOB_KNOCKBACK_RECEIPTS,
  applyMobKnockbackImpulse,
  beginMobKnockbackStep,
  createMobKnockbackReaction,
  decideMobKnockback,
  mobKnockbackReactionSettled,
  resolveMobKnockback,
  stepMobKnockbackAxis,
  type MobKnockbackReaction,
} from "./mobKnockback.ts";
import {
  PLAYER_KNOCKBACK_COOLDOWN_MS,
  decidePlayerKnockback,
  resolvePlayerKnockback,
  stepPlayerKnockbackAxis,
} from "./playerKnockback.ts";
import {
  BLOCK,
  type BedDirection,
  type BedStructure,
  type BlockId,
  type BlockTarget,
  type LocalExplosionEdit,
  type PlayerPose,
  type PrimedTntVisualFuse,
  type RangedShotIntent,
  type RespawnPoint,
  type VoxelEngine,
  type VoxelEngineOptions,
  type VoxelPerformanceStats,
  type WorldEdit,
  advanceVoxelWorldTimeMs,
  validateVoxelRuntimeSnapshot,
  VOXEL_RUNTIME_SNAPSHOT_VERSION,
} from "./types.ts";
import type { MobMotionPose } from "../../shared/mobMotionAuthority.ts";
import {
  CREEPER_EXPLOSION_RADIUS,
  enumerateCreeperExplosionBlocks,
  resolveCreeperExplosionDamage,
  resolveLocalTntExplosionDamage,
  sampleCreeperExplosionExposure,
} from "../../shared/creeperExplosion.ts";
import { resolveFallingBlocks, type FallingBlockCellBlock } from "../../shared/fallingBlocks.ts";
import { fallDamageForDistance } from "../../shared/fallDamageAuthority.ts";
import { PLAYER_ATTACK_COOLDOWN_MS, mitigatedPlayerDamage } from "../../shared/playerCombat.ts";
import type { BlockType } from "../../shared/protocol.ts";
import { ITEMS } from "../../shared/game.ts";
import { WORLD_EDIT_MAX_Y, WORLD_EDIT_MIN_Y } from "../../shared/worldChunks.ts";
import { appendWorldBlockCrackLines } from "./blockCracks.ts";
import { hotbarIndexForDigitCode, hotbarWheelDirection } from "./hotbarInput.ts";
import {
  STANDING_BODY_HEIGHT,
  STANDING_EYE_HEIGHT,
  clampSneakAxisMovement,
  postureTargetsForMovement,
  resolveCreativeFlightMovement,
  resolvePlayerMovement,
  resolveSneakIntent,
  RELEASED_SPRINT_CONTROLS,
  advanceHeadBob,
  createHeadBobState,
  createCreativeFlightTapState,
  creativeFlightVerticalVelocity,
  movementFovRadians,
  resetHeadBob,
  sprintControlHeld,
  smoothMovementValue,
  smoothPlayerPosture,
  updateSprintControl,
  transitionCreativeFlightTap,
  writeHorizontalMovementDelta,
  writePlayerEye,
  type HeadBobOffsets,
  type PlayerMovementMode,
  type PlayerPostureTargets,
  type SprintControlCode,
  type SprintControlState,
} from "./playerMovement.ts";
import {
  IDLE_PRIMARY_ACTION_HOLD,
  pressPrimaryAction,
  releasePrimaryAction,
  shouldStartHeldMining,
  type PrimaryActionHoldState,
} from "./continuousMining.ts";
import {
  IDLE_SECONDARY_PLACEMENT_HOLD,
  advanceSecondaryPlacement,
  pressSecondaryPlacement,
  releaseSecondaryPlacement,
  shouldRepeatSecondaryPlacement,
  type SecondaryPlacementHoldState,
} from "./continuousPlacement.ts";
import {
  CAVE_LIGHT_FLOOR,
  SKY_EXPOSURE_LEVELS,
  SKY_SHADE_EMISSIVE_MARKER,
  SKY_SHADE_PACK_MARKER,
  blockStopsSky,
  packSkyExposureShade,
  refreshEditedSkyColumns,
  removeChunkSkyOccluders,
  skyColumnKey,
  skyOccluderClass,
  skyExposureDirtyChunkKeysForEdits,
  skyEcologyExposureLevel,
  skyExposureLevel,
  writeChunkSkyOccluders,
  type SkyOccluderColumns,
} from "./skyExposure.ts";

type Vec3 = [number, number, number];

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export const PLAYER_MAX_HEALTH = 20;
export const MOUSE_LOOK_SENSITIVITY = 0.0022;
export const MAX_LOOK_PITCH = 1.52;
export const STREAMING_MESH_REBUILDS_PER_FRAME = 1;
export const LOCAL_MOB_STREAM_SPAWN_RADIUS = DEFAULT_STREAMING_CHUNK_RADIUS * WORLD_CHUNK_SIZE - 2;
export const LOCAL_MOB_STREAM_CLEAR_RADIUS = LOCAL_MOB_STREAM_SPAWN_RADIUS - 2;
export const LOCAL_MOB_STREAM_RETAIN_RADIUS = DEFAULT_STREAMING_CHUNK_RADIUS * WORLD_CHUNK_SIZE + WORLD_CHUNK_SIZE / 2;
export const PLAYER_RANGED_REACH = 32;
export const PLAYER_BOW_FULL_CHARGE_MS = 1_000;
export const TARGET_OUTLINE_VERTEX_COUNT = 24;
export const PAUSED_RENDER_INTERVAL_MS = 100;

interface PointerLockRequestDocument {
  readonly pointerLockElement: unknown;
  addEventListener(type: "pointerlockchange" | "pointerlockerror", listener: () => void): void;
  removeEventListener(type: "pointerlockchange" | "pointerlockerror", listener: () => void): void;
}

interface PointerLockRequestWindow {
  setTimeout(callback: () => void, timeoutMs: number): number;
  clearTimeout(timer: number): void;
}

interface PointerLockRequestTarget {
  requestPointerLock(): void | PromiseLike<void>;
}

/** A stale unlock change cannot reject a newer trusted pointer-lock request. */
export function requestPointerLockForTarget(
  target: PointerLockRequestTarget,
  pointerDocument: PointerLockRequestDocument,
  pointerWindow: PointerLockRequestWindow,
  timeoutMs = 250,
  acceptLock = () => true,
  releaseLock = () => undefined,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let fallbackTimer = 0;
    const finish = (locked: boolean) => {
      if (settled) return;
      settled = true;
      pointerDocument.removeEventListener("pointerlockchange", onPointerLockSettled);
      pointerDocument.removeEventListener("pointerlockerror", onPointerLockError);
      pointerWindow.clearTimeout(fallbackTimer);
      resolve(locked);
    };
    const onPointerLockSettled = () => {
      if (pointerDocument.pointerLockElement !== target) return;
      if (acceptLock()) finish(true);
      else {
        releaseLock();
        finish(false);
      }
    };
    const onPointerLockError = () => finish(false);
    pointerDocument.addEventListener("pointerlockchange", onPointerLockSettled);
    pointerDocument.addEventListener("pointerlockerror", onPointerLockError);
    fallbackTimer = pointerWindow.setTimeout(
      () => {
        if (pointerDocument.pointerLockElement === target) onPointerLockSettled();
        else finish(false);
      },
      timeoutMs,
    );
    try {
      const request = target.requestPointerLock();
      onPointerLockSettled();
      void Promise.resolve(request).then(onPointerLockSettled, onPointerLockError);
    } catch {
      finish(false);
    }
  });
}

const TARGET_OUTLINE_CORNERS = [
  0, 1, 1, 3, 3, 2, 2, 0,
  4, 5, 5, 7, 7, 6, 6, 4,
  0, 4, 1, 5, 3, 7, 2, 6,
] as const;

/** Writes the fixed 12-edge aimed-block outline without allocating temporary arrays. */
export function writeTargetOutlineGeometry(
  output: Float32Array,
  target: Readonly<BlockTarget>,
): number {
  if (output.length < TARGET_OUTLINE_VERTEX_COUNT * 6) return 0;
  const e = 0.003;
  const height = blockCollisionHeight(target.block.block);
  let offset = 0;
  for (const corner of TARGET_OUTLINE_CORNERS) {
    output[offset++] = target.block.x + ((corner & 1) ? 1 + e : -e);
    output[offset++] = target.block.y + ((corner & 2) ? height + e : -e);
    output[offset++] = target.block.z + ((corner & 4) ? 1 + e : -e);
    output[offset++] = 1;
    output[offset++] = 1;
    output[offset++] = 1;
  }
  return TARGET_OUTLINE_VERTEX_COUNT;
}

/** Minecraft lets crouch-placeable input skip the aimed block's normal use action. */
export function bypassBlockInteractionForPlacement(sneaking: boolean, selectedBlock: BlockId): boolean {
  return sneaking && selectedBlock !== BLOCK.AIR;
}

const LOCAL_EXPLOSION_PROTECTED_BLOCKS = new Set<BlockId>([
  BLOCK.AIR,
  BLOCK.CHEST,
  BLOCK.FURNACE,
  BLOCK.DOOR_CLOSED,
  BLOCK.DOOR_OPEN,
]);

export const LOCAL_TNT_TERRAIN_RADIUS = 4.5;
export const LOCAL_TNT_TERRAIN_MAX_BLOCKS = 192;
const LOCAL_TNT_DOWNWARD_RADIUS = 3.5;
const LOCAL_TNT_UPWARD_RADIUS = 2.5;
const LOCAL_TNT_DESTRUCTION_THRESHOLDS = [
  0.96, 0.96, 0.96, 0.78, 0.9, 0.96, 0.9, 0.9, 0.96, 0.96, 0.96,
  0.96, 0.96, 0.78, 0.78, 0.96, 0.96, 0.78, 0.96, 0.96, 0.78, 0.78,
  0.96, 0.96, 0.96, 0.96, 0.78, 0.9, 0.9, 0.9, 0.78, 0.96, 0.68,
] as const;

/** Higher values let a material be destroyed farther toward the edge of a blast. */
export function localTntDestructionThreshold(block: BlockId): number {
  return LOCAL_TNT_DESTRUCTION_THRESHOLDS[block];
}

/** Pure, bounded local crater plan shared by the engine and focused tests. */
export function planLocalTntExplosion(
  x: number,
  y: number,
  z: number,
  readBlock: (x: number, y: number, z: number) => BlockId,
): LocalExplosionEdit[] {
  if (![x, y, z].every(Number.isSafeInteger)) return [];
  const candidates: Array<readonly [number, LocalExplosionEdit]> = [];
  const horizontalRadius = Math.ceil(LOCAL_TNT_TERRAIN_RADIUS);
  for (let blockY = y - Math.ceil(LOCAL_TNT_DOWNWARD_RADIUS); blockY <= y + Math.ceil(LOCAL_TNT_UPWARD_RADIUS); blockY += 1) {
    if (blockY < WORLD_EDIT_MIN_Y || blockY > WORLD_EDIT_MAX_Y) continue;
    for (let blockZ = z - horizontalRadius; blockZ <= z + horizontalRadius; blockZ += 1) {
      for (let blockX = x - horizontalRadius; blockX <= x + horizontalRadius; blockX += 1) {
        const dx = blockX - x;
        const dy = blockY - y;
        const dz = blockZ - z;
        const verticalRadius = dy < 0 ? LOCAL_TNT_DOWNWARD_RADIUS : LOCAL_TNT_UPWARD_RADIUS;
        const blastDistance = (dx * dx + dz * dz) / (LOCAL_TNT_TERRAIN_RADIUS ** 2)
          + dy * dy / (verticalRadius ** 2);
        if (blastDistance > 1) continue;
        const previousBlock = readBlock(blockX, blockY, blockZ);
        if (LOCAL_EXPLOSION_PROTECTED_BLOCKS.has(previousBlock)) continue;
        if (previousBlock !== BLOCK.TNT && blastDistance > localTntDestructionThreshold(previousBlock)) continue;
        if (previousBlock === BLOCK.TNT && (blockX !== x || blockY !== y || blockZ !== z)) {
          candidates.push([blastDistance, { x: blockX, y: blockY, z: blockZ, block: BLOCK.TNT, previousBlock, chainPrimed: true }]);
          continue;
        }
        candidates.push([blastDistance, { x: blockX, y: blockY, z: blockZ, block: BLOCK.AIR, previousBlock }]);
      }
    }
  }
  candidates.sort((left, right) => Number(Boolean(right[1].chainPrimed)) - Number(Boolean(left[1].chainPrimed))
    || left[0] - right[0]
    || left[1].y - right[1].y || left[1].x - right[1].x || left[1].z - right[1].z);
  return candidates.slice(0, LOCAL_TNT_TERRAIN_MAX_BLOCKS).map(([, cell]) => cell);
}

/** Local creepers retain their smaller shared three-block/64-cell terrain envelope. */
export function planLocalCreeperExplosion(
  x: number,
  y: number,
  z: number,
  readBlock: (x: number, y: number, z: number) => BlockId,
): LocalExplosionEdit[] {
  if (![x, y, z].every(Number.isSafeInteger)) return [];
  const edits: LocalExplosionEdit[] = [];
  for (const cell of enumerateCreeperExplosionBlocks({
    center: { x: x + 0.5, y, z: z + 0.5 },
    radius: CREEPER_EXPLOSION_RADIUS,
  })) {
    const previousBlock = readBlock(cell.x, cell.y, cell.z);
    if (LOCAL_EXPLOSION_PROTECTED_BLOCKS.has(previousBlock)) continue;
    edits.push(previousBlock === BLOCK.TNT
      ? { x: cell.x, y: cell.y, z: cell.z, block: BLOCK.TNT, previousBlock, chainPrimed: true }
      : { x: cell.x, y: cell.y, z: cell.z, block: BLOCK.AIR, previousBlock });
  }
  return edits;
}

function fallingProtocolBlock(block: BlockId): FallingBlockCellBlock {
  if (block === BLOCK.AIR) return "air";
  if (block === BLOCK.SAND) return "sand";
  if (block === BLOCK.GRAVEL) return "gravel";
  return "stone";
}

/** Pure offline adapter over the shared authority model. `readBlock` is post-trigger state. */
export function planLocalFallingBlockSettlement(
  edit: Readonly<WorldEdit>,
  previousBlock: BlockId,
  readBlock: (x: number, y: number, z: number) => BlockId,
): WorldEdit[] {
  if (![edit.x, edit.y, edit.z].every(Number.isSafeInteger)) return [];
  const minimumY = Math.max(WORLD_EDIT_MIN_Y, edit.y - 22);
  const maximumY = Math.min(WORLD_EDIT_MAX_Y, edit.y + 9);
  const resolution = resolveFallingBlocks({
    trigger: {
      x: edit.x, y: edit.y, z: edit.z,
      coordKey: `${edit.x}:${edit.y}:${edit.z}`,
      previousBlock: fallingProtocolBlock(previousBlock),
      nextBlock: fallingProtocolBlock(edit.block),
    },
    authoritativeCells: Array.from({ length: maximumY - minimumY + 1 }, (_, index) => {
      const y = minimumY + index;
      return {
        x: edit.x, y, z: edit.z, coordKey: `${edit.x}:${y}:${edit.z}`,
        block: fallingProtocolBlock(readBlock(edit.x, y, edit.z)),
        blockInstanceToken: null,
      };
    }),
  });
  if (!resolution.ok || resolution.moves.length === 0) return [];
  return Object.entries(resolution.finalBlocks).map(([coordKey, block]) => {
    const [x, y, z] = coordKey.split(":").map(Number);
    return { x, y, z, block: block === "air" ? BLOCK.AIR : block === "sand" ? BLOCK.SAND : BLOCK.GRAVEL };
  });
}

/**
 * Reconstructs one deterministic terrain chunk and reapplies every remembered
 * sparse edit owned by it. Keeping this operation pure makes unload/reload
 * behavior testable without a browser or WebGL context.
 */
export function materializeTerrainChunk(
  seed: number,
  chunkX: number,
  chunkZ: number,
  edits: Iterable<WorldEdit> = [],
): Map<string, BlockId> {
  const owner = chunkKey(chunkX, chunkZ);
  const materialized = createTerrainChunk(seed, chunkX, chunkZ);
  for (const edit of edits) {
    if (chunkKeyForBlock(edit.x, edit.z) !== owner) continue;
    const key = blockKey(edit.x, edit.y, edit.z);
    if (edit.block === BLOCK.AIR) materialized.delete(key);
    else materialized.set(key, edit.block);
  }
  return materialized;
}

/**
 * Converts pointer-lock movement into the engine's look convention. Positive
 * yaw faces right from the default -Z heading; positive pitch faces upward.
 */
export function applyMouseLookDelta(
  yaw: number,
  pitch: number,
  movementX: number,
  movementY: number,
  sensitivity = MOUSE_LOOK_SENSITIVITY,
): { yaw: number; pitch: number } {
  const scale = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : MOUSE_LOOK_SENSITIVITY;
  const nextYaw = yaw + movementX * scale;
  return {
    // Yaw is periodic. Keeping it canonical prevents ordinary accumulated
    // mouse movement from eventually exceeding the strict save boundary.
    yaw: nextYaw >= -Math.PI && nextYaw < Math.PI
      ? nextYaw
      : ((nextYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI,
    pitch: Math.max(
      -MAX_LOOK_PITCH,
      Math.min(MAX_LOOK_PITCH, pitch - movementY * scale),
    ),
  };
}

/** Lift a resumed player out of regenerated terrain or a newly placed block. */
export function resolveSafeSpawnY(
  preferredY: number,
  surfaceY: number,
  collidesAt: (y: number) => boolean,
  maximumRise = 64,
): number {
  const preferred = Number.isFinite(preferredY) ? preferredY : surfaceY;
  const firstCandidate = Math.max(preferred, surfaceY);
  if (!collidesAt(firstCandidate)) return firstCandidate;
  for (let rise = 0; rise <= Math.max(1, Math.floor(maximumRise)); rise += 0.5) {
    const candidate = firstCandidate + rise;
    if (!collidesAt(candidate)) return candidate;
  }
  return surfaceY;
}

interface ChunkMesh {
  key: string;
  textureBuffer: WebGLBuffer | null;
  textureVertexCount: number;
  transparentBuffer: WebGLBuffer | null;
  transparentVertexCount: number;
  colorBuffer: WebGLBuffer | null;
  colorVertexCount: number;
  vertexCount: number;
  centerX: number;
  centerZ: number;
  transparentDistanceSquared: number;
  minY: number;
  maxY: number;
}

export function compareTransparentChunkMeshes(
  left: Readonly<{ key: string; transparentDistanceSquared: number }>,
  right: Readonly<{ key: string; transparentDistanceSquared: number }>,
): number {
  return right.transparentDistanceSquared - left.transparentDistanceSquared || left.key.localeCompare(right.key);
}

export interface TorchLightPosition {
  x: number;
  y: number;
  z: number;
}

interface RankedTorchLight extends TorchLightPosition {
  distanceSquared: number;
}

export const MAX_ACTIVE_TORCH_LIGHTS = 8;
export const TORCH_LIGHT_RADIUS = 11;
export const TORCH_MESH_VERTEX_COUNT = 72;
export const CHEST_MESH_VERTEX_COUNT = 108;
export const DOOR_MESH_VERTEX_COUNT = 144;
export const BED_MESH_VERTEX_COUNT = 108;
export const BED_FOOT_MESH_VERTEX_COUNT = 108;
export const BED_HEAD_MESH_VERTEX_COUNT = 0;
export const LADDER_MESH_VERTEX_COUNT = 252;
/** The 7x7 streaming window bounds glass to one extra draw per visible chunk. */
export const MAX_TRANSPARENT_CHUNK_DRAWS = (MAX_LOCAL_STREAMING_CHUNK_RADIUS * 2 + 1) ** 2;
export const MAX_RESPAWN_HEIGHT = 128;
export const PLAYER_GRAVITY = 22;
export const PLAYER_TERMINAL_VELOCITY = -18;
export const PLAYER_JUMP_SPEED = 8.25;
const LOCAL_FALL_LANDING_EPSILON = 0.05;
export const LADDER_CLIMB_SPEED = 3.2;
export const LADDER_DESCEND_SPEED = -3.2;
export const LADDER_IDLE_SLIDE_SPEED = -1.2;

export type MobTorchLightCache = Float64Array;

/** Fixed storage; samples allocate only when a torch edit rebuilds its spatial column. */
export function createMobTorchLightCache(capacity = 64): MobTorchLightCache {
  const size = Math.max(1, Math.floor(capacity));
  const cache = new Float64Array(size * 5);
  for (let index = 3; index < cache.length; index += 5) cache[index] = -1;
  return cache;
}

/** Coordinate-local CPU light query used only at spawn/fixed mob-AI cadence. */
export function sampleCachedMobLocalLight(
  skyExposure: number,
  sunIntensity: number,
  torchColumns: ReadonlyMap<string, readonly number[]>,
  torchRevision: number,
  cache: MobTorchLightCache,
  x: number,
  y: number,
  z: number,
): number {
  const blockX = Math.floor(x);
  const blockY = Math.floor(y);
  const blockZ = Math.floor(z);
  const slot = (((blockX * 73856093 ^ blockY * 19349663 ^ blockZ * 83492791) >>> 0)
    % (cache.length / 5)) * 5;
  let torchLight = cache[slot + 4];
  if (cache[slot + 3] !== torchRevision || cache[slot] !== blockX
    || cache[slot + 1] !== blockY || cache[slot + 2] !== blockZ) {
    torchLight = 0;
    const reach = Math.ceil(TORCH_LIGHT_RADIUS);
    for (let columnX = blockX - reach; columnX <= blockX + reach; columnX += 1) {
      for (let columnZ = blockZ - reach; columnZ <= blockZ + reach; columnZ += 1) {
        const heights = torchColumns.get(skyColumnKey(columnX, columnZ));
        if (!heights) continue;
        for (let index = 0; index < heights.length; index += 1) {
          const dx = columnX - blockX;
          const dy = heights[index] - blockY - 0.5;
          const dz = columnZ - blockZ;
          const distanceSquared = dx * dx + dy * dy + dz * dz;
          if (distanceSquared >= TORCH_LIGHT_RADIUS * TORCH_LIGHT_RADIUS) continue;
          torchLight = Math.max(torchLight, 1 - Math.sqrt(distanceSquared) / TORCH_LIGHT_RADIUS);
        }
      }
    }
    cache[slot] = blockX;
    cache[slot + 1] = blockY;
    cache[slot + 2] = blockZ;
    cache[slot + 3] = torchRevision;
    cache[slot + 4] = torchLight;
  }
  return Math.max(
    clampNumber(skyExposure, 0, SKY_EXPOSURE_LEVELS) / SKY_EXPOSURE_LEVELS * clampNumber(sunIntensity, 0, 1),
    torchLight,
  );
}

export function shouldRefreshLocalHostileHabitat(
  currentLight: number,
  mobDistance: number,
  replacementDistance: number,
): boolean {
  return currentLight >= LOCAL_MOB_HOSTILE_SPAWN_LIGHT_MAX
    || replacementDistance + 4 < mobDistance;
}

/** Pose Lab may replace the visual bow stage only while gameplay is frozen. */
export function resolvePoseLabDrawPreview(
  paused: boolean,
  bowSelected: boolean,
  previewDrawn: boolean | null,
): boolean | null {
  return paused && bowSelected ? previewDrawn : null;
}

/**
 * Keeps the terrain fade just inside the nearest loaded chunk edge. The fade
 * widens gradually at larger radii so distant terrain blends into the sky
 * without spending most of a small render distance inside fog.
 */
export function writeRenderDistanceFogRange(
  output: Float32Array,
  chunkRadius: number,
): Float32Array {
  const radius = clampNumber(
    Number.isFinite(chunkRadius) ? Math.floor(chunkRadius) : DEFAULT_STREAMING_CHUNK_RADIUS,
    1,
    MAX_LOCAL_STREAMING_CHUNK_RADIUS,
  );
  const end = radius * WORLD_CHUNK_SIZE - 2;
  const fadeWidth = Math.max(WORLD_CHUNK_SIZE, Math.min(WORLD_CHUNK_SIZE * 2, end * 0.2));
  output[0] = Math.max(2, end - fadeWidth);
  output[1] = end;
  return output;
}

// The color and terrain programs intentionally share this source fragment at
// runtime. Keeping one compact copy preserves the readable CPU-side lighting
// mirrors while avoiding two near-identical GLSL payloads in the client bundle.
const LIGHTING_VERTEX_SHADER = `uniform vec3 uCamera,uAmbientColor,uDirectionalColor;uniform vec2 uFogRange;uniform float uFogEnabled,uAmbientIntensity,uDirectionalIntensity,uSkyExposure;uniform vec4 uTorchLights[8];vec3 lightAt(vec3 p,float e){float v=e*uSkyExposure;v=v*(1.5-.5*v);vec3 l=mix(vec3(${CAVE_LIGHT_FLOOR.toFixed(3)}),vec3(.16)+uAmbientColor*uAmbientIntensity*.75+uDirectionalColor*uDirectionalIntensity*.3,v),t=vec3(0.);for(int i=0;i<8;i++){vec4 q=uTorchLights[i];float a=step(.001,q.w)*clamp(1.-length(q.xyz-p)/max(q.w,.001),0.,1.);t+=vec3(1.,.43,.12)*a*a*.95;}return l+t;}float fogAt(vec3 p){return uFogEnabled*smoothstep(uFogRange.x,uFogRange.y,length(p-uCamera));}`;

export const VERTEX_SHADER = `attribute vec3 aPosition,aColor;uniform mat4 uMvp;uniform float uLightingEnabled;varying vec3 vColor;varying float vFog;${LIGHTING_VERTEX_SHADER}void main(){gl_Position=uMvp*vec4(aPosition,1.);float p=step(${(SKY_SHADE_PACK_MARKER - 0.5).toFixed(1)},aColor.r),r=aColor.r-p*${SKY_SHADE_PACK_MARKER.toFixed(1)};vec3 c=vec3(mix(aColor.r,mod(r,2.),p),aColor.g,aColor.b);float e=mix(1.,floor(r/2.)/${SKY_EXPOSURE_LEVELS.toFixed(1)},p);vColor=c*mix(vec3(1.),lightAt(aPosition,e),uLightingEnabled);vFog=fogAt(aPosition);}`;

export const FRAGMENT_SHADER = `precision mediump float;uniform vec3 uFogColor;varying vec3 vColor;varying float vFog;void main(){gl_FragColor=vec4(mix(vColor,uFogColor,vFog),1.);}`;

export const TERRAIN_VERTEX_SHADER = `attribute vec3 aPosition;attribute vec2 aUv;attribute float aShade;uniform mat4 uMvp;varying vec2 vUv;varying vec3 vLight;varying float vFog;${LIGHTING_VERTEX_SHADER}void main(){gl_Position=uMvp*vec4(aPosition,1.);float p=step(${(SKY_SHADE_PACK_MARKER - 0.5).toFixed(1)},aShade),m=step(${(SKY_SHADE_PACK_MARKER + SKY_SHADE_EMISSIVE_MARKER - 0.5).toFixed(1)},aShade),s=aShade-p*${SKY_SHADE_PACK_MARKER.toFixed(1)}-m*${SKY_SHADE_EMISSIVE_MARKER.toFixed(1)},f=mix(aShade,mod(s,2.),p),e=mix(1.,floor(s/2.)/${SKY_EXPOSURE_LEVELS.toFixed(1)},p);vUv=aUv;vLight=(lightAt(aPosition,e)+vec3(.22,.07,.015)*m)*f;vFog=fogAt(aPosition);}`;

export const TERRAIN_FRAGMENT_SHADER = `precision mediump float;uniform sampler2D uAtlas;uniform vec3 uFogColor;uniform float uAlphaCutoff;varying vec2 vUv;varying vec3 vLight;varying float vFog;void main(){vec4 texel=texture2D(uAtlas,vUv);if (texel.a < uAlphaCutoff) discard;gl_FragColor=vec4(mix(texel.rgb*vLight,uFogColor,vFog),texel.a);}`;

/** Stable material palette entry used by the dependency-free voxel renderer. */
export function blockMaterialColor(block: BlockId): readonly [number, number, number] {
  return BLOCK_COLORS[block] ?? BLOCK_COLORS[BLOCK.STONE];
}

/** Low-amplitude coordinate variation prevents large flat voxel fields looking tiled. */
export function blockMaterialVariation(x: number, y: number, z: number): number {
  return 0.93 + (((Math.imul(x, 13) ^ Math.imul(y, 7) ^ Math.imul(z, 17)) & 7) / 100);
}

function rankedTorchCompare(a: RankedTorchLight, b: RankedTorchLight): number {
  return a.distanceSquared - b.distanceSquared || a.x - b.x || a.y - b.y || a.z - b.z;
}

/** Selects a stable, bounded nearest set without sorting or copying the full input. */
export function selectNearestTorchLights(
  lights: Iterable<TorchLightPosition>,
  camera: readonly [number, number, number],
  limit = MAX_ACTIVE_TORCH_LIGHTS,
  radius = TORCH_LIGHT_RADIUS,
): TorchLightPosition[] {
  const boundedLimit = clampNumber(Math.floor(limit), 0, MAX_ACTIVE_TORCH_LIGHTS);
  if (boundedLimit === 0 || radius <= 0) return [];
  const radiusSquared = radius * radius;
  const ranked: RankedTorchLight[] = [];
  for (const light of lights) {
    const dx = light.x - camera[0];
    const dy = light.y - camera[1];
    const dz = light.z - camera[2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    if (distanceSquared > radiusSquared) continue;
    const candidate: RankedTorchLight = { x: light.x, y: light.y, z: light.z, distanceSquared };
    let insertionIndex = ranked.length;
    while (insertionIndex > 0 && rankedTorchCompare(candidate, ranked[insertionIndex - 1]) < 0) {
      insertionIndex -= 1;
    }
    if (insertionIndex >= boundedLimit) continue;
    ranked.splice(insertionIndex, 0, candidate);
    if (ranked.length > boundedLimit) ranked.pop();
  }
  return ranked.map(({ x, y, z }) => ({ x, y, z }));
}

export function blockOccludesFaces(block: BlockId): boolean {
  return block !== BLOCK.BED && blockStopsSky(block);
}

/** Glass keeps neighboring opaque faces, but adjacent glass cells share no internal seam. */
export function blockFaceIsOccluded(block: BlockId, neighbor: BlockId): boolean {
  return (block === BLOCK.GLASS && neighbor === BLOCK.GLASS) || blockOccludesFaces(neighbor);
}

/** Stable far-to-near key order for the bounded per-chunk transparent pass. */
export function sortTransparentChunkKeysBackToFront(
  keys: readonly string[],
  camera: readonly [number, number, number],
): string[] {
  const centerOffset = WORLD_CHUNK_SIZE * 0.5;
  const distanceSquared = (key: string): number => {
    const coordinate = parseChunkKey(key);
    const dx = coordinate.x * WORLD_CHUNK_SIZE + centerOffset - camera[0];
    const dz = coordinate.z * WORLD_CHUNK_SIZE + centerOffset - camera[2];
    return dx * dx + dz * dz;
  };
  return [...keys].sort((left, right) => (
    distanceSquared(right) - distanceSquared(left) || left.localeCompare(right)
  )).slice(0, MAX_TRANSPARENT_CHUNK_DRAWS);
}

export function blockHasCollision(block: BlockId): boolean {
  return block !== BLOCK.AIR
    && block !== BLOCK.TORCH
    && block !== BLOCK.DOOR_OPEN
    && block !== BLOCK.OAK_FENCE_GATE_OPEN
    && block !== BLOCK.LADDER
    && block !== BLOCK.SAPLING;
}

export type OakFenceConnections = Readonly<{
  east: boolean;
  west: boolean;
  south: boolean;
  north: boolean;
}>;

export type OakFenceBlockLookup = (x: number, y: number, z: number) => BlockId;

/** Fences join one another and opaque full-block terrain, never thin authored meshes. */
export function oakFenceConnectsTo(block: BlockId): boolean {
  return block === BLOCK.OAK_FENCE
    || block === BLOCK.OAK_FENCE_GATE_CLOSED
    || block === BLOCK.OAK_FENCE_GATE_OPEN
    || (
      blockOccludesFaces(block)
      && block !== BLOCK.CHEST
      && block !== BLOCK.BED
      && block !== BLOCK.DOOR_CLOSED
      && block !== BLOCK.DOOR_OPEN
    );
}

/** Allocation-bounded, deterministic neighbor mask shared by meshing and tests. */
export function oakFenceConnections(
  x: number,
  y: number,
  z: number,
  getBlock: OakFenceBlockLookup,
): OakFenceConnections {
  return {
    east: oakFenceConnectsTo(getBlock(x + 1, y, z)),
    west: oakFenceConnectsTo(getBlock(x - 1, y, z)),
    south: oakFenceConnectsTo(getBlock(x, y, z + 1)),
    north: oakFenceConnectsTo(getBlock(x, y, z - 1)),
  };
}

export const OAK_FENCE_HEIGHT = 1.5;

/** Exact vertical AABB rule used for the otherwise-empty half-block above a fence cell. */
export function playerIntersectsOakFenceHeight(
  playerY: number,
  bodyHeight: number,
  fenceY: number,
): boolean {
  if (![playerY, bodyHeight, fenceY].every(Number.isFinite) || bodyHeight <= 0) return false;
  const playerBottom = playerY + 0.001;
  const playerTop = playerY + Math.max(0.1, bodyHeight) - 0.01;
  return playerTop > fenceY && playerBottom < fenceY + OAK_FENCE_HEIGHT;
}

export type LadderBlockLookup = (x: number, y: number, z: number) => BlockId;

/** Allocation-free player AABB overlap check covering both feet and torso cells. */
export function playerTouchesLadder(
  x: number,
  y: number,
  z: number,
  getBlock: LadderBlockLookup,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  const halfWidth = 0.29;
  const minX = Math.floor(x - halfWidth);
  const maxX = Math.floor(x + halfWidth);
  const minY = Math.floor(y + 0.001);
  const maxY = Math.floor(y + 1.77);
  const minZ = Math.floor(z - halfWidth);
  const maxZ = Math.floor(z + halfWidth);
  for (let blockX = minX; blockX <= maxX; blockX += 1) {
    for (let blockY = minY; blockY <= maxY; blockY += 1) {
      for (let blockZ = minZ; blockZ <= maxZ; blockZ += 1) {
        if (getBlock(blockX, blockY, blockZ) === BLOCK.LADDER) return true;
      }
    }
  }
  return false;
}

/**
 * Resolves climbing or normal gravity into a finite, game-safe vertical speed.
 * The caller passes key intent as booleans, avoiding per-frame input objects.
 */
export function ladderVerticalVelocity(
  currentVelocity: number,
  touchingLadder: boolean,
  ascend: boolean,
  descend: boolean,
  elapsedSeconds: number,
): number {
  const boundedVelocity = Number.isFinite(currentVelocity)
    ? clampNumber(currentVelocity, PLAYER_TERMINAL_VELOCITY, PLAYER_JUMP_SPEED)
    : 0;
  if (touchingLadder === true) {
    if (ascend === true && descend !== true) return LADDER_CLIMB_SPEED;
    if (descend === true && ascend !== true) return LADDER_DESCEND_SPEED;
    return clampNumber(boundedVelocity, LADDER_IDLE_SLIDE_SPEED, 0);
  }
  const dt = Number.isFinite(elapsedSeconds)
    ? clampNumber(elapsedSeconds, 0, 0.05)
    : 0;
  return Math.max(PLAYER_TERMINAL_VELOCITY, boundedVelocity - PLAYER_GRAVITY * dt);
}

export function isDoorBlock(block: BlockId): boolean {
  return block === BLOCK.DOOR_CLOSED || block === BLOCK.DOOR_OPEN;
}

export function isOakFenceGateBlock(block: BlockId): boolean {
  return block === BLOCK.OAK_FENCE_GATE_CLOSED || block === BLOCK.OAK_FENCE_GATE_OPEN;
}

export function toggledDoorBlock(block: BlockId): BlockId | null {
  if (block === BLOCK.DOOR_CLOSED) return BLOCK.DOOR_OPEN;
  if (block === BLOCK.DOOR_OPEN) return BLOCK.DOOR_CLOSED;
  if (block === BLOCK.OAK_FENCE_GATE_CLOSED) return BLOCK.OAK_FENCE_GATE_OPEN;
  if (block === BLOCK.OAK_FENCE_GATE_OPEN) return BLOCK.OAK_FENCE_GATE_CLOSED;
  return null;
}

export function doorPlacementBlock(block: BlockId): BlockId {
  if (isDoorBlock(block)) return BLOCK.DOOR_CLOSED;
  if (isOakFenceGateBlock(block)) return BLOCK.OAK_FENCE_GATE_CLOSED;
  return block;
}

/** Maps the engine palette onto the shared blast-cover categories. */
export function localCreeperExposureBlock(block: BlockId): BlockType {
  if (block === BLOCK.AIR) return "air";
  if (block === BLOCK.TORCH) return "torch";
  if (block === BLOCK.LADDER) return "ladder";
  if (block === BLOCK.DOOR_OPEN) return "door_open";
  if (block === BLOCK.OAK_FENCE_GATE_OPEN) return "oak_fence_gate_open";
  return "stone";
}

export function createDoorToggleEdit(target: BlockTarget): WorldEdit | null {
  const block = toggledDoorBlock(target.block.block);
  return block === null
    ? null
    : { x: target.block.x, y: target.block.y, z: target.block.z, block };
}

export function applyDayNightClockUpdate(
  target: DayNightConfig,
  update: Partial<DayNightConfig>,
  currentServerTimeOffsetMs: number,
  nextServerTimeOffsetMs?: number,
): number {
  if (Number.isFinite(update.cycleLengthMs) && (update.cycleLengthMs ?? 0) > 0) {
    target.cycleLengthMs = update.cycleLengthMs as number;
  }
  if (Number.isFinite(update.epochMs)) target.epochMs = update.epochMs as number;
  if (Number.isFinite(update.epochPhase)) target.epochPhase = update.epochPhase as number;
  return Number.isFinite(nextServerTimeOffsetMs)
    ? nextServerTimeOffsetMs as number
    : currentServerTimeOffsetMs;
}

/** Returns a bounded engine pose, or null when a requested spawn is unsafe. */
export function validateRespawnPoint(
  point: RespawnPoint,
  horizontalLimit = 64,
): PlayerPose | null {
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || !Number.isFinite(point.z)
    || (point.y < -24 || point.y > MAX_RESPAWN_HEIGHT)
    || !Number.isFinite(horizontalLimit)
    || horizontalLimit <= 0
    || Math.abs(point.x) > horizontalLimit
    || Math.abs(point.z) > horizontalLimit
    || (point.yaw !== undefined && !Number.isFinite(point.yaw))
    || (point.pitch !== undefined && !Number.isFinite(point.pitch))
  ) return null;
  const rawYaw = point.yaw ?? 0;
  const yaw = ((rawYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    yaw,
    pitch: clampNumber(point.pitch ?? -0.08, -1.52, 1.52),
  };
}

/** Dispatches the currently supported block interaction without changing placement state. */
export function tryInteractBlock(
  target: BlockTarget,
  onInteractBlock?: (target: BlockTarget) => boolean,
): boolean {
  if (
    (
      target.block.block !== BLOCK.CHEST
      && target.block.block !== BLOCK.BED
      && target.block.block !== BLOCK.CRAFTING_TABLE
      && target.block.block !== BLOCK.FURNACE
      && target.block.block !== BLOCK.TNT
      && target.block.block !== BLOCK.SAPLING
      && !isOakFenceGateBlock(target.block.block)
    )
    || !onInteractBlock
  ) return false;
  return onInteractBlock(target) === true;
}

/** Saplings only attach to the top of dirt-like soil, matching their non-cubic footprint. */
export function canPlaceSapling(target: Readonly<BlockTarget>, blockBelow: BlockId): boolean {
  return target.place.x === target.block.x
    && target.place.z === target.block.z
    && target.place.y === target.block.y + 1
    && (blockBelow === BLOCK.GRASS || blockBelow === BLOCK.DIRT);
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "WebGL shader compilation failed.");
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource = VERTEX_SHADER,
  fragmentSource = FRAGMENT_SHADER,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create the WebGL program.");
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "WebGL program link failed.");
  }
  return program;
}

function createTerrainTexture(gl: WebGLRenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Unable to allocate the terrain texture atlas.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    TEXTURE_TILE_SIZE * TEXTURE_ATLAS_COLUMNS,
    TEXTURE_TILE_SIZE * TEXTURE_ATLAS_ROWS,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    TEXTURE_ATLAS_RGBA,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

export function writePerspectiveMatrix(out: Float32Array, fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function writeLookAtMatrix(out: Float32Array, eye: Vec3, center: Vec3): Float32Array {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let length = Math.hypot(zx, zy, zz) || 1;
  zx /= length; zy /= length; zz /= length;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  length = Math.hypot(xx, xy, xz) || 1;
  xx /= length; xy /= length; xz /= length;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

function pushVertex(output: number[], position: Vec3, color: Vec3): void {
  output.push(position[0], position[1], position[2], color[0], color[1], color[2]);
}

function pushTexturedVertex(
  output: number[],
  position: Vec3,
  u: number,
  v: number,
  shade: number,
): void {
  output.push(position[0], position[1], position[2], u, v, shade);
}

function retainedTerrainShade(faceShade: number, exposureLevel?: number, emissive = false): number {
  return exposureLevel === undefined ? faceShade : packSkyExposureShade(faceShade, exposureLevel, emissive);
}

function appendTexturedBlockFace(
  output: number[],
  x: number,
  y: number,
  z: number,
  face: (typeof FACE_DEFS)[number],
  textureName: Parameters<typeof textureAtlasUv>[0],
  shade: number,
  exposureLevel: number,
  emissive = false,
): void {
  const uv = textureAtlasUv(textureName);
  for (const point of face[5]) {
    const horizontal = face[1] !== 0 ? point[2] : point[0];
    const vertical = face[2] !== 0 ? point[2] : point[1];
    pushTexturedVertex(
      output,
      [x + point[0], y + point[1], z + point[2]],
      uv.left + (uv.right - uv.left) * horizontal,
      uv.bottom + (uv.top - uv.bottom) * vertical,
      retainedTerrainShade(shade, exposureLevel, emissive),
    );
  }
}

function appendTexturedAxisAlignedBox(
  output: number[],
  min: Vec3,
  max: Vec3,
  textureName: Parameters<typeof textureAtlasUv>[0],
  shade = 1,
  exposureLevel?: number,
): void {
  const uv = textureAtlasUv(textureName);
  for (const face of FACE_DEFS) {
    for (const point of face[5]) {
      const horizontal = face[1] !== 0 ? point[2] : point[0];
      const vertical = face[2] !== 0 ? point[2] : point[1];
      pushTexturedVertex(
        output,
        [
          min[0] + point[0] * (max[0] - min[0]),
          min[1] + point[1] * (max[1] - min[1]),
          min[2] + point[2] * (max[2] - min[2]),
        ],
        uv.left + (uv.right - uv.left) * horizontal,
        uv.bottom + (uv.top - uv.bottom) * vertical,
        retainedTerrainShade(face[4] * shade, exposureLevel),
      );
    }
  }
}

export const STONE_BRICK_SLAB_MESH_VERTEX_COUNT = 36;

/**
 * One bottom-half textured box in the retained opaque terrain batch. Side UVs
 * consume exactly half of the 16px masonry tile instead of stretching it.
 * The optional lookup culls only faces that are completely hidden.
 */
export function appendStoneBrickSlabMesh(
  output: number[],
  x: number,
  y: number,
  z: number,
  shade = 1,
  getBlock?: (x: number, y: number, z: number) => BlockId,
  exposureLevel?: number,
): void {
  const uv = textureAtlasUv("stone_bricks");
  for (const face of FACE_DEFS) {
    if (getBlock) {
      const neighbor = getBlock(x + face[1], y + face[2], z + face[3]);
      const horizontalFace = face[2] === 0;
      if ((horizontalFace && (neighbor === BLOCK.STONE_BRICK_SLAB || blockOccludesFaces(neighbor)))
        || (face[0] === "bottom" && blockOccludesFaces(neighbor))) continue;
    }
    for (const point of face[5]) {
      const horizontal = face[1] !== 0 ? point[2] : point[0];
      const vertical = face[2] !== 0 ? point[2] : point[1] * STONE_BRICK_SLAB_HEIGHT;
      pushTexturedVertex(
        output,
        [x + point[0], y + point[1] * STONE_BRICK_SLAB_HEIGHT, z + point[2]],
        uv.left + (uv.right - uv.left) * horizontal,
        uv.bottom + (uv.top - uv.bottom) * vertical,
        retainedTerrainShade(face[4] * shade, exposureLevel),
      );
    }
  }
}

export const SAPLING_MESH_VERTEX_COUNT = 12;

/** Two diagonal quads form the classic crossed-plant silhouette at a fixed vertex cost. */
export function appendSaplingMesh(
  output: number[],
  x: number,
  y: number,
  z: number,
  shade = 1,
  exposureLevel?: number,
): void {
  const uv = textureAtlasUv("sapling");
  const left = x + 0.12;
  const right = x + 0.88;
  const near = z + 0.12;
  const far = z + 0.88;
  const bottom = y;
  const top = y + 1;
  const vertex = (px: number, py: number, pz: number, u: number, v: number): void => {
    pushTexturedVertex(output, [px, py, pz], u, v, retainedTerrainShade(shade, exposureLevel));
  };
  vertex(left, bottom, near, uv.left, uv.bottom);
  vertex(left, top, near, uv.left, uv.top);
  vertex(right, top, far, uv.right, uv.top);
  vertex(left, bottom, near, uv.left, uv.bottom);
  vertex(right, top, far, uv.right, uv.top);
  vertex(right, bottom, far, uv.right, uv.bottom);
  vertex(right, bottom, near, uv.left, uv.bottom);
  vertex(right, top, near, uv.left, uv.top);
  vertex(left, top, far, uv.right, uv.top);
  vertex(right, bottom, near, uv.left, uv.bottom);
  vertex(left, top, far, uv.right, uv.top);
  vertex(left, bottom, far, uv.right, uv.bottom);
}

export const OAK_FENCE_BOX_VERTEX_COUNT = 36;

export function oakFenceMeshVertexCount(connections: OakFenceConnections): number {
  const connectionCount = Number(connections.east) + Number(connections.west)
    + Number(connections.south) + Number(connections.north);
  return OAK_FENCE_BOX_VERTEX_COUNT * (1 + connectionCount * 2);
}

/** One 1.5-block post plus two rails for each connected horizontal direction. */
export function appendOakFenceMesh(
  output: number[],
  x: number,
  y: number,
  z: number,
  connections: OakFenceConnections,
  shade = 1,
  exposureLevel?: number,
): void {
  const texture = "oak_planks" as const;
  appendTexturedAxisAlignedBox(
    output,
    [x + 0.375, y, z + 0.375],
    [x + 0.625, y + OAK_FENCE_HEIGHT, z + 0.625],
    texture,
    shade,
    exposureLevel,
  );
  const addRails = (minX: number, maxX: number, minZ: number, maxZ: number): void => {
    appendTexturedAxisAlignedBox(
      output, [minX, y + 0.50, minZ], [maxX, y + 0.75, maxZ], texture, shade, exposureLevel,
    );
    appendTexturedAxisAlignedBox(
      output, [minX, y + 1.00, minZ], [maxX, y + 1.25, maxZ], texture, shade, exposureLevel,
    );
  };
  if (connections.east) addRails(x + 0.5, x + 1, z + 0.4375, z + 0.5625);
  if (connections.west) addRails(x, x + 0.5, z + 0.4375, z + 0.5625);
  if (connections.south) addRails(x + 0.4375, x + 0.5625, z + 0.5, z + 1);
  if (connections.north) addRails(x + 0.4375, x + 0.5625, z, z + 0.5);
}

export const OAK_FENCE_GATE_MESH_VERTEX_COUNT = OAK_FENCE_BOX_VERTEX_COUNT * 4;

/** Two fixed posts and two rails; opening swings the rails south around the west hinge. */
export function appendOakFenceGateMesh(
  output: number[],
  x: number,
  y: number,
  z: number,
  open: boolean,
  shade = 1,
  exposureLevel?: number,
): void {
  const texture = "oak_planks" as const;
  appendTexturedAxisAlignedBox(
    output,
    [x + 0.0625, y, z + 0.375],
    [x + 0.1875, y + OAK_FENCE_HEIGHT, z + 0.625],
    texture,
    shade,
    exposureLevel,
  );
  appendTexturedAxisAlignedBox(
    output,
    [x + 0.8125, y, z + 0.375],
    [x + 0.9375, y + OAK_FENCE_HEIGHT, z + 0.625],
    texture,
    shade,
    exposureLevel,
  );
  const appendRail = (minimumY: number, maximumY: number): void => {
    appendTexturedAxisAlignedBox(
      output,
      open
        ? [x + 0.0625, y + minimumY, z + 0.5]
        : [x + 0.125, y + minimumY, z + 0.4375],
      open
        ? [x + 0.1875, y + maximumY, z + 1]
        : [x + 0.875, y + maximumY, z + 0.5625],
      texture,
      shade,
      exposureLevel,
    );
  };
  appendRail(0.50, 0.75);
  appendRail(1.00, 1.25);
}

function tint(color: Vec3, shade: number, variation = 1): Vec3 {
  return [color[0] * shade * variation, color[1] * shade * variation, color[2] * shade * variation];
}

function packColorVerticesForSky(output: number[], start: number, exposureLevel: number): void {
  for (let offset = start + 3; offset < output.length; offset += 6) {
    output[offset] = packSkyExposureShade(output[offset], exposureLevel);
  }
}

function appendAxisAlignedBox(output: number[], min: Vec3, max: Vec3, color: Vec3): void {
  for (const face of FACE_DEFS) {
    const shaded = tint(color, face[4]);
    for (const point of face[5]) {
      pushVertex(output, [
        min[0] + point[0] * (max[0] - min[0]),
        min[1] + point[1] * (max[1] - min[1]),
        min[2] + point[2] * (max[2] - min[2]),
      ], shaded);
    }
  }
}

/** Adds a thin wooden stem and a bright ember cap centered in its block cell. */
export function appendTorchMesh(output: number[], x: number, y: number, z: number): void {
  appendAxisAlignedBox(
    output,
    [x + 0.42, y, z + 0.42],
    [x + 0.58, y + 0.7, z + 0.58],
    [0.53, 0.30, 0.09],
  );
  appendAxisAlignedBox(
    output,
    [x + 0.38, y + 0.67, z + 0.38],
    [x + 0.62, y + 0.88, z + 0.62],
    BLOCK_COLORS[BLOCK.TORCH],
  );
}

/** A warm inset body, raised lid, and gold front latch make the chest readable at a glance. */
export function appendChestMesh(output: number[], x: number, y: number, z: number): void {
  appendAxisAlignedBox(
    output,
    [x + 0.04, y, z + 0.04],
    [x + 0.96, y + 0.64, z + 0.96],
    BLOCK_COLORS[BLOCK.CHEST],
  );
  appendAxisAlignedBox(
    output,
    [x + 0.02, y + 0.64, z + 0.02],
    [x + 0.98, y + 0.92, z + 0.98],
    [0.68, 0.39, 0.13],
  );
  appendAxisAlignedBox(
    output,
    [x + 0.43, y + 0.48, z - 0.01],
    [x + 0.57, y + 0.70, z + 0.08],
    [0.86, 0.68, 0.20],
  );
}

/** Adds a 1.9-block wooden slab with inset panels and a contrasting handle. */
export function appendDoorMesh(
  output: number[],
  x: number,
  y: number,
  z: number,
  open: boolean,
): void {
  if (open) {
    appendAxisAlignedBox(output, [x + 0.05, y, z + 0.02], [x + 0.15, y + 1.9, z + 0.98], BLOCK_COLORS[BLOCK.DOOR_OPEN]);
    appendAxisAlignedBox(output, [x + 0.035, y + 0.18, z + 0.16], [x + 0.065, y + 0.75, z + 0.84], [0.38, 0.20, 0.07]);
    appendAxisAlignedBox(output, [x + 0.035, y + 1.05, z + 0.16], [x + 0.065, y + 1.70, z + 0.84], [0.38, 0.20, 0.07]);
    appendAxisAlignedBox(output, [x, y + 0.90, z + 0.77], [x + 0.05, y + 1.0, z + 0.87], [0.84, 0.69, 0.22]);
    return;
  }
  appendAxisAlignedBox(output, [x + 0.02, y, z + 0.45], [x + 0.98, y + 1.9, z + 0.55], BLOCK_COLORS[BLOCK.DOOR_CLOSED]);
  appendAxisAlignedBox(output, [x + 0.16, y + 0.18, z + 0.42], [x + 0.84, y + 0.75, z + 0.455], [0.38, 0.20, 0.07]);
  appendAxisAlignedBox(output, [x + 0.16, y + 1.05, z + 0.42], [x + 0.84, y + 1.70, z + 0.455], [0.38, 0.20, 0.07]);
  appendAxisAlignedBox(output, [x + 0.77, y + 0.90, z + 0.38], [x + 0.87, y + 1.0, z + 0.43], [0.84, 0.69, 0.22]);
}

/**
 * A paired bed is emitted once from its foot cell as three continuous boxes.
 * The head cell deliberately emits nothing, eliminating the duplicate internal
 * faces and inset gap that made the two saved cells look like separate blocks.
 */
export function appendBedMesh(
  output: number[],
  x: number,
  y: number,
  z: number,
  part: "single" | "foot" | "head" = "single",
  direction: BedDirection = "north",
): void {
  if (part === "head") return;
  const paired = part === "foot";
  const dx = paired ? (direction === "east" ? 1 : direction === "west" ? -1 : 0) : 0;
  const dz = paired ? (direction === "south" ? 1 : direction === "north" ? -1 : 0) : 0;
  const headX = x + dx;
  const headZ = z + dz;
  const longX = dx !== 0;
  const longZ = dz !== 0;
  const minX = Math.min(x, headX);
  const minZ = Math.min(z, headZ);
  appendAxisAlignedBox(output, [minX + (longX ? 0.03 : 0.08), y + 0.08, minZ + (longZ ? 0.03 : 0.08)], [Math.max(x, headX) + (longX ? 0.97 : 0.92), y + 0.32, Math.max(z, headZ) + (longZ ? 0.97 : 0.92)], [0.38, 0.20, 0.07]);
  appendAxisAlignedBox(output, [minX + (longX ? 0.04 : 0.09), y + 0.32, minZ + (longZ ? 0.04 : 0.09)], [Math.max(x, headX) + (longX ? 0.96 : 0.91), y + 0.53, Math.max(z, headZ) + (longZ ? 0.96 : 0.91)], BLOCK_COLORS[BLOCK.BED]);
  const pillowMin: Vec3 = direction === "east" ? [headX + 0.66, y + 0.32, headZ + 0.11]
    : direction === "west" ? [headX + 0.09, y + 0.32, headZ + 0.11]
      : direction === "south" ? [headX + 0.11, y + 0.32, headZ + 0.66]
        : [headX + 0.11, y + 0.32, headZ + 0.09];
  const pillowMax: Vec3 = direction === "east" ? [headX + 0.91, y + 0.55, headZ + 0.89]
    : direction === "west" ? [headX + 0.34, y + 0.55, headZ + 0.89]
      : direction === "south" ? [headX + 0.89, y + 0.55, headZ + 0.91]
        : [headX + 0.89, y + 0.55, headZ + 0.34];
  appendAxisAlignedBox(output, pillowMin, pillowMax, [0.91, 0.90, 0.84]);
}

/** Two rails and five rungs form a thin wooden ladder facing fixed north (-Z). */
export function appendLadderMesh(output: number[], x: number, y: number, z: number): void {
  const railColor: Vec3 = [0.47, 0.27, 0.10];
  const rungColor = BLOCK_COLORS[BLOCK.LADDER];
  appendAxisAlignedBox(output, [x + 0.13, y + 0.03, z + 0.84], [x + 0.23, y + 0.97, z + 0.93], railColor);
  appendAxisAlignedBox(output, [x + 0.77, y + 0.03, z + 0.84], [x + 0.87, y + 0.97, z + 0.93], railColor);
  for (let rung = 0; rung < 5; rung += 1) {
    const rungY = y + 0.12 + rung * 0.19;
    appendAxisAlignedBox(output, [x + 0.18, rungY, z + 0.78], [x + 0.82, rungY + 0.07, z + 0.98], rungColor);
  }
}

function sameTarget(a: BlockTarget | null, b: BlockTarget | null): boolean {
  return a === b || (!!a && !!b
    && a.block.x === b.block.x
    && a.block.y === b.block.y
    && a.block.z === b.block.z
    && a.block.block === b.block.block);
}

/** Extracts six column-major clip planes once for a complete culling pass. */
export function writeFrustumPlanes(output: Float32Array, mvp: Float32Array): Float32Array {
  for (let plane = 0; plane < 6; plane += 1) {
    const axis = plane >> 1;
    const sign = (plane & 1) === 0 ? 1 : -1;
    const offset = plane * 4;
    output[offset] = mvp[3] + sign * mvp[axis];
    output[offset + 1] = mvp[7] + sign * mvp[4 + axis];
    output[offset + 2] = mvp[11] + sign * mvp[8 + axis];
    output[offset + 3] = mvp[15] + sign * mvp[12 + axis];
  }
  return output;
}

/** Allocation-free AABB/frustum test used once per retained chunk mesh. */
export function aabbIntersectsFrustum(
  planes: Float32Array,
  centerX: number,
  centerY: number,
  centerZ: number,
  extentX: number,
  extentY: number,
  extentZ: number,
): boolean {
  for (let offset = 0; offset < 24; offset += 4) {
    const distance = planes[offset] * centerX + planes[offset + 1] * centerY + planes[offset + 2] * centerZ + planes[offset + 3];
    const radius = Math.abs(planes[offset]) * extentX + Math.abs(planes[offset + 1]) * extentY + Math.abs(planes[offset + 2]) * extentZ;
    if (distance + radius < 0) return false;
  }
  return true;
}

function chunkIntersectsView(mesh: ChunkMesh, planes: Float32Array): boolean {
  return aabbIntersectsFrustum(
    planes,
    mesh.centerX,
    (mesh.minY + mesh.maxY) * 0.5,
    mesh.centerZ,
    WORLD_CHUNK_SIZE * 0.5,
    Math.max(0.5, (mesh.maxY - mesh.minY) * 0.5),
    WORLD_CHUNK_SIZE * 0.5,
  );
}

export function localMobAttackIsReady(readyAt: number, now: number): boolean {
  return Number.isFinite(now) && now >= readyAt;
}

export function advanceLocalMobAttackReadyAt(readyAt: number, now: number, applied: boolean): number {
  return applied ? now + PLAYER_ATTACK_COOLDOWN_MS : readyAt;
}

export function createVoxelEngine(canvas: HTMLCanvasElement, options: VoxelEngineOptions = {}): VoxelEngine {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
  if (!gl) throw new Error("Lakecraft needs a browser with WebGL enabled.");
  const program = createProgram(gl);
  const terrainProgram = createProgram(gl, TERRAIN_VERTEX_SHADER, TERRAIN_FRAGMENT_SHADER);
  const atmosphereProgram = createProgram(gl, ATMOSPHERE_VERTEX_SHADER, ATMOSPHERE_FRAGMENT_SHADER);
  const terrainTexture = createTerrainTexture(gl);
  const positionLocation = gl.getAttribLocation(program, "aPosition");
  const colorLocation = gl.getAttribLocation(program, "aColor");
  const mvpLocation = gl.getUniformLocation(program, "uMvp");
  const cameraLocation = gl.getUniformLocation(program, "uCamera");
  const fogLocation = gl.getUniformLocation(program, "uFogEnabled");
  const fogRangeLocation = gl.getUniformLocation(program, "uFogRange");
  const fogColorLocation = gl.getUniformLocation(program, "uFogColor");
  const lightingLocation = gl.getUniformLocation(program, "uLightingEnabled");
  const ambientColorLocation = gl.getUniformLocation(program, "uAmbientColor");
  const directionalColorLocation = gl.getUniformLocation(program, "uDirectionalColor");
  const ambientIntensityLocation = gl.getUniformLocation(program, "uAmbientIntensity");
  const directionalIntensityLocation = gl.getUniformLocation(program, "uDirectionalIntensity");
  const skyExposureLocation = gl.getUniformLocation(program, "uSkyExposure");
  const torchLightsLocation = gl.getUniformLocation(program, "uTorchLights[0]");
  const terrainPositionLocation = gl.getAttribLocation(terrainProgram, "aPosition");
  const terrainUvLocation = gl.getAttribLocation(terrainProgram, "aUv");
  const terrainShadeLocation = gl.getAttribLocation(terrainProgram, "aShade");
  const terrainMvpLocation = gl.getUniformLocation(terrainProgram, "uMvp");
  const terrainCameraLocation = gl.getUniformLocation(terrainProgram, "uCamera");
  const terrainFogLocation = gl.getUniformLocation(terrainProgram, "uFogEnabled");
  const terrainFogRangeLocation = gl.getUniformLocation(terrainProgram, "uFogRange");
  const terrainFogColorLocation = gl.getUniformLocation(terrainProgram, "uFogColor");
  const terrainAmbientColorLocation = gl.getUniformLocation(terrainProgram, "uAmbientColor");
  const terrainDirectionalColorLocation = gl.getUniformLocation(terrainProgram, "uDirectionalColor");
  const terrainAmbientIntensityLocation = gl.getUniformLocation(terrainProgram, "uAmbientIntensity");
  const terrainDirectionalIntensityLocation = gl.getUniformLocation(terrainProgram, "uDirectionalIntensity");
  const terrainSkyExposureLocation = gl.getUniformLocation(terrainProgram, "uSkyExposure");
  const terrainTorchLightsLocation = gl.getUniformLocation(terrainProgram, "uTorchLights[0]");
  const terrainAtlasLocation = gl.getUniformLocation(terrainProgram, "uAtlas");
  const terrainAlphaCutoffLocation = gl.getUniformLocation(terrainProgram, "uAlphaCutoff");
  const atmospherePositionLocation = gl.getAttribLocation(atmosphereProgram, "p");
  const atmosphereAspectLocation = gl.getUniformLocation(atmosphereProgram, "A");
  const atmosphereTimeLocation = gl.getUniformLocation(atmosphereProgram, "T");
  const atmosphereEyeLocation = gl.getUniformLocation(atmosphereProgram, "E");
  const atmosphereForwardLocation = gl.getUniformLocation(atmosphereProgram, "F");
  const atmosphereRightLocation = gl.getUniformLocation(atmosphereProgram, "X");
  const atmosphereUpLocation = gl.getUniformLocation(atmosphereProgram, "Y");
  const atmosphereSkyColorLocation = gl.getUniformLocation(atmosphereProgram, "K");
  const atmosphereFogColorLocation = gl.getUniformLocation(atmosphereProgram, "G");
  const atmosphereSunDirectionLocation = gl.getUniformLocation(atmosphereProgram, "D");
  const atmosphereMoonDirectionLocation = gl.getUniformLocation(atmosphereProgram, "N");
  const atmosphereSunIntensityLocation = gl.getUniformLocation(atmosphereProgram, "S");
  const atmosphereMoonIntensityLocation = gl.getUniformLocation(atmosphereProgram, "M");
  const atmosphereStarIntensityLocation = gl.getUniformLocation(atmosphereProgram, "R");
  const atmosphereBuffer = gl.createBuffer();
  const lineBuffer = gl.createBuffer();
  const crackBuffer = gl.createBuffer();
  const particleBuffer = gl.createBuffer();
  if (!lineBuffer || !crackBuffer || !atmosphereBuffer || !particleBuffer) throw new Error("Unable to allocate WebGL buffers.");
  const targetOutlineGeometry = new Float32Array(TARGET_OUTLINE_VERTEX_COUNT * 6);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, targetOutlineGeometry.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, atmosphereBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, ATMOSPHERE_SCREEN_TRIANGLE, gl.STATIC_DRAW);
  const remotePlayerRenderer = createRemotePlayerRenderer(gl);
  const playerSkinRenderer = createPlayerSkinRenderer(gl);
  const firstPersonSkinRenderer = createFirstPersonSkinRenderer(gl);
  const droppedItemRenderer = createDroppedItemRenderer(gl);
  const playerProjectileRenderer = createPlayerProjectileRenderer(gl);
  const [
    firstPersonColorBuffer,
    firstPersonTexturedBuffer,
    firstPersonStats,
    setFirstPersonHeldItem,
    setFirstPersonBowCharge,
    triggerFirstPersonAction,
    writeFirstPersonMvp,
    destroyFirstPersonRenderer,
  ] = createFirstPersonRenderer(gl);
  const blockParticles = createBlockParticleSystem();
  const particleCapacity = blockParticleBufferCapacity(blockParticles.capacity);
  const particleGeometry = new Float32Array(particleCapacity.floatCount);
  let particleUploadFloatCount = -1;
  let particleUploadView = particleGeometry.subarray(0, 0);
  const particleGeometryStats: BlockParticleGeometryStats = {
    activeParticleCount: 0,
    writtenParticleCount: 0,
    vertexCount: 0,
    floatCount: 0,
  };
  const particleCameraRight = new Float32Array(3);
  const particleCameraUp = new Float32Array(3);
  const frustumPlanes = new Float32Array(24);
  const renderEye: Vec3 = [0, 0, 0];
  const renderFacing: Vec3 = [0, 0, 0];
  const playerEyeForCamera: Vec3 = [0, 0, 0];
  const playerFacingForCamera: Vec3 = [0, 0, 0];
  const playerSkinLight: Vec3 = [1, 1, 1];
  const firstPersonSkinLight: Vec3 = [1, 1, 1];
  const renderCenter: Vec3 = [0, 0, 0];
  const raycastEye: Vec3 = [0, 0, 0];
  const raycastFacing: Vec3 = [0, 0, 0];
  const projectionMatrix = new Float32Array(16);
  const viewMatrix = new Float32Array(16);
  const mvpMatrix = new Float32Array(16);
  const firstPersonMvpMatrix = new Float32Array(16);
  const fogRange = new Float32Array(2);
  gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, particleGeometry.byteLength, gl.DYNAMIC_DRAW);

  const seed = options.seed ?? 7319;
  const radius = clampNumber(options.worldRadius ?? 20, 8, 40);
  const dayNightConfig: DayNightConfig = {
    cycleLengthMs: options.dayNight?.cycleLengthMs ?? DEFAULT_DAY_NIGHT_CONFIG.cycleLengthMs,
    epochMs: options.dayNight?.epochMs ?? DEFAULT_DAY_NIGHT_CONFIG.epochMs,
    epochPhase: options.dayNight?.epochPhase ?? DEFAULT_DAY_NIGHT_CONFIG.epochPhase,
  };
  let serverTimeOffsetMs = Number.isFinite(options.serverTimeOffsetMs)
    ? options.serverTimeOffsetMs ?? 0
    : 0;
  let worldTimeMs = Date.now() + serverTimeOffsetMs;
  const dayNightState = createDayNightState();
  const atmosphereSunDirection = new Float32Array(3);
  const atmosphereMoonDirection = new Float32Array(3);
  const maximumVertexAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
  const startY = terrainHeight(0, 0, seed) + 1.02;
  const initialX = options.initialPose?.x ?? 0.5;
  const initialZ = options.initialPose?.z ?? 0.5;
  const pose: PlayerPose = {
    x: initialX,
    y: options.initialPose?.y ?? terrainHeight(initialX, initialZ, seed) + 1.02,
    z: initialZ,
    yaw: options.initialPose?.yaw ?? 0,
    pitch: options.initialPose?.pitch ?? -0.08,
  };
  let respawnPoint: PlayerPose = {
    x: 0.5,
    y: startY,
    z: 0.5,
    yaw: 0,
    pitch: -0.08,
  };
  const blocks = new Map<string, BlockId>();
  const skyOccluderColumns: SkyOccluderColumns = new Map();
  const primedTnt = new Set<string>();
  const torchLights = new Map<string, TorchLightPosition>();
  const mobTorchColumns = new Map<string, number[]>();
  const mobTorchCache = createMobTorchLightCache();
  let mobTorchRevision = 0;
  const activeTorchUniforms = new Float32Array(MAX_ACTIVE_TORCH_LIGHTS * 4);
  const firstPersonTorchUniforms = new Float32Array(MAX_ACTIVE_TORCH_LIGHTS * 4);
  let activeTorchLights = 0;
  let lastTorchSelectionAt = -Infinity;
  let lastTorchCameraX = Infinity;
  let lastTorchCameraY = Infinity;
  let lastTorchCameraZ = Infinity;

  function invalidateMobTorchLightCache(): void {
    mobTorchRevision = (mobTorchRevision + 1) & 0x7fffffff;
  }

  function addTorchLight(key: string, x: number, y: number, z: number): void {
    const light = { x: x + 0.5, y: y + 0.76, z: z + 0.5 };
    torchLights.set(key, light);
    const columnKey = skyColumnKey(x, z);
    const column = mobTorchColumns.get(columnKey);
    if (column) column.push(light.y);
    else mobTorchColumns.set(columnKey, [light.y]);
    invalidateMobTorchLightCache();
  }

  function removeTorchLight(key: string): void {
    const light = torchLights.get(key);
    if (!light) return;
    torchLights.delete(key);
    const columnKey = skyColumnKey(Math.floor(light.x), Math.floor(light.z));
    const column = mobTorchColumns.get(columnKey);
    if (column) {
      for (let index = 0; index < column.length; index += 1) {
        if (column[index] !== light.y) continue;
        column.splice(index, 1);
        break;
      }
      if (!column.length) mobTorchColumns.delete(columnKey);
    }
    invalidateMobTorchLightCache();
  }
  const chunkBlocks = new Map<string, Set<string>>();
  const loadedChunkKeys = new Set<string>();
  const pendingChunkMeshRebuilds = new Set<string>();
  const rememberedEditsByChunk = new Map<string, Map<string, WorldEdit>>();
  const initialEditBlocks = new Map<string, BlockId>();
  for (const edit of options.initialEdits ?? []) {
    const owner = chunkKeyForBlock(edit.x, edit.z);
    let chunkEdits = rememberedEditsByChunk.get(owner);
    if (!chunkEdits) {
      chunkEdits = new Map<string, WorldEdit>();
      rememberedEditsByChunk.set(owner, chunkEdits);
    }
    chunkEdits.set(blockKey(edit.x, edit.y, edit.z), { ...edit });
    initialEditBlocks.set(blockKey(edit.x, edit.y, edit.z), edit.block);
  }
  const bedStructures = new Map<string, BedStructure>();
  const bedCellOwners = new Map<string, string>();
  for (const candidate of options.initialBedStructures ?? []) {
    const canonical = createBedStructure(candidate.foot, candidate.direction);
    const footKey = bedCellKey(canonical.foot);
    const headKey = bedCellKey(canonical.head);
    if (canonical.head.x !== candidate.head.x || canonical.head.y !== candidate.head.y || canonical.head.z !== candidate.head.z
      || initialEditBlocks.get(footKey) !== BLOCK.BED || initialEditBlocks.get(headKey) !== BLOCK.BED
      || bedCellOwners.has(footKey) || bedCellOwners.has(headKey)) continue;
    const owner = bedStructureKey(canonical);
    bedStructures.set(owner, canonical);
    bedCellOwners.set(footKey, owner);
    bedCellOwners.set(headKey, owner);
  }
  let streamingChunkRadius = clampNumber(
    Math.floor(options.streamingChunkRadius ?? DEFAULT_STREAMING_CHUNK_RADIUS),
    1,
    MAX_LOCAL_STREAMING_CHUNK_RADIUS,
  );
  const initialChunkPlan = planChunkWindow(
    pose.x,
    pose.z,
    loadedChunkKeys,
    streamingChunkRadius,
    WORLD_CHUNK_SIZE,
    MAX_LOCAL_STREAMING_CHUNK_RADIUS,
  );
  for (const coordinate of initialChunkPlan.load) {
    const owner = chunkKey(coordinate.x, coordinate.z);
    const materialized = materializeTerrainChunk(
      seed,
      coordinate.x,
      coordinate.z,
      rememberedEditsByChunk.get(owner)?.values() ?? [],
    );
    writeChunkSkyOccluders(skyOccluderColumns, coordinate.x, coordinate.z, materialized);
    const owned = new Set<string>();
    for (const [key, block] of materialized) {
      blocks.set(key, block);
      owned.add(key);
      if (block === BLOCK.TORCH) {
        const [x, y, z] = key.split(",").map(Number);
        addTorchLight(key, x, y, z);
      }
    }
    chunkBlocks.set(owner, owned);
    loadedChunkKeys.add(owner);
  }
  let streamingCenterKey = chunkKey(initialChunkPlan.center.x, initialChunkPlan.center.z);
  let mobStreamingCenterX = (initialChunkPlan.center.x + 0.5) * WORLD_CHUNK_SIZE;
  let mobStreamingCenterZ = (initialChunkPlan.center.z + 0.5) * WORLD_CHUNK_SIZE;
  sampleDayNight(worldTimeMs, dayNightConfig, dayNightState);
  updateActiveTorchLights(0, [pose.x, pose.y + 1.2, pose.z]);

  function cachedMobDirectSky(_kind: unknown, x: number, y: number, z: number): boolean {
    return skyEcologyExposureLevel(skyOccluderColumns, Math.floor(x), Math.floor(y), Math.floor(z))
      === SKY_EXPOSURE_LEVELS;
  }

  function cachedMobLocalLight(_kind: unknown, x: number, y: number, z: number): number {
    return sampleCachedMobLocalLight(
      skyEcologyExposureLevel(skyOccluderColumns, Math.floor(x), Math.floor(y), Math.floor(z)),
      dayNightState.sunIntensity,
      mobTorchColumns,
      mobTorchRevision,
      mobTorchCache,
      x,
      y,
      z,
    );
  }

  function getBlock(x: number, y: number, z: number): BlockId {
    if (y < TERRAIN_MIN_Y) return BLOCK.STONE;
    return blocks.get(blockKey(x, y, z)) ?? BLOCK.AIR;
  }

  function caveSpawnY(kind: keyof typeof MOB_DEFINITIONS, x: number, surfaceY: number, z: number): number | null {
    const clearCells = Math.max(1, Math.ceil(MOB_DEFINITIONS[kind].height));
    for (let y = surfaceY - 2; y > TERRAIN_MIN_Y; y -= 1) {
      if (!blockSupportsPlayerFeet(getBlock(x, y - 1, z))) continue;
      let clear = true;
      for (let offset = 0; offset < clearCells; offset += 1) {
        if (getBlock(x, y + offset, z) !== BLOCK.AIR) { clear = false; break; }
      }
      if (clear) return y;
    }
    return null;
  }

  function localMobSpawnPosition(
    kind: keyof typeof MOB_DEFINITIONS,
    x: number,
    surfaceY: number,
    z: number,
    attempt: number,
  ): readonly [number, number, number] {
    if (MOB_DEFINITIONS[kind].passive || (attempt & 1) !== 0) return [x, surfaceY, z];
    // Hostile surface candidates remain useful at night, but every other
    // attempt searches a bounded neighborhood for an enclosed floor. Searching
    // nearby columns matters because a cave seldom sits under the exact random
    // surface coordinate chosen by the population sampler.
    const offsetSeed = attempt % 9;
    for (let sample = 0; sample < 25; sample += 1) {
      const index = (sample + offsetSeed) % 25;
      const dx = index % 5 - 2;
      const dz = Math.floor(index / 5) - 2;
      const caveX = x + dx;
      const caveZ = z + dz;
      if (!loadedChunkKeys.has(chunkKeyForBlock(caveX, caveZ))) continue;
      const caveY = caveSpawnY(kind, caveX, terrainHeight(caveX, caveZ, seed) + 1, caveZ);
      if (caveY !== null) return [caveX, caveY, caveZ];
    }
    return [x, surfaceY, z];
  }

  function findNearestCave(): readonly [number, number, number] | null {
    const originX = Math.floor(pose.x);
    const originY = Math.floor(pose.y);
    const originZ = Math.floor(pose.z);
    let bestX = 0;
    let bestY = 0;
    let bestZ = 0;
    let bestDistanceSquared = Infinity;
    let fallbackX = 0;
    let fallbackY = 0;
    let fallbackZ = 0;
    let fallbackDistanceSquared = Infinity;
    const radius = Math.max(32, streamingChunkRadius * WORLD_CHUNK_SIZE);
    for (let x = originX - radius; x <= originX + radius; x += 1) {
      for (let z = originZ - radius; z <= originZ + radius; z += 1) {
        if (!loadedChunkKeys.has(chunkKeyForBlock(x, z))) continue;
        const horizontalSquared = (x - originX) ** 2 + (z - originZ) ** 2;
        if (horizontalSquared > radius * radius || horizontalSquared >= bestDistanceSquared) continue;
        const surfaceY = terrainHeight(x, z, seed) + 1;
        for (let y = surfaceY - 2; y > TERRAIN_MIN_Y; y -= 1) {
          if (getBlock(x, y, z) !== BLOCK.AIR
            || !blockSupportsPlayerFeet(getBlock(x, y - 1, z))
            || skyEcologyExposureLevel(skyOccluderColumns, x, y + 1, z) !== 0) continue;
          const distanceSquared = horizontalSquared + (y - originY) ** 2;
          if (distanceSquared < fallbackDistanceSquared) {
            fallbackDistanceSquared = distanceSquared;
            fallbackX = x;
            fallbackY = y;
            fallbackZ = z;
          }
          if (getBlock(x, y + 1, z) !== BLOCK.AIR) continue;
          if (distanceSquared >= bestDistanceSquared) continue;
          bestDistanceSquared = distanceSquared;
          bestX = x;
          bestY = y;
          bestZ = z;
        }
      }
    }
    if (Number.isFinite(bestDistanceSquared)) return [bestX, bestY, bestZ];
    return Number.isFinite(fallbackDistanceSquared) ? [fallbackX, fallbackY, fallbackZ] : null;
  }
  const chunkMeshes = new Map<string, ChunkMesh>();
  const visibleMeshes: ChunkMesh[] = [];
  const transparentMeshes: ChunkMesh[] = [];
  const mobRenderer = createMobRenderer(gl);
  const localMobStreaming = !options.onMobAttack;
  const mobPopulationOptions: MobSpawnOptions = {
    seed,
    radius: localMobStreaming ? LOCAL_MOB_STREAM_SPAWN_RADIUS : Math.max(6, radius - 2),
    centerX: localMobStreaming ? mobStreamingCenterX : 0,
    centerZ: localMobStreaming ? mobStreamingCenterZ : 0,
    terrainHeight: (x, z) => terrainHeight(x, z, seed),
    resolveSpawnPosition: localMobSpawnPosition,
    passivePopulation: clampNumber(Math.floor(radius / 2), 6, 12),
    hostilePopulation: clampNumber(Math.floor(radius / 5), 2, 5),
    maxPopulation: 17,
    spawnClearRadius: localMobStreaming ? LOCAL_MOB_STREAM_CLEAR_RADIUS : 6,
    localLight: cachedMobLocalLight,
    isSpawnable: (_kind: unknown, x: number, y: number, z: number) => (!localMobStreaming || (
      loadedChunkKeys.has(chunkKeyForBlock(x, z))
      && isLocalMobSpawnOutsideView(pose.x, pose.z, pose.yaw, x, z)
    ))
      && !blocks.has(blockKey(x, y, z)) && !blocks.has(blockKey(x, y + 1, z)),
  };
  const mobSimulation = createMobSimulation(createMobSpawns(mobPopulationOptions));
  let mobIds = listMobIds(mobSimulation);
  let mobCombatServerTimeOffsetMs = serverTimeOffsetMs;
  let sharedMobMotionActive = false;
  let sharedMobMotionAppliedAt = 0;
  let sharedMobMotionIntervalMs = 200;
  const mobSnapshots: MobPoseSnapshot[] = [];
  const mobProjectileSnapshots: MobProjectileSnapshot[] = [];
  const localCreeperExplosions: LocalCreeperExplosionEvent[] = [];
  const velocity: Vec3 = [0, 0, 0];
  const knockbackVelocity: Vec3 = [0, 0, 0];
  const knockbackReceipts = new Set<string>();
  const mobKnockbackReceipts = new Set<string>();
  const mobKnockbackReactions = new Map<string, MobKnockbackReaction>();
  const contactDamageSources: MobDamageSource[] = [];
  const projectileDamageSources: MobDamageSource[] = [];
  let knockbackReadyAtMs = 0;
  const keys = new Set<string>();
  let creativeFlight = createCreativeFlightTapState();
  let sprintControls: SprintControlState = RELEASED_SPRINT_CONTROLS;
  let selectedBlock = options.selectedBlock ?? BLOCK.DIRT;
  let selectedItem = options.selectedItem ?? null;
  let firstPersonFeedbackHidden = false;
  let cameraMode: PlayerCameraMode = "first_person";
  let firstPersonBowPreviewDrawn: boolean | null = null;
  setFirstPersonHeldItem(selectedItem, selectedBlock);
  let worldVertexCount = 0;
  let remoteVertexCount = 0;
  let nameplateVertexCount = 0;
  const remoteStates = new Map<string, RemoteAvatarMotion>();
  let target: BlockTarget | null = null;
  let targetOutlineVertexCount = 0;
  let running = false;
  let destroyed = false;
  let paused = false;
  let pausedStartedAt = 0;
  let pausedVisualTime = 0;
  let lastPausedRenderAt = Number.NEGATIVE_INFINITY;
  let frameId = 0;
  let lastFrame = 0;
  let localMobAttackReadyAt = 0;
  let lastPoseSent = 0;
  let poseDirty = true;
  let grounded = false;
  let fallAirborne = false;
  let fallPeakY = pose.y;
  let movementMode: PlayerMovementMode = "idle";
  let movementActivity = 0.5;
  let playerViewSuspended = false;
  const cameraPosture: PlayerPostureTargets = {
    eyeHeight: STANDING_EYE_HEIGHT,
    bodyHeight: STANDING_BODY_HEIGHT,
    fovRadians: movementFovRadians("idle", options.getFieldOfViewRadians?.()),
  };
  const cameraPostureTarget: PlayerPostureTargets = { ...cameraPosture };
  const cameraBob = createHeadBobState();
  const interactionBob: HeadBobOffsets = { x: 0, y: 0 };
  const horizontalMovementDelta = { x: 0, z: 0 };
  let miningTimer = 0;
  let miningStartedAt = 0;
  let miningDurationMs = 0;
  let miningProgress = 0;
  let crackVertexCount = 0;
  const crackLines: number[] = [];
  let rangedChargeStartedAt = 0;
  let lastRangedChargeFeedbackAt = -Infinity;
  let lastMiningProgressAt = -Infinity;
  let lastMiningHitAt = -Infinity;
  let primaryActionHold: PrimaryActionHoldState = { ...IDLE_PRIMARY_ACTION_HOLD };
  let secondaryPlacementHold: Readonly<SecondaryPlacementHoldState> = IDLE_SECONDARY_PLACEMENT_HOLD;
  let secondaryButtonHeld = false;
  let footstepDistance = 0;
  const frameTimes: number[] = [];
  let totalMeshRebuildMs = 0;
  let lastMeshRebuildMs = 0;
  let lastRebuiltChunkCount = 0;
  let totalRebuiltChunkCount = 0;
  let visibleChunkCount = 0;
  let drawCalls = 0;
  let avatarDrawCalls = 0;
  let mobDrawCalls = 0;
  let droppedItemDrawCalls = 0;
  let droppedItemVertexCount = 0;
  let droppedItemVisibleCount = 0;
  let playerProjectileVertexCount = 0;
  let primedTntVertexCount = 0;
  let primedTntVisibleCount = 0;
  let primedTntUploadBytes = 0;
  let particleDrawCalls = 0;
  let particleVertexCount = 0;
  let particleUploadBytes = 0;
  let mobVertexCount = 0;
  let visibleMobCount = 0;
  let lastMobSimulationMs = 0;
  let mobAccumulatorSeconds = 0;
  let localMobHabitatRefreshSeconds = 0;
  const mobStepSeconds = 0.1;
  let playerHealth = PLAYER_MAX_HEALTH;
  let lastPerformanceSent = 0;
  let firstPersonSkyExposure = 1;
  let firstPersonExposureBlockX = Infinity;
  let firstPersonExposureBlockY = Infinity;
  let firstPersonExposureBlockZ = Infinity;
  let firstPersonExposureDirty = true;
  const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

  function emitHandAction(action: "mine" | "attack" | "place" | "use"): void {
    triggerFirstPersonAction(action, performance.now());
    options.onHandAction?.(action);
  }

  function clearMining(): void {
    if (miningTimer) window.clearTimeout(miningTimer);
    miningTimer = 0;
    miningStartedAt = 0;
    miningDurationMs = 0;
    miningProgress = 0;
    crackVertexCount = 0;
    lastMiningHitAt = -Infinity;
  }

  function cancelPrimaryActionHold(): void {
    primaryActionHold = releasePrimaryAction();
    clearMining();
  }

  function cancelSecondaryPlacementHold(releaseButton = false): void {
    secondaryPlacementHold = releaseSecondaryPlacement();
    if (releaseButton) secondaryButtonHeld = false;
  }

  function clearHeldMovementInput(): void {
    keys.clear();
    sprintControls = RELEASED_SPRINT_CONTROLS;
    creativeFlight.lastSpaceTapAt = -Infinity;
  }

  function updateMiningCrackGeometry(): void {
    crackLines.length = 0;
    crackVertexCount = target
      ? appendWorldBlockCrackLines(crackLines, target.block,
        miningProgress,
        blockCollisionHeight(target.block.block),
      )
      : 0;
    if (!crackVertexCount) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, crackBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(crackLines), gl.DYNAMIC_DRAW);
  }

  function beginHeldBlockMining(): boolean {
    if (!primaryActionHold.held || !primaryActionHold.miningArmed || miningTimer || !target) return false;
    const mined = { ...target.block };
    const targetPrimed = primedTnt.has(blockKey(mined.x, mined.y, mined.z));
    const editAllowed = options.canEditBlock?.() !== false && options.canMineBlock?.(mined) !== false;
    if (!shouldStartHeldMining(primaryActionHold, {
      pointerLocked: document.pointerLockElement === canvas,
      playerAlive: playerHealth > 0,
      miningActive: miningTimer !== 0,
      targetAvailable: true,
      editAllowed,
      targetPrimed,
    })) return false;
    const duration = Math.max(0, options.getMiningDuration?.(mined.block) ?? 0);
    emitHandAction("mine");
    if (duration === 0) {
      emitEdit({ x: mined.x, y: mined.y, z: mined.z, block: BLOCK.AIR });
      return true;
    }
    miningStartedAt = performance.now();
    miningDurationMs = duration * 1_000;
    lastMiningProgressAt = -Infinity;
    lastMiningHitAt = miningStartedAt;
    miningProgress = 0.01;
    updateMiningCrackGeometry();
    miningTimer = window.setTimeout(() => {
      miningTimer = 0;
      miningStartedAt = 0;
      miningDurationMs = 0;
      miningProgress = 0;
      crackVertexCount = 0;
      if (getBlock(mined.x, mined.y, mined.z) === mined.block) {
        emitEdit({ x: mined.x, y: mined.y, z: mined.z, block: BLOCK.AIR });
      }
    }, duration * 1_000);
    return true;
  }

  function clearRangedCharge(cancelServer = false): void {
    const hadCharge = rangedChargeStartedAt > 0;
    if (hadCharge) options.onRangedChargeChange?.(false, 0);
    rangedChargeStartedAt = 0;
    lastRangedChargeFeedbackAt = -Infinity;
    if (hadCharge && cancelServer) void options.onRangedCancel?.();
  }

  function updateTargetOutlineGeometry(): void {
    targetOutlineVertexCount = target ? writeTargetOutlineGeometry(targetOutlineGeometry, target) : 0;
    if (!targetOutlineVertexCount) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, targetOutlineGeometry);
  }

  function getStoredBedAt(x: number, y: number, z: number): BedStructure | null {
    const owner = bedCellOwners.get(bedCellKey({ x, y, z }));
    const bed = owner ? bedStructures.get(owner) : null;
    return bed ? createBedStructure(bed.foot, bed.direction) : null;
  }

  function registerBedStructure(bed: Readonly<BedStructure>): void {
    const canonical = createBedStructure(bed.foot, bed.direction);
    const owner = bedStructureKey(canonical);
    bedStructures.set(owner, canonical);
    bedCellOwners.set(bedCellKey(canonical.foot), owner);
    bedCellOwners.set(bedCellKey(canonical.head), owner);
  }

  function unregisterBedStructure(bed: Readonly<BedStructure>): void {
    bedStructures.delete(bedStructureKey(bed));
    bedCellOwners.delete(bedCellKey(bed.foot));
    bedCellOwners.delete(bedCellKey(bed.head));
  }

  function commitWorldEditBatch(
    edits: readonly WorldEdit[],
    loadedOnly = false,
    afterAccepted?: () => void,
  ): WorldEdit[] | null {
    const [batch, removedBeds] = options.twoBlockBeds
      ? reconcileBedEditBatch(edits, getStoredBedAt)
      : [edits.map((edit) => ({ ...edit })), []] as const;
    if (batch.length && options.acceptWorldEdits?.(batch) === false) return null;
    const loadedEdits: WorldEdit[] = [];
    const skyEdits: WorldEdit[] = [];
    for (const next of batch) {
      rememberWorldEdit(next);
      if (loadedOnly && !loadedChunkKeys.has(chunkKeyForBlock(next.x, next.z))) continue;
      if (setBlock(next.x, next.y, next.z, next.block)) skyEdits.push(next);
      loadedEdits.push(next);
    }
    for (const bed of removedBeds) unregisterBedStructure(bed);
    afterAccepted?.();
    if (loadedEdits.length) rebuildEditedWorldChunks(loadedEdits, skyEdits);
    return batch;
  }

  function rememberWorldEdit(edit: WorldEdit): void {
    const owner = chunkKeyForBlock(edit.x, edit.z);
    let chunkEdits = rememberedEditsByChunk.get(owner);
    if (!chunkEdits) {
      chunkEdits = new Map<string, WorldEdit>();
      rememberedEditsByChunk.set(owner, chunkEdits);
    }
    chunkEdits.set(blockKey(edit.x, edit.y, edit.z), { ...edit });
  }

  function loadTerrainChunk(chunkX: number, chunkZ: number): void {
    const owner = chunkKey(chunkX, chunkZ);
    if (loadedChunkKeys.has(owner)) return;
    const materialized = materializeTerrainChunk(
      seed,
      chunkX,
      chunkZ,
      rememberedEditsByChunk.get(owner)?.values() ?? [],
    );
    writeChunkSkyOccluders(skyOccluderColumns, chunkX, chunkZ, materialized);
    const owned = new Set<string>();
    for (const [key, block] of materialized) {
      blocks.set(key, block);
      owned.add(key);
      if (block === BLOCK.TORCH) {
        const [x, y, z] = key.split(",").map(Number);
        addTorchLight(key, x, y, z);
      }
    }
    chunkBlocks.set(owner, owned);
    loadedChunkKeys.add(owner);
  }

  function unloadTerrainChunk(chunkX: number, chunkZ: number): void {
    const owner = chunkKey(chunkX, chunkZ);
    if (!loadedChunkKeys.has(owner)) return;
    const mesh = chunkMeshes.get(owner);
    if (mesh) {
      worldVertexCount -= mesh.vertexCount;
      if (mesh.textureBuffer) gl.deleteBuffer(mesh.textureBuffer);
      if (mesh.transparentBuffer) gl.deleteBuffer(mesh.transparentBuffer);
      if (mesh.colorBuffer) gl.deleteBuffer(mesh.colorBuffer);
      chunkMeshes.delete(owner);
    }
    for (const key of chunkBlocks.get(owner) ?? []) {
      blocks.delete(key);
      removeTorchLight(key);
    }
    chunkBlocks.delete(owner);
    removeChunkSkyOccluders(skyOccluderColumns, chunkX, chunkZ);
    loadedChunkKeys.delete(owner);
  }

  function markChunkAndNeighbors(target: Set<string>, chunkX: number, chunkZ: number): void {
    // The face pass only needs cardinal seams, while the two-column exposure
    // fringe can cross a corner. The fixed 3x3 chunk neighborhood covers both.
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) target.add(chunkKey(chunkX + dx, chunkZ + dz));
    }
  }

  function updateStreamingWindow(force = false): void {
    const nextCenterKey = chunkKeyForBlock(pose.x, pose.z);
    if (!force && nextCenterKey === streamingCenterKey) return;
    const plan = planChunkWindow(
      pose.x,
      pose.z,
      loadedChunkKeys,
      streamingChunkRadius,
      WORLD_CHUNK_SIZE,
      MAX_LOCAL_STREAMING_CHUNK_RADIUS,
    );
    streamingCenterKey = chunkKey(plan.center.x, plan.center.z);
    if (!plan.load.length && !plan.unload.length) return;

    const dirty = new Set<string>();
    for (const coordinate of plan.unload) {
      markChunkAndNeighbors(dirty, coordinate.x, coordinate.z);
      unloadTerrainChunk(coordinate.x, coordinate.z);
    }
    for (const coordinate of plan.load) {
      loadTerrainChunk(coordinate.x, coordinate.z);
      markChunkAndNeighbors(dirty, coordinate.x, coordinate.z);
    }
    for (const key of dirty) {
      if (loadedChunkKeys.has(key)) pendingChunkMeshRebuilds.add(key);
    }
    invalidateMobTorchLightCache();
    if (localMobStreaming && !sharedMobMotionActive) {
      mobStreamingCenterX = (plan.center.x + 0.5) * WORLD_CHUNK_SIZE;
      mobStreamingCenterZ = (plan.center.z + 0.5) * WORLD_CHUNK_SIZE;
      reconcileLocalMobStreaming(mobSimulation, createMobSpawns({
        ...mobPopulationOptions,
        centerX: mobStreamingCenterX,
        centerZ: mobStreamingCenterZ,
      }), mobStreamingCenterX, mobStreamingCenterZ, LOCAL_MOB_STREAM_RETAIN_RADIUS);
      mobIds = listMobIds(mobSimulation);
    }
  }

  function setBlock(x: number, y: number, z: number, block: BlockId): boolean {
    const key = blockKey(x, y, z);
    const owner = chunkKeyForBlock(x, z);
    const previous = blocks.get(key) ?? BLOCK.AIR;
    if (previous === BLOCK.TNT && block !== BLOCK.TNT && primedTnt.delete(key)) {
      mobRenderer.setLocalPrimedTnt(x, y, z, false);
    }
    if (previous === BLOCK.TORCH) removeTorchLight(key);
    if (block === BLOCK.AIR) {
      blocks.delete(key);
      const owned = chunkBlocks.get(owner);
      owned?.delete(key);
    } else {
      blocks.set(key, block);
      if (block === BLOCK.TORCH) addTorchLight(key, x, y, z);
      if (previous === BLOCK.AIR) {
        let owned = chunkBlocks.get(owner);
        if (!owned) {
          owned = new Set<string>();
          chunkBlocks.set(owner, owned);
        }
        owned.add(key);
      }
    }
    return previous !== block && skyOccluderClass(previous) !== skyOccluderClass(block);
  }

  function rebuildEditedWorldChunks(
    faceEdits: readonly WorldEdit[],
    skyEdits: readonly WorldEdit[],
  ): void {
    const dirty = new Set(dirtyChunkKeysForEdits(faceEdits));
    if (skyEdits.length) {
      refreshEditedSkyColumns(skyOccluderColumns, skyEdits, getBlock);
      firstPersonExposureDirty = true;
      for (const key of skyExposureDirtyChunkKeysForEdits(skyEdits)) dirty.add(key);
    }
    rebuildWorldChunks([...dirty].filter((key) => loadedChunkKeys.has(key)));
  }

  function rebuildChunkMesh(chunkKey: string): void {
    const coordinate = parseChunkKey(chunkKey);
    const textureVertices: number[] = [];
    const transparentVertices: number[] = [];
    const colorVertices: number[] = [];
    const specialVertices = { textured: textureVertices, color: colorVertices };
    let minY = Infinity;
    let maxY = -Infinity;
    for (const key of chunkBlocks.get(chunkKey) ?? []) {
      const block = blocks.get(key);
      if (block === undefined || block === BLOCK.AIR) continue;
      if (block === BLOCK.TNT && primedTnt.has(key)) continue;
      const [x, y, z] = key.split(",").map(Number);
      minY = Math.min(minY, y);
      maxY = Math.max(
        maxY,
        y + (
          isDoorBlock(block)
            ? 1.9
            : block === BLOCK.OAK_FENCE || isOakFenceGateBlock(block)
              ? OAK_FENCE_HEIGHT
              : blockCollisionHeight(block)
        ),
      );
      if (block === BLOCK.TORCH) {
        appendSpecialTorchMesh(
          specialVertices,
          x,
          y,
          z,
          blockMaterialVariation(x, y, z),
          skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        continue;
      }
      if (block === BLOCK.CHEST) {
        const start = colorVertices.length;
        appendSpecialChestMesh(
          specialVertices,
          x,
          y,
          z,
          blockMaterialVariation(x, y, z),
          skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        packColorVerticesForSky(
          colorVertices, start, skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        continue;
      }
      if (isDoorBlock(block)) {
        const start = colorVertices.length;
        appendSpecialDoorMesh(
          specialVertices,
          x,
          y,
          z,
          block === BLOCK.DOOR_OPEN,
          blockMaterialVariation(x, y, z),
          skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        packColorVerticesForSky(
          colorVertices, start, skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        continue;
      }
      if (block === BLOCK.BED) {
        const start = colorVertices.length;
        const bed = getStoredBedAt(x, y, z);
        const isFoot = bed ? bedCellKey(bed.foot) === blockKey(x, y, z) : false;
        const footLoaded = bed ? blocks.get(bedCellKey(bed.foot)) === BLOCK.BED : false;
        appendSpecialBedMesh(
          specialVertices,
          bed && !isFoot && !footLoaded ? bed.foot.x : x,
          bed && !isFoot && !footLoaded ? bed.foot.y : y,
          bed && !isFoot && !footLoaded ? bed.foot.z : z,
          bed ? (isFoot || !footLoaded ? "foot" : "head") : "single",
          bed?.direction ?? "north",
          blockMaterialVariation(x, y, z),
          skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        packColorVerticesForSky(
          colorVertices, start, skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        continue;
      }
      if (block === BLOCK.LADDER) {
        appendSpecialLadderMesh(
          specialVertices,
          x,
          y,
          z,
          blockMaterialVariation(x, y, z),
          skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        continue;
      }
      if (block === BLOCK.SAPLING) {
        const exposure = skyExposureLevel(skyOccluderColumns, x, y + 1, z);
        appendSaplingMesh(textureVertices, x, y, z, blockMaterialVariation(x, y, z), exposure);
        continue;
      }
      if (block === BLOCK.OAK_FENCE) {
        appendOakFenceMesh(
          textureVertices,
          x,
          y,
          z,
          oakFenceConnections(x, y, z, getBlock),
          blockMaterialVariation(x, y, z),
          skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        continue;
      }
      if (isOakFenceGateBlock(block)) {
        appendOakFenceGateMesh(
          textureVertices,
          x,
          y,
          z,
          block === BLOCK.OAK_FENCE_GATE_OPEN,
          blockMaterialVariation(x, y, z),
          skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        continue;
      }
      if (block === BLOCK.STONE_BRICK_SLAB) {
        appendStoneBrickSlabMesh(
          textureVertices,
          x,
          y,
          z,
          blockMaterialVariation(x, y, z),
          getBlock,
          skyExposureLevel(skyOccluderColumns, x, y + 1, z),
        );
        continue;
      }
      const base = blockMaterialColor(block) as Vec3;
      const variation = blockMaterialVariation(x, y, z);
      for (const face of FACE_DEFS) {
        const neighbor = getBlock(x + face[1], y + face[2], z + face[3]);
        if (blockFaceIsOccluded(block, neighbor)) continue;
        const textureName = blockTextureForFace(block, face[0]);
        if (textureName) {
          appendTexturedBlockFace(
            block === BLOCK.GLASS ? transparentVertices : textureVertices,
            x,
            y,
            z,
            face,
            textureName,
            face[4] * variation,
            skyExposureLevel(
              skyOccluderColumns,
              x + face[1],
              y + face[2],
              z + face[3],
            ),
            textureName === "furnace_front",
          );
          continue;
        }
        const color = tint(base, face[4], variation);
        for (const point of face[5]) pushVertex(colorVertices, [x + point[0], y + point[1], z + point[2]], color);
      }
    }
    const previous = chunkMeshes.get(chunkKey);
    worldVertexCount -= previous?.vertexCount ?? 0;
    if (textureVertices.length === 0 && transparentVertices.length === 0 && colorVertices.length === 0) {
      if (previous?.textureBuffer) gl.deleteBuffer(previous.textureBuffer);
      if (previous?.transparentBuffer) gl.deleteBuffer(previous.transparentBuffer);
      if (previous?.colorBuffer) gl.deleteBuffer(previous.colorBuffer);
      chunkMeshes.delete(chunkKey);
      return;
    }
    let textureBuffer = previous?.textureBuffer ?? null;
    if (textureVertices.length) {
      textureBuffer ??= gl.createBuffer();
      if (!textureBuffer) throw new Error("Unable to allocate a textured chunk mesh buffer.");
      gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureVertices), gl.STATIC_DRAW);
    } else if (textureBuffer) {
      gl.deleteBuffer(textureBuffer);
      textureBuffer = null;
    }
    let transparentBuffer = previous?.transparentBuffer ?? null;
    if (transparentVertices.length) {
      transparentBuffer ??= gl.createBuffer();
      if (!transparentBuffer) throw new Error("Unable to allocate a transparent chunk mesh buffer.");
      gl.bindBuffer(gl.ARRAY_BUFFER, transparentBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(transparentVertices), gl.STATIC_DRAW);
    } else if (transparentBuffer) {
      gl.deleteBuffer(transparentBuffer);
      transparentBuffer = null;
    }
    let colorBuffer = previous?.colorBuffer ?? null;
    if (colorVertices.length) {
      colorBuffer ??= gl.createBuffer();
      if (!colorBuffer) throw new Error("Unable to allocate a color chunk mesh buffer.");
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colorVertices), gl.STATIC_DRAW);
    } else if (colorBuffer) {
      gl.deleteBuffer(colorBuffer);
      colorBuffer = null;
    }
    const textureVertexCount = textureVertices.length / TEXTURED_WORLD_VERTEX_FLOATS;
    const transparentVertexCount = transparentVertices.length / TEXTURED_WORLD_VERTEX_FLOATS;
    const colorVertexCount = colorVertices.length / 6;
    const vertexCount = textureVertexCount + transparentVertexCount + colorVertexCount;
    chunkMeshes.set(chunkKey, {
      key: chunkKey,
      textureBuffer,
      textureVertexCount,
      transparentBuffer,
      transparentVertexCount,
      colorBuffer,
      colorVertexCount,
      vertexCount,
      centerX: (coordinate.x + 0.5) * WORLD_CHUNK_SIZE,
      centerZ: (coordinate.z + 0.5) * WORLD_CHUNK_SIZE,
      transparentDistanceSquared: 0,
      minY,
      maxY,
    });
    worldVertexCount += vertexCount;
  }

  function rebuildWorldChunks(keys: readonly string[]): void {
    const uniqueKeys = [...new Set(keys)];
    const startedAt = performance.now();
    for (const key of uniqueKeys) {
      pendingChunkMeshRebuilds.delete(key);
      rebuildChunkMesh(key);
    }
    lastMeshRebuildMs = performance.now() - startedAt;
    totalMeshRebuildMs += lastMeshRebuildMs;
    lastRebuiltChunkCount = uniqueKeys.length;
    totalRebuiltChunkCount += uniqueKeys.length;
  }

  function processPendingChunkMeshes(limit = STREAMING_MESH_REBUILDS_PER_FRAME): void {
    if (!pendingChunkMeshRebuilds.size) return;
    const batch: string[] = [];
    for (const key of pendingChunkMeshRebuilds) {
      pendingChunkMeshRebuilds.delete(key);
      if (!loadedChunkKeys.has(key)) continue;
      batch.push(key);
      if (batch.length >= limit) break;
    }
    if (batch.length) rebuildWorldChunks(batch);
  }

  function collides(x: number, y: number, z: number, bodyHeight = cameraPosture.bodyHeight): boolean {
    const halfWidth = 0.29;
    const minX = Math.floor(x - halfWidth);
    const maxX = Math.floor(x + halfWidth);
    const minY = Math.floor(y + 0.001);
    const maxY = Math.floor(y + Math.max(0.1, bodyHeight) - 0.01);
    const minZ = Math.floor(z - halfWidth);
    const maxZ = Math.floor(z + halfWidth);
    for (let bx = minX; bx <= maxX; bx += 1) {
      for (let by = minY; by <= maxY; by += 1) {
        for (let bz = minZ; bz <= maxZ; bz += 1) {
          const block = getBlock(bx, by, bz);
          if (blockHasCollision(block) && playerIntersectsBlockCollisionHeight(y, bodyHeight, by, block)) return true;
          if (by > 0 && getBlock(bx, by - 1, bz) === BLOCK.DOOR_CLOSED) return true;
          if (getBlock(bx, by - 1, bz) === BLOCK.OAK_FENCE
            && playerIntersectsOakFenceHeight(y, bodyHeight, by - 1)) return true;
          if (getBlock(bx, by - 1, bz) === BLOCK.OAK_FENCE_GATE_CLOSED
            && playerIntersectsOakFenceHeight(y, bodyHeight, by - 1)) return true;
        }
      }
    }
    return false;
  }

  /** A sneaking player may hang their toes over an edge but never move until their whole footprint is unsupported. */
  function hasGroundSupport(x: number, y: number, z: number): boolean {
    const sampleY = Math.floor(y - 0.08);
    for (const xOffset of [-0.26, 0.26]) {
      for (const zOffset of [-0.26, 0.26]) {
        const block = getBlock(Math.floor(x + xOffset), sampleY, Math.floor(z + zOffset));
        if (blockHasCollision(block) && blockSupportsPlayerFeet(block, sampleY, y)) return true;
      }
    }
    return false;
  }

  function moveHorizontalAxis(axis: 0 | 2, amount: number, protectLedge: boolean): boolean {
    if (!protectLedge || amount === 0) return moveAxis(axis, amount);
    const initial = axis === 0 ? pose.x : pose.z;
    const safeAmount = clampSneakAxisMovement(amount, (offset) => {
      const x = axis === 0 ? initial + offset : pose.x;
      const z = axis === 2 ? initial + offset : pose.z;
      return hasGroundSupport(x, pose.y, z);
    });
    return moveAxis(axis, safeAmount);
  }

  function cameraEye(out: Vec3 = [0, 0, 0]): Vec3 {
    writePlayerEye(pose.x, pose.y, pose.z, pose.yaw, cameraPosture.eyeHeight, cameraBob, playerEyeForCamera);
    direction(playerFacingForCamera);
    writePlayerCamera(
      out,
      renderFacing,
      cameraMode,
      playerEyeForCamera,
      playerFacingForCamera,
      (x, y, z) => {
        const blockY = Math.floor(y);
        const block = getBlock(Math.floor(x), blockY, Math.floor(z));
        return blockHasCollision(block) && blockContainsSolidPoint(block, blockY, y);
      },
    );
    return out;
  }

  /** Interaction bob is visual-only so Lakebed's bounded posture validator sees the same ray origin. */
  function interactionEye(out: Vec3 = [0, 0, 0]): Vec3 {
    const eyeHeight = postureTargetsForMovement(movementMode).eyeHeight;
    return writePlayerEye(pose.x, pose.y, pose.z, pose.yaw, eyeHeight, interactionBob, out);
  }

  function resetMovementView(): void {
    const mustRemainSneaking = collides(pose.x, pose.y, pose.z, STANDING_BODY_HEIGHT);
    movementMode = mustRemainSneaking ? "sneak" : "idle";
    movementActivity = 0.5;
    resetHeadBob(cameraBob);
    cameraPosture.eyeHeight = mustRemainSneaking ? postureTargetsForMovement("sneak").eyeHeight : STANDING_EYE_HEIGHT;
    cameraPosture.bodyHeight = mustRemainSneaking ? postureTargetsForMovement("sneak").bodyHeight : STANDING_BODY_HEIGHT;
    cameraPosture.fovRadians = movementFovRadians(movementMode, options.getFieldOfViewRadians?.());
    options.onMovementModeChange?.(movementMode, 0.5);
  }

  function clearPlayerMotion(resetView = true): void {
    velocity[0] = velocity[1] = velocity[2] = 0;
    knockbackVelocity[0] = knockbackVelocity[2] = 0;
    clearHeldMovementInput();
    if (resetView) resetMovementView();
  }

  function moveAxis(axis: 0 | 1 | 2, amount: number): boolean {
    if (amount === 0) return false;
    const values: Vec3 = [pose.x, pose.y, pose.z];
    const initial = values[axis];
    values[axis] += amount;
    if (!collides(values[0], values[1], values[2])) {
      pose.x = values[0]; pose.y = values[1]; pose.z = values[2];
      poseDirty = true;
      return false;
    }
    let safe = initial;
    let blocked = values[axis];
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const midpoint = (safe + blocked) / 2;
      values[axis] = midpoint;
      if (collides(values[0], values[1], values[2])) blocked = midpoint;
      else safe = midpoint;
    }
    values[axis] = safe;
    pose.x = values[0]; pose.y = values[1]; pose.z = values[2];
    if (Math.abs(safe - initial) > 0.00001) poseDirty = true;
    return true;
  }

  function direction(out: Vec3 = [0, 0, 0]): Vec3 {
    const cosPitch = Math.cos(pose.pitch);
    out[0] = Math.sin(pose.yaw) * cosPitch;
    out[1] = Math.sin(pose.pitch);
    out[2] = -Math.cos(pose.yaw) * cosPitch;
    return out;
  }

  function mobCanOccupy(_kind: unknown, x: number, y: number, z: number, collisionRadius: number, height: number): boolean {
    const minY = Math.floor(y + 0.01);
    const maxY = Math.floor(y + height - 0.01);
    for (let xSide = -1; xSide <= 1; xSide += 2) {
      const sampleX = x + collisionRadius * xSide;
      for (let zSide = -1; zSide <= 1; zSide += 2) {
        const sampleZ = z + collisionRadius * zSide;
        for (let sampleY = minY; sampleY <= maxY; sampleY += 1) {
          const block = getBlock(Math.floor(sampleX), sampleY, Math.floor(sampleZ));
          if (blockHasCollision(block) && playerIntersectsBlockCollisionHeight(y, height, sampleY, block)) return false;
        }
      }
    }
    return true;
  }

  function applyLocalExplosionEdits(edits: readonly LocalExplosionEdit[]): LocalExplosionEdit[] | null {
    const destruction = edits.filter((edit) => !edit.chainPrimed);
    const committed = commitWorldEditBatch(destruction);
    if (!committed) return null;
    const originals = new Map(destruction.map((edit) => [blockKey(edit.x, edit.y, edit.z), edit]));
    const appliedDestruction: LocalExplosionEdit[] = committed.map((edit) => {
      const original = originals.get(blockKey(edit.x, edit.y, edit.z));
      return original ? { ...original, block: edit.block } : { ...edit, previousBlock: BLOCK.BED };
    });
    for (const edit of appliedDestruction.slice(0, 12)) {
      blockParticles.spawn({ action: "break", block: edit.previousBlock, x: edit.x, y: edit.y, z: edit.z });
    }
    return [...appliedDestruction, ...edits.filter((edit) => edit.chainPrimed)];
  }

  function writeReactiveMobPoseSnapshots(): void {
    writeMobPoseSnapshots(mobSimulation, mobSnapshots);
    for (const snapshot of mobSnapshots) {
      const reaction = mobKnockbackReactions.get(snapshot.id);
      if (!reaction) continue;
      snapshot.x += reaction.offsetX;
      snapshot.z += reaction.offsetZ;
      snapshot.previousX += reaction.previousOffsetX;
      snapshot.previousZ += reaction.previousOffsetZ;
    }
  }

  function advanceMobKnockbackReactions(dt: number): void {
    for (const [mobId, reaction] of mobKnockbackReactions) {
      const mob = mobSimulation.mobs.find((candidate) => candidate.id === mobId);
      if (!mob || (!mob.alive
        && mobSimulation.elapsedSeconds + 1e-9 >= mob.deathUntil)) {
        mobKnockbackReactions.delete(mobId);
        continue;
      }
      const definition = MOB_DEFINITIONS[mob.kind];
      beginMobKnockbackStep(reaction);
      const xStep = stepMobKnockbackAxis(reaction.offsetX, reaction.velocityX, dt, (distance) =>
        !mobCanOccupy(
          mob.kind,
          mob.x + reaction.offsetX + distance,
          mob.y,
          mob.z + reaction.offsetZ,
          definition.collisionRadius,
          definition.height,
        ));
      reaction.offsetX = xStep.offset;
      reaction.velocityX = xStep.velocity;
      const zStep = stepMobKnockbackAxis(reaction.offsetZ, reaction.velocityZ, dt, (distance) =>
        !mobCanOccupy(
          mob.kind,
          mob.x + reaction.offsetX,
          mob.y,
          mob.z + reaction.offsetZ + distance,
          definition.collisionRadius,
          definition.height,
        ));
      reaction.offsetZ = zStep.offset;
      reaction.velocityZ = zStep.velocity;
      if (mobKnockbackReactionSettled(reaction)) mobKnockbackReactions.delete(mobId);
    }
  }

  function applyConfirmedPlayerHitMobKnockback(
    eventId: string,
    mobId: string,
    sourceX: number,
    sourceZ: number,
    damage: number,
  ): boolean {
    if (decideMobKnockback(eventId, mobKnockbackReceipts.has(eventId), !paused) !== "accept") return false;
    const mob = mobSimulation.mobs.find((candidate) => candidate.id === mobId);
    if (!mob?.alive) return false;
    const impulse = resolveMobKnockback(
      sourceX,
      sourceZ,
      mob.x,
      mob.z,
      -Math.sin(mob.yaw),
      Math.cos(mob.yaw),
      damage,
    );
    if (!impulse) return false;
    if (mobKnockbackReceipts.size >= MAX_MOB_KNOCKBACK_RECEIPTS) {
      const oldest = mobKnockbackReceipts.values().next().value;
      if (typeof oldest === "string") mobKnockbackReceipts.delete(oldest);
    }
    mobKnockbackReceipts.add(eventId);
    let reaction = mobKnockbackReactions.get(mobId);
    if (!reaction) {
      if (mobKnockbackReactions.size >= MAX_ACTIVE_MOB_KNOCKBACK_REACTIONS) {
        const oldest = mobKnockbackReactions.keys().next().value;
        if (typeof oldest === "string") mobKnockbackReactions.delete(oldest);
      }
      reaction = createMobKnockbackReaction();
      mobKnockbackReactions.set(mobId, reaction);
    }
    applyMobKnockbackImpulse(reaction, impulse);
    return true;
  }

  function updateMobs(dt: number): void {
    const startedAt = performance.now();
    respawnExpiredAuthoritativeMobs(mobSimulation, Date.now() + mobCombatServerTimeOffsetMs);
    if (sharedMobMotionActive) {
      advanceMobKnockbackReactions(dt);
      writeReactiveMobPoseSnapshots();
      mobProjectileSnapshots.length = 0;
      lastMobSimulationMs = performance.now() - startedAt;
      return;
    }
    mobAccumulatorSeconds = Math.min(0.3, mobAccumulatorSeconds + dt);
    if (localMobStreaming) {
      localMobHabitatRefreshSeconds += dt;
      if (localMobHabitatRefreshSeconds >= 5) {
        localMobHabitatRefreshSeconds %= 5;
        const replacements = createMobSpawns({
          ...mobPopulationOptions,
          centerX: mobStreamingCenterX,
          centerZ: mobStreamingCenterZ,
        });
        refreshLocalHostileHabitats(mobSimulation, replacements, (mob, replacement) => {
          if (!mob.alive || mob.deathUntil > 0 || mob.behavior === "chase" || mob.behavior === "fuse") return false;
          const mobDistance = Math.hypot(mob.x - pose.x, mob.z - pose.z);
          if (mobDistance < 12) return false;
          const currentLight = cachedMobLocalLight(mob.kind, mob.homeX, mob.homeY + 1, mob.homeZ);
          const replacementDistance = Math.hypot(replacement.x - pose.x, replacement.z - pose.z);
          return shouldRefreshLocalHostileHabitat(currentLight, mobDistance, replacementDistance);
        });
      }
    }
    let steps = 0;
    while (mobAccumulatorSeconds >= mobStepSeconds && steps < 3) {
      const isNight = dayNightState.label === "night" || dayNightState.label === "dusk";
      const playerTarget = options.canMobsTargetPlayer?.() === false ? null : pose;
      projectileDamageSources.length = 0;
      stepMobSimulation(mobSimulation, {
        dtSeconds: mobStepSeconds,
        isNight,
        terrainHeight: (x, z) => terrainHeight(x, z, seed),
        player: playerTarget,
        canOccupy: mobCanOccupy,
        isProjectileBlocked: (x, y, z) => {
          const blockY = Math.floor(y);
          const block = getBlock(Math.floor(x), blockY, Math.floor(z));
          return blockHasCollision(block) && blockContainsSolidPoint(block, blockY, y);
        },
        projectileDamageSources,
        localLight: cachedMobLocalLight,
        directSky: cachedMobDirectSky,
        sunIntensity: dayNightState.sunIntensity,
        onFatalDrops: options.onMobDrops,
        worldRadius: localMobStreaming ? LOCAL_MOB_STREAM_RETAIN_RADIUS : radius - 1,
        worldCenterX: localMobStreaming ? mobStreamingCenterX : 0,
        worldCenterZ: localMobStreaming ? mobStreamingCenterZ : 0,
      });
      mobAccumulatorSeconds -= mobStepSeconds;
      steps += 1;
      contactDamageSources.length = 0;
      const contactDamage = playerTarget ? consumeMobContactDamage(
        mobSimulation, pose, mobSimulation.elapsedSeconds, isNight, undefined, contactDamageSources,
      ) : 0;
      const projectileDamage = consumeMobProjectileDamage(mobSimulation);
      if (playerHealth > 0) {
        const incomingDamage = contactDamage + projectileDamage;
        if (incomingDamage > 0 && options.canTakePlayerDamage?.() !== false) {
          const mitigatedDamage = mitigatedPlayerDamage(incomingDamage, options.getPlayerProtection?.() ?? 0);
          const appliedDamage = Math.min(playerHealth, mitigatedDamage);
          playerHealth -= appliedDamage;
          const source = contactDamageSources[0] ?? projectileDamageSources[0];
          if (source) applyConfirmedMobKnockback(
            source.eventId,
            source.x,
            source.z,
            appliedDamage,
            mobSimulation.elapsedSeconds * 1_000,
          );
          options.onPlayerDamage?.(appliedDamage, "mob");
          options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
        }
      }
    }
    for (const explosion of consumeDueLocalCreeperExplosions(mobSimulation, localCreeperExplosions)) {
      const blast = {
        center: { x: explosion.x, y: explosion.y, z: explosion.z },
        radius: CREEPER_EXPLOSION_RADIUS,
      };
      const edits = planLocalCreeperExplosion(
        Math.floor(explosion.x),
        Math.floor(explosion.y),
        Math.floor(explosion.z),
        getBlock,
      );
      const exposure = sampleCreeperExplosionExposure(blast, pose, (cell) =>
        localCreeperExposureBlock(getBlock(cell.x, cell.y, cell.z)));
      const appliedEdits = applyLocalExplosionEdits(edits);
      const rawDamage = resolveCreeperExplosionDamage(blast, pose, exposure);
      const damage = rawDamage > 0
        ? mitigatedPlayerDamage(rawDamage, options.getPlayerProtection?.() ?? 0)
        : 0;
      const appliedDamage = Math.min(playerHealth, damage);
      if (appliedDamage > 0 && options.canTakePlayerDamage?.() !== false) {
        playerHealth -= appliedDamage;
        options.onPlayerDamage?.(appliedDamage, "creeper");
        options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
      }
      options.onLocalCreeperExplosion?.({ ...explosion, damage: appliedDamage, edits: appliedEdits ?? [] });
    }
    advanceMobKnockbackReactions(dt);
    writeReactiveMobPoseSnapshots();
    writeMobProjectileSnapshots(mobSimulation, mobProjectileSnapshots);
    lastMobSimulationMs = performance.now() - startedAt;
  }

  function update(dt: number, now: number): void {
    options.onSimulationStep?.(dt);
    if (playerHealth <= 0) {
      if (!playerViewSuspended) {
        resetMovementView();
        playerViewSuspended = true;
      }
      clearHeldMovementInput();
      velocity[0] = 0;
      velocity[1] = 0;
      velocity[2] = 0;
      cancelPrimaryActionHold();
      cancelSecondaryPlacementHold(true);
      target = null;
      fallAirborne = false;
      fallPeakY = pose.y;
      processPendingChunkMeshes();
      updateMobs(dt);
      return;
    }
    playerViewSuspended = false;
    if (options.canCreativeFly?.() !== true && creativeFlight.flying) {
      creativeFlight = createCreativeFlightTapState();
      velocity[1] = 0;
      fallAirborne = true;
      fallPeakY = pose.y;
    }
    const flying = creativeFlight.flying && options.canCreativeFly?.() === true;
    const forwardInput = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const ladderAtFrameStart = !flying && playerTouchesLadder(pose.x, pose.y, pose.z, getBlock);
    const shiftHeld = keys.has("ShiftLeft") || keys.has("ShiftRight");
    // Standing-clearance reads are only needed on the release edge. The mode
    // then stays sneaking until the full standing body fits again.
    const sneakHeld = resolveSneakIntent(
      flying ? false : shiftHeld,
      movementMode,
      () => collides(pose.x, pose.y, pose.z, STANDING_BODY_HEIGHT),
    );
    const sprintHeld = sprintControlHeld(sprintControls);
    // Once attached, W/S become vertical controls while strafing remains the
    // deliberate way to step off the non-solid ladder.
    const forward = ladderAtFrameStart ? 0 : forwardInput;
    const movement = flying ? resolveCreativeFlightMovement(forward, strafe, sprintHeld) : resolvePlayerMovement({
      forward,
      strafe,
      sprintHeld,
      sneakHeld,
      onLadder: ladderAtFrameStart,
      ladderMotion: ladderAtFrameStart && (
        forwardInput !== 0 || keys.has("Space") || shiftHeld
      ),
      hunger: options.canSprint?.() === false ? 0 : 20,
    });
    if (movement.mode !== movementMode || movement.activityMultiplier !== movementActivity) {
      movementMode = movement.mode;
      movementActivity = movement.activityMultiplier;
      options.onMovementModeChange?.(movementMode, movement.activityMultiplier);
    }
    const postureTarget = postureTargetsForMovement(movementMode);
    cameraPostureTarget.eyeHeight = postureTarget.eyeHeight;
    cameraPostureTarget.bodyHeight = postureTarget.bodyHeight;
    cameraPostureTarget.fovRadians = movementFovRadians(movementMode, options.getFieldOfViewRadians?.());
    smoothPlayerPosture(cameraPosture, cameraPostureTarget, dt, cameraPosture);
    writeHorizontalMovementDelta(pose.yaw, movement, dt, horizontalMovementDelta);
    const dx = horizontalMovementDelta.x;
    const dz = horizontalMovementDelta.z;
    const movementStartX = pose.x;
    const movementStartZ = pose.z;
    const protectLedge = !flying && movementMode === "sneak" && grounded;
    moveHorizontalAxis(0, dx, protectLedge);
    moveHorizontalAxis(2, dz, protectLedge);
    knockbackVelocity[0] = stepPlayerKnockbackAxis(knockbackVelocity[0], dt, (distance) => moveAxis(0, distance));
    knockbackVelocity[2] = stepPlayerKnockbackAxis(knockbackVelocity[2], dt, (distance) => moveAxis(2, distance));
    updateStreamingWindow();
    const touchingLadder = !flying && playerTouchesLadder(pose.x, pose.y, pose.z, getBlock);
    const verticalStartY = pose.y;
    velocity[1] = flying
      ? creativeFlightVerticalVelocity(keys.has("Space"), shiftHeld)
      : ladderVerticalVelocity(
        velocity[1],
        touchingLadder,
        keys.has("KeyW") || keys.has("Space"),
        keys.has("KeyS") || shiftHeld,
        dt,
      );
    const verticalBlocked = moveAxis(1, velocity[1] * dt);
    if (verticalBlocked) {
      grounded = velocity[1] < 0;
      velocity[1] = 0;
    } else grounded = false;

    if (flying) {
      fallAirborne = false;
      fallPeakY = pose.y;
    } else if (touchingLadder) {
      fallAirborne = false;
      fallPeakY = pose.y;
    } else if (!grounded) {
      fallPeakY = fallAirborne ? Math.max(fallPeakY, pose.y) : Math.max(verticalStartY, pose.y);
      fallAirborne = true;
    } else if (fallAirborne) {
      // Collision separation leaves feet slightly below the ideal block top;
      // remove that tolerance so an exact three-block fall remains safe.
      const fallDistance = Math.max(0, fallPeakY - pose.y - LOCAL_FALL_LANDING_EPSILON);
      const damage = fallDamageForDistance(fallDistance);
      fallAirborne = false;
      fallPeakY = pose.y;
      const floorBlock = getBlock(Math.floor(pose.x), Math.floor(pose.y - 0.08), Math.floor(pose.z));
      if (fallDistance > 0.25 && floorBlock !== BLOCK.AIR) options.onFootstep?.(floorBlock);
      if (damage > 0 && playerHealth > 0 && options.canTakePlayerDamage?.() !== false) {
        const appliedDamage = Math.min(playerHealth, damage);
        playerHealth -= appliedDamage;
        options.onPlayerDamage?.(appliedDamage, "fall");
        options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
      }
    }

    const movedHorizontally = Math.hypot(pose.x - movementStartX, pose.z - movementStartZ);
    advanceHeadBob(
      cameraBob,
      movementMode,
      movedHorizontally,
      grounded,
      dt,
      reducedMotionQuery?.matches !== true,
      cameraBob,
    );
    if (grounded && movedHorizontally > 0.0001) {
      footstepDistance += movedHorizontally;
      const stepDistance = movementMode === "sprint" ? 1.35 : movementMode === "sneak" ? 2.1 : 1.65;
      if (footstepDistance >= stepDistance) {
        footstepDistance %= stepDistance;
        const floorBlock = getBlock(Math.floor(pose.x), Math.floor(pose.y - 0.08), Math.floor(pose.z));
        if (floorBlock !== BLOCK.AIR) options.onFootstep?.(floorBlock);
      }
    } else if (!grounded) {
      footstepDistance = Math.min(footstepDistance, 0.8);
    }

    const nextTarget = raycastVoxels(
      interactionEye(raycastEye),
      direction(raycastFacing),
      getBlock,
      options.reach ?? 6,
    );
    if (!sameTarget(target, nextTarget)) {
      clearMining();
      target = nextTarget;
      updateTargetOutlineGeometry();
      options.onTargetChange?.(target);
    } else target = nextTarget;

    beginHeldBlockMining();
    repeatHeldBlockPlacement(now);

    if (now - lastPoseSent > 90 && (poseDirty || forwardInput !== 0 || strafe !== 0 || Math.abs(velocity[1]) > 0.01)) {
      lastPoseSent = now;
      poseDirty = false;
      options.onPoseChange?.({ ...pose });
    }
    processPendingChunkMeshes();
    updateMobs(dt);
  }

  function applyConfirmedMobKnockback(
    eventId: string,
    attackerX: number,
    attackerZ: number,
    damage: number,
    eventTimeMs = performance.now(),
  ): boolean {
    const eligible = !paused && playerHealth > 0 && options.canTakePlayerDamage?.() !== false;
    const decision = decidePlayerKnockback(
      eventId,
      eventTimeMs,
      knockbackReadyAtMs,
      knockbackReceipts.has(eventId),
      eligible,
    );
    if (decision !== "accept") return false;
    const impulse = resolvePlayerKnockback(attackerX, attackerZ, pose.x, pose.z, damage, grounded);
    if (!impulse) return false;
    if (knockbackReceipts.size >= 64) {
      const oldest = knockbackReceipts.values().next().value;
      if (typeof oldest === "string") knockbackReceipts.delete(oldest);
    }
    knockbackReceipts.add(eventId);
    knockbackReadyAtMs = eventTimeMs + PLAYER_KNOCKBACK_COOLDOWN_MS;
    knockbackVelocity[0] = impulse.x;
    knockbackVelocity[2] = impulse.z;
    if (!creativeFlight.flying && !playerTouchesLadder(pose.x, pose.y, pose.z, getBlock)) {
      velocity[1] = Math.max(velocity[1], impulse.y);
      grounded = false;
    }
    poseDirty = true;
    return true;
  }

  function bindBuffer(buffer: WebGLBuffer): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 24, 12);
  }

  function bindTerrainBuffer(buffer: WebGLBuffer): void {
    const stride = TEXTURED_WORLD_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(terrainPositionLocation);
    gl.vertexAttribPointer(terrainPositionLocation, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(terrainUvLocation);
    gl.vertexAttribPointer(terrainUvLocation, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(terrainShadeLocation);
    gl.vertexAttribPointer(terrainShadeLocation, 1, gl.FLOAT, false, stride, 20);
  }

  function resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  }

  function updateActiveTorchLights(now: number, eye: Vec3): void {
    const movedSquared = (eye[0] - lastTorchCameraX) ** 2 + (eye[1] - lastTorchCameraY) ** 2 + (eye[2] - lastTorchCameraZ) ** 2;
    if (now - lastTorchSelectionAt < 250 && movedSquared < 0.25) return;
    lastTorchSelectionAt = now;
    lastTorchCameraX = eye[0];
    lastTorchCameraY = eye[1];
    lastTorchCameraZ = eye[2];
    activeTorchUniforms.fill(0);
    const nearest = selectNearestTorchLights(torchLights.values(), eye, MAX_ACTIVE_TORCH_LIGHTS, TORCH_LIGHT_RADIUS);
    activeTorchLights = nearest.length;
    for (let index = 0; index < nearest.length; index += 1) {
      const light = nearest[index];
      const offset = index * 4;
      activeTorchUniforms[offset] = light.x;
      activeTorchUniforms[offset + 1] = light.y;
      activeTorchUniforms[offset + 2] = light.z;
      activeTorchUniforms[offset + 3] = TORCH_LIGHT_RADIUS;
    }
  }

  function updateFirstPersonSkyExposure(eye: Vec3): number {
    const blockX = Math.floor(eye[0]);
    const blockY = Math.floor(eye[1]);
    const blockZ = Math.floor(eye[2]);
    if (firstPersonExposureDirty
      || blockX !== firstPersonExposureBlockX
      || blockY !== firstPersonExposureBlockY
      || blockZ !== firstPersonExposureBlockZ) {
      firstPersonExposureBlockX = blockX;
      firstPersonExposureBlockY = blockY;
      firstPersonExposureBlockZ = blockZ;
      firstPersonSkyExposure = skyExposureLevel(skyOccluderColumns, blockX, blockY, blockZ)
        / SKY_EXPOSURE_LEVELS;
      firstPersonExposureDirty = false;
    }
    return firstPersonSkyExposure;
  }

  function getPerformanceStats(): VoxelPerformanceStats {
    const sortedFrameTimes = [...frameTimes].sort((a, b) => a - b);
    const averageFrameTimeMs = frameTimes.length
      ? frameTimes.reduce((total, value) => total + value, 0) / frameTimes.length
      : 0;
    const p95Index = Math.max(0, Math.ceil(sortedFrameTimes.length * 0.95) - 1);
    return {
      fps: averageFrameTimeMs > 0 ? 1_000 / averageFrameTimeMs : 0,
      averageFrameTimeMs,
      p95FrameTimeMs: sortedFrameTimes[p95Index] ?? 0,
      frameSampleCount: frameTimes.length,
      lastMeshRebuildMs,
      totalMeshRebuildMs,
      lastRebuiltChunkCount,
      totalRebuiltChunkCount,
      worldVertexCount,
      blockCount: blocks.size,
      chunkCount: loadedChunkKeys.size,
      visibleChunkCount,
      drawCalls,
      avatarDrawCalls,
      avatarVertexCount: remoteVertexCount,
      nameplateVertexCount,
      remoteMeshMs: remotePlayerRenderer.stats.meshMs,
      remoteUploadBytes: remotePlayerRenderer.stats.uploadBytes,
      remoteMeshUpdates: remotePlayerRenderer.stats.meshUpdates,
      remoteVisiblePlayers: remotePlayerRenderer.stats.visiblePlayerCount,
      mobDrawCalls,
      mobVertexCount,
      mobVisibleCount: visibleMobCount,
      mobCount: mobSimulation.mobs.length,
      mobSimulationMs: lastMobSimulationMs,
      droppedItemDrawCalls,
      droppedItemVertexCount,
      droppedItemVisibleCount,
      droppedItemCount: droppedItemRenderer.stats.totalItemCount,
      droppedItemMeshMs: droppedItemRenderer.stats.meshMs,
      droppedItemUploadBytes: droppedItemRenderer.stats.uploadBytes,
      primedTntVertexCount,
      primedTntVisibleCount,
      primedTntUploadBytes,
      particleDrawCalls,
      particleVertexCount,
      activeParticleCount: blockParticles.activeCount,
      particleUploadBytes,
      torchCount: torchLights.size,
      activeTorchLights,
      firstPersonDrawCalls: firstPersonFeedbackHidden || playerHealth <= 0 ? 0
        : firstPersonStats[2] + Number(cameraMode === "first_person" && selectedItem !== "bow"),
      firstPersonVertexCount: firstPersonStats[0] + firstPersonStats[1]
        + (selectedItem === "bow" ? 0 : FIRST_PERSON_SKIN_ARM_VERTICES),
      firstPersonLastUploadBytes: firstPersonStats[3],
      firstPersonTotalUploadBytes: firstPersonStats[4],
      firstPersonMeshUpdates: firstPersonStats[5],
      firstPersonBufferBytes: firstPersonStats[6] + FIRST_PERSON_SKIN_ARM_BUFFER_BYTES,
      estimatedMeshBytes: (worldVertexCount + remoteVertexCount + nameplateVertexCount + mobVertexCount + droppedItemVertexCount + primedTntVertexCount + particleVertexCount) * 6 * Float32Array.BYTES_PER_ELEMENT
        + firstPersonStats[6] + FIRST_PERSON_SKIN_ARM_BUFFER_BYTES,
    };
  }

  function render(now: number, dt: number, frameNow: number, refreshDynamicGeometry = true): void {
    resize();
    const eye = cameraEye(renderEye);
    if (refreshDynamicGeometry) {
      const remoteStats = remotePlayerRenderer.update(remoteStates, now, dt, eye);
      remoteVertexCount = remoteStats.avatarVertexCount;
      nameplateVertexCount = remoteStats.nameplateVertexCount;
      const droppedItemStats = droppedItemRenderer.update(now, eye);
      droppedItemVertexCount = droppedItemStats.vertexCount;
      droppedItemVisibleCount = droppedItemStats.visibleItemCount;
      const playerProjectileStats = playerProjectileRenderer.update(now, eye);
      playerProjectileVertexCount = playerProjectileStats.vertexCount;
    }
    const facing = renderFacing;
    const horizontalFacing = Math.hypot(facing[0], facing[2]) || 1;
    const rightX = -facing[2] / horizontalFacing;
    const rightZ = facing[0] / horizontalFacing;
    const upX = -rightZ * facing[1];
    const upY = rightZ * facing[0] - rightX * facing[2];
    const upZ = rightX * facing[1];
    if (refreshDynamicGeometry) {
      blockParticles.update(dt);
      particleCameraRight[0] = rightX;
      particleCameraRight[1] = 0;
      particleCameraRight[2] = rightZ;
      particleCameraUp[0] = upX;
      particleCameraUp[1] = upY;
      particleCameraUp[2] = upZ;
      blockParticles.writeGeometry(particleCameraRight, particleCameraUp, particleGeometry, particleGeometryStats);
      particleVertexCount = particleGeometryStats.vertexCount;
      if (particleUploadFloatCount !== particleGeometryStats.floatCount) {
        particleUploadFloatCount = particleGeometryStats.floatCount;
        particleUploadView = particleGeometry.subarray(0, particleUploadFloatCount);
      }
      particleUploadBytes = particleUploadView.byteLength;
      if (particleVertexCount > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, particleUploadView);
      }
    }
    renderCenter[0] = eye[0] + facing[0];
    renderCenter[1] = eye[1] + facing[1];
    renderCenter[2] = eye[2] + facing[2];
    writeRenderDistanceFogRange(fogRange, streamingChunkRadius);
    writePerspectiveMatrix(projectionMatrix,
      cameraPosture.fovRadians,
      canvas.width / canvas.height,
      0.05,
      fogRange[1] + WORLD_CHUNK_SIZE,
    );
    writeLookAtMatrix(viewMatrix, eye, renderCenter);
    const mvp = writeMatrixProduct(mvpMatrix, projectionMatrix, viewMatrix);
    writeFrustumPlanes(frustumPlanes, mvp);
    sampleDayNight(worldTimeMs, dayNightConfig, dayNightState);
    writeCelestialDirection(dayNightState.sunAngle, atmosphereSunDirection);
    writeCelestialDirection(dayNightState.moonAngle, atmosphereMoonDirection);
    updateActiveTorchLights(now, eye);
    firstPersonTorchUniforms[3] = activeTorchUniforms[3] / 2;
    const viewmodelSkyExposure = updateFirstPersonSkyExposure(
      cameraMode === "first_person" ? eye : playerEyeForCamera,
    );
    if (refreshDynamicGeometry) {
      const mobStats = mobRenderer.rebuild(
        mobSnapshots,
        eye[0],
        eye[2],
        facing[0],
        facing[2],
        sharedMobMotionActive
          ? clampNumber((now - sharedMobMotionAppliedAt) / sharedMobMotionIntervalMs, 0, 1)
          : Math.min(1, mobAccumulatorSeconds / mobStepSeconds),
        now / 1_000,
        mobProjectileSnapshots,
        frameNow,
      );
      mobVertexCount = mobStats.vertexCount;
      visibleMobCount = mobStats.visibleMobCount;
      primedTntVertexCount = mobStats.primedTntVertexCount;
      primedTntVisibleCount = mobStats.visiblePrimedTntCount;
      primedTntUploadBytes = mobStats.primedTntVertexCount * 6 * Float32Array.BYTES_PER_ELEMENT;
    }
    gl.clearColor(dayNightState.skyR, dayNightState.skyG, dayNightState.skyB, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    visibleChunkCount = 0;
    drawCalls = 1;
    avatarDrawCalls = 0;
    mobDrawCalls = 0;
    droppedItemDrawCalls = 0;
    particleDrawCalls = 0;

    gl.disable(gl.DEPTH_TEST);
    for (let attribute = 0; attribute < maximumVertexAttributes; attribute += 1) {
      gl.disableVertexAttribArray(attribute);
    }
    gl.useProgram(atmosphereProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, atmosphereBuffer);
    gl.enableVertexAttribArray(atmospherePositionLocation);
    gl.vertexAttribPointer(atmospherePositionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(atmosphereAspectLocation, canvas.width / canvas.height);
    gl.uniform1f(atmosphereTimeLocation, now / 1_000);
    gl.uniform3fv(atmosphereEyeLocation, eye);
    gl.uniform3fv(atmosphereForwardLocation, facing);
    gl.uniform3f(atmosphereRightLocation, rightX, 0, rightZ);
    gl.uniform3f(atmosphereUpLocation, upX, upY, upZ);
    gl.uniform3f(atmosphereSkyColorLocation, dayNightState.skyR, dayNightState.skyG, dayNightState.skyB);
    gl.uniform3f(atmosphereFogColorLocation, dayNightState.fogR, dayNightState.fogG, dayNightState.fogB);
    gl.uniform3fv(atmosphereSunDirectionLocation, atmosphereSunDirection);
    gl.uniform3fv(atmosphereMoonDirectionLocation, atmosphereMoonDirection);
    gl.uniform1f(atmosphereSunIntensityLocation, dayNightState.sunIntensity);
    gl.uniform1f(atmosphereMoonIntensityLocation, dayNightState.moonIntensity);
    gl.uniform1f(atmosphereStarIntensityLocation, dayNightState.starIntensity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(atmospherePositionLocation);
    gl.enable(gl.DEPTH_TEST);

    gl.useProgram(terrainProgram);
    gl.uniformMatrix4fv(terrainMvpLocation, false, mvp);
    gl.uniform3fv(terrainCameraLocation, eye);
    gl.uniform2fv(terrainFogRangeLocation, fogRange);
    gl.uniform3f(terrainFogColorLocation, dayNightState.fogR, dayNightState.fogG, dayNightState.fogB);
    gl.uniform3f(
      terrainAmbientColorLocation,
      dayNightState.ambientR,
      dayNightState.ambientG,
      dayNightState.ambientB,
    );
    gl.uniform3f(
      terrainDirectionalColorLocation,
      dayNightState.directionalR,
      dayNightState.directionalG,
      dayNightState.directionalB,
    );
    gl.uniform1f(terrainAmbientIntensityLocation, dayNightState.ambientIntensity);
    gl.uniform1f(terrainDirectionalIntensityLocation, dayNightState.directionalIntensity);
    gl.uniform1f(terrainSkyExposureLocation, 1);
    gl.uniform4fv(terrainTorchLightsLocation, activeTorchUniforms);
    gl.uniform1f(terrainFogLocation, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, terrainTexture);
    gl.uniform1i(terrainAtlasLocation, 0);
    gl.uniform1f(terrainAlphaCutoffLocation, 0.5);
    visibleMeshes.length = 0;
    transparentMeshes.length = 0;
    for (const mesh of chunkMeshes.values()) {
      if (!chunkIntersectsView(mesh, frustumPlanes)) continue;
      visibleChunkCount += 1;
      visibleMeshes.push(mesh);
      if (mesh.transparentBuffer && mesh.transparentVertexCount > 0) {
        const transparentDx = mesh.centerX - eye[0];
        const transparentDz = mesh.centerZ - eye[2];
        mesh.transparentDistanceSquared = transparentDx * transparentDx + transparentDz * transparentDz;
        transparentMeshes.push(mesh);
      }
      if (!mesh.textureBuffer || !mesh.textureVertexCount) continue;
      bindTerrainBuffer(mesh.textureBuffer);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.textureVertexCount);
      drawCalls += 1;
    }

    gl.useProgram(program);
    gl.uniformMatrix4fv(mvpLocation, false, mvp);
    gl.uniform3fv(cameraLocation, eye);
    gl.uniform2fv(fogRangeLocation, fogRange);
    gl.uniform3f(fogColorLocation, dayNightState.fogR, dayNightState.fogG, dayNightState.fogB);
    gl.uniform3f(
      ambientColorLocation,
      dayNightState.ambientR,
      dayNightState.ambientG,
      dayNightState.ambientB,
    );
    gl.uniform3f(
      directionalColorLocation,
      dayNightState.directionalR,
      dayNightState.directionalG,
      dayNightState.directionalB,
    );
    gl.uniform1f(ambientIntensityLocation, dayNightState.ambientIntensity);
    gl.uniform1f(directionalIntensityLocation, dayNightState.directionalIntensity);
    gl.uniform1f(skyExposureLocation, 1);
    gl.uniform4fv(torchLightsLocation, activeTorchUniforms);
    gl.uniform1f(lightingLocation, 1);
    gl.uniform1f(fogLocation, 1);
    for (const mesh of visibleMeshes) {
      if (!mesh.colorBuffer || !mesh.colorVertexCount) continue;
      bindBuffer(mesh.colorBuffer);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.colorVertexCount);
      drawCalls += 1;
    }
    if (remoteVertexCount) {
      bindBuffer(remotePlayerRenderer.avatarBuffer);
      gl.drawArrays(gl.TRIANGLES, 0, remoteVertexCount);
      drawCalls += 1;
      avatarDrawCalls += 1;
    }
    if (droppedItemVertexCount) {
      bindBuffer(droppedItemRenderer.buffer);
      gl.drawArrays(gl.TRIANGLES, 0, droppedItemVertexCount);
      drawCalls += 1;
      droppedItemDrawCalls += 1;
    }
    if (playerProjectileVertexCount) {
      bindBuffer(playerProjectileRenderer.buffer);
      gl.drawArrays(gl.TRIANGLES, 0, playerProjectileVertexCount);
      drawCalls += 1;
    }
    if (mobVertexCount) {
      bindBuffer(mobRenderer.buffer);
      gl.drawArrays(gl.TRIANGLES, 0, mobVertexCount);
      drawCalls += 1;
      mobDrawCalls += 1;
    }
    if (particleVertexCount) {
      bindBuffer(particleBuffer);
      gl.uniform1f(fogLocation, 1);
      gl.uniform1f(lightingLocation, 0);
      gl.drawArrays(gl.TRIANGLES, 0, particleVertexCount);
      drawCalls += 1;
      particleDrawCalls += 1;
    }
    if (nameplateVertexCount) {
      bindBuffer(remotePlayerRenderer.nameplateBuffer);
      gl.uniform1f(fogLocation, 0);
      gl.uniform1f(lightingLocation, 0);
      gl.drawArrays(gl.TRIANGLES, 0, nameplateVertexCount);
      drawCalls += 1;
      avatarDrawCalls += 1;
    }

    if (cameraMode !== "first_person") {
      const exposure = 0.38 + viewmodelSkyExposure * 0.62;
      playerSkinLight[0] = clampNumber((dayNightState.ambientR * dayNightState.ambientIntensity
        + dayNightState.directionalR * dayNightState.directionalIntensity * 0.55) * exposure, 0.32, 1.12);
      playerSkinLight[1] = clampNumber((dayNightState.ambientG * dayNightState.ambientIntensity
        + dayNightState.directionalG * dayNightState.directionalIntensity * 0.55) * exposure, 0.32, 1.12);
      playerSkinLight[2] = clampNumber((dayNightState.ambientB * dayNightState.ambientIntensity
        + dayNightState.directionalB * dayNightState.directionalIntensity * 0.55) * exposure, 0.32, 1.12);
      playerSkinRenderer.setHeldItem(selectedItem);
      playerSkinRenderer.draw(mvp, pose, playerSkinLight, playerRigInputForMovement(movementMode, now));
      const localPlayerDrawCalls = playerSkinRenderer.drawCallCount;
      drawCalls += localPlayerDrawCalls;
      avatarDrawCalls += localPlayerDrawCalls;
      gl.useProgram(program);
    }

    transparentMeshes.sort(compareTransparentChunkMeshes);
    if (transparentMeshes.length) {
      gl.useProgram(terrainProgram);
      gl.uniform1f(terrainAlphaCutoffLocation, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      const transparentDrawCount = Math.min(transparentMeshes.length, MAX_TRANSPARENT_CHUNK_DRAWS);
      for (let index = 0; index < transparentDrawCount; index += 1) {
        const mesh = transparentMeshes[index];
        if (!mesh.transparentBuffer || !mesh.transparentVertexCount) continue;
        bindTerrainBuffer(mesh.transparentBuffer);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.transparentVertexCount);
        drawCalls += 1;
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.uniform1f(terrainAlphaCutoffLocation, 0.5);
      gl.useProgram(program);
    }

    if (target) {
      if (crackVertexCount > 0) {
        bindBuffer(crackBuffer);
        gl.uniform1f(fogLocation, 0);
        gl.uniform1f(lightingLocation, 0);
        gl.lineWidth(2);
        gl.drawArrays(gl.LINES, 0, crackVertexCount);
        drawCalls += 1;
      }
      gl.lineWidth(1);
      bindBuffer(lineBuffer);
      gl.uniform1f(fogLocation, 0);
      gl.uniform1f(lightingLocation, 0);
      gl.drawArrays(gl.LINES, 0, targetOutlineVertexCount);
      drawCalls += 1;
    }

    const bowCharging = selectedItem === "bow" && rangedChargeStartedAt > 0;
    const previewBowDrawn = resolvePoseLabDrawPreview(
      paused,
      selectedItem === "bow",
      firstPersonBowPreviewDrawn,
    );
    const renderedBowCharging = previewBowDrawn ?? bowCharging;
    setFirstPersonBowCharge(
      renderedBowCharging,
      previewBowDrawn === true
        ? 1
        : bowCharging
          ? clampNumber((frameNow - rangedChargeStartedAt) / PLAYER_BOW_FULL_CHARGE_MS, 0, 1)
          : 0,
    );
    if (cameraMode === "first_person" && !firstPersonFeedbackHidden && playerHealth > 0) {
      // The viewmodel owns a fresh depth plane but retains the world color buffer,
      // so nearby terrain never clips the hand and the crosshair remains centered.
      gl.clear(gl.DEPTH_BUFFER_BIT);
      writeFirstPersonMvp(
        firstPersonMvpMatrix,
        projectionMatrix,
        now,
        reducedMotionQuery?.matches === true,
      );
      if (firstPersonStats[1] > 0) {
        gl.useProgram(terrainProgram);
        gl.uniformMatrix4fv(terrainMvpLocation, false, firstPersonMvpMatrix);
        gl.uniform3f(terrainCameraLocation, 0, 0, 0);
        gl.uniform1f(terrainFogLocation, 0);
        gl.uniform1f(terrainSkyExposureLocation, viewmodelSkyExposure);
        gl.uniform4fv(terrainTorchLightsLocation, firstPersonTorchUniforms);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, terrainTexture);
        gl.uniform1i(terrainAtlasLocation, 0);
        gl.uniform1f(terrainAlphaCutoffLocation, 0.08);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        bindTerrainBuffer(firstPersonTexturedBuffer);
        gl.drawArrays(gl.TRIANGLES, 0, firstPersonStats[1]);
        gl.disable(gl.BLEND);
        drawCalls += 1;
      }
      if (firstPersonStats[0] > 0) {
        gl.useProgram(program);
        gl.uniformMatrix4fv(mvpLocation, false, firstPersonMvpMatrix);
        gl.uniform3f(cameraLocation, 0, 0, 0);
        gl.uniform1f(fogLocation, 0);
        gl.uniform1f(skyExposureLocation, viewmodelSkyExposure);
        gl.uniform4fv(torchLightsLocation, firstPersonTorchUniforms);
        gl.uniform1f(lightingLocation, 1);
        bindBuffer(firstPersonColorBuffer);
        gl.drawArrays(gl.TRIANGLES, 0, firstPersonStats[0]);
        drawCalls += 1;
      }
      if (selectedItem !== "bow") {
        const exposure = 0.38 + viewmodelSkyExposure * 0.62;
        firstPersonSkinLight[0] = clampNumber((dayNightState.ambientR * dayNightState.ambientIntensity
          + dayNightState.directionalR * dayNightState.directionalIntensity * 0.55) * exposure, 0.32, 1.12);
        firstPersonSkinLight[1] = clampNumber((dayNightState.ambientG * dayNightState.ambientIntensity
          + dayNightState.directionalG * dayNightState.directionalIntensity * 0.55) * exposure, 0.32, 1.12);
        firstPersonSkinLight[2] = clampNumber((dayNightState.ambientB * dayNightState.ambientIntensity
          + dayNightState.directionalB * dayNightState.directionalIntensity * 0.55) * exposure, 0.32, 1.12);
        firstPersonSkinRenderer.draw(
          firstPersonMvpMatrix,
          firstPersonSkinLight,
          usesCanonicalHeldBlock(selectedItem, selectedBlock),
        );
        drawCalls += 1;
      }
    }

  }

  function frame(now: number): void {
    if (!running || destroyed) return;
    const frameTimeMs = Math.max(0, now - lastFrame);
    const dt = Math.min(0.05, frameTimeMs / 1000);
    lastFrame = now;
    if (paused) {
      if (!firstPersonFeedbackHidden && playerHealth > 0
        && document.visibilityState === "visible"
        && now - lastPausedRenderAt >= PAUSED_RENDER_INTERVAL_MS) {
        lastPausedRenderAt = now;
        render(pausedVisualTime, 0, pausedVisualTime, false);
      }
      frameId = requestAnimationFrame(frame);
      return;
    }
    worldTimeMs = advanceVoxelWorldTimeMs(worldTimeMs, dt, paused);
    if (!paused && miningTimer && miningDurationMs > 0 && now - lastMiningProgressAt >= 50) {
      lastMiningProgressAt = now;
      miningProgress = clampNumber((now - miningStartedAt) / miningDurationMs, 0.01, 0.99);
      updateMiningCrackGeometry();
      if (target && now - lastMiningHitAt >= 225) {
        lastMiningHitAt = now;
        emitHandAction("mine");
        options.onMiningHit?.({ ...target, block: { ...target.block }, place: { ...target.place } });
      }
    }
    if (!paused && rangedChargeStartedAt > 0 && now - lastRangedChargeFeedbackAt >= 50) {
      lastRangedChargeFeedbackAt = now;
      options.onRangedChargeChange?.(
        true,
        clampNumber((now - rangedChargeStartedAt) / PLAYER_BOW_FULL_CHARGE_MS, 0, 1),
      );
    }
    if (frameTimeMs > 0) {
      frameTimes.push(frameTimeMs);
      if (frameTimes.length > 120) frameTimes.shift();
    }
    if (!paused) update(dt, now);
    const visualNow = paused ? pausedVisualTime : now;
    render(visualNow, paused ? 0 : dt, now);
    if (now - lastPerformanceSent >= 500) {
      lastPerformanceSent = now;
      options.onPerformanceStats?.(getPerformanceStats());
    }
    frameId = requestAnimationFrame(frame);
  }

  function commitEditBatch(
    semanticEdit: WorldEdit,
    previousBlock: BlockId,
    additionalEdits: readonly WorldEdit[],
    updateBeds?: () => void,
  ): boolean {
    const batch = additionalEdits.length ? [semanticEdit, ...additionalEdits] : [semanticEdit];
    const committed = commitWorldEditBatch(batch, false, updateBeds);
    if (!committed) return false;
    const semanticKey = blockKey(semanticEdit.x, semanticEdit.y, semanticEdit.z);
    const journalEdits = committed.filter((edit) =>
      blockKey(edit.x, edit.y, edit.z) !== semanticKey || edit.block !== semanticEdit.block);
    options.onBlockEdit?.({ ...semanticEdit }, previousBlock, journalEdits);
    return true;
  }

  function planBedBreakSettlement(edit: WorldEdit, bed: Readonly<BedStructure>): WorldEdit[] {
    const bedEdits = bedBreakEdits(bed, edit);
    if (!bedEdits) return [];
    const [, companionEdit] = bedEdits;
    const planned: WorldEdit[] = [companionEdit];
    const virtualBlocks = new Map<string, BlockId>([
      [blockKey(edit.x, edit.y, edit.z), BLOCK.AIR],
      [blockKey(companionEdit.x, companionEdit.y, companionEdit.z), BLOCK.AIR],
    ]);
    const readPlannedBlock = (x: number, y: number, z: number): BlockId =>
      virtualBlocks.get(blockKey(x, y, z)) ?? getBlock(x, y, z);
    for (const cell of [bed.foot, bed.head]) {
      const settlement = planLocalFallingBlockSettlement(
        { ...cell, block: BLOCK.AIR },
        BLOCK.BED,
        readPlannedBlock,
      );
      for (const next of settlement) {
        planned.push(next);
        virtualBlocks.set(blockKey(next.x, next.y, next.z), next.block);
      }
    }
    return planned;
  }

  function emitEdit(edit: WorldEdit): boolean {
    const previousBlock = getBlock(edit.x, edit.y, edit.z);
    if (options.twoBlockBeds && previousBlock === BLOCK.BED && edit.block === BLOCK.AIR) {
      const bed = getStoredBedAt(edit.x, edit.y, edit.z);
      if (bed) return commitEditBatch(edit, previousBlock, planBedBreakSettlement(edit, bed));
    }
    const settledEdits = options.acceptWorldEdits ? planLocalFallingBlockSettlement(
      edit,
      previousBlock,
      (x, y, z) => x === edit.x && y === edit.y && z === edit.z ? edit.block : getBlock(x, y, z),
    ) : [];
    return commitEditBatch(edit, previousBlock, settledEdits);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (paused) return;
    if (document.pointerLockElement !== canvas && options.allowUnlockedKeyboardInput?.() !== true) return;
    if (event.code === "KeyF" && !event.repeat) {
      event.preventDefault();
      cameraMode = nextPlayerCameraMode(cameraMode);
      lastPausedRenderAt = Number.NEGATIVE_INFINITY;
      return;
    }
    const hotbarIndex = hotbarIndexForDigitCode(event.code);
    if (hotbarIndex !== null) {
      event.preventDefault();
      cancelSecondaryPlacementHold();
      options.onHotbarSelect?.(hotbarIndex);
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight"].includes(event.code)) {
      event.preventDefault();
    }
    const controlKey = event.code === "ControlLeft" || event.code === "ControlRight";
    if (controlKey) sprintControls = updateSprintControl(sprintControls, event.code as SprintControlCode, true);
    else keys.add(event.code);
    if (event.code === "Space") {
      const wasFlying = creativeFlight.flying;
      creativeFlight = transitionCreativeFlightTap(
        creativeFlight,
        performance.now(),
        options.canCreativeFly?.() === true,
        event.repeat,
      );
      if (creativeFlight.flying !== wasFlying) {
        velocity[1] = 0;
        grounded = false;
        fallAirborne = false;
        fallPeakY = pose.y;
      }
      // Space is a climb command while touching a ladder; do not inject the
      // normal 8.25-block/s ground impulse before the next physics frame.
      if (!creativeFlight.flying && !wasFlying && grounded
        && !playerTouchesLadder(pose.x, pose.y, pose.z, getBlock)) {
        velocity[1] = PLAYER_JUMP_SPEED;
        grounded = false;
      }
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.code === "ControlLeft" || event.code === "ControlRight") {
      sprintControls = updateSprintControl(sprintControls, event.code, false);
    } else keys.delete(event.code);
  }

  function releaseTransientInput(): void {
    pressedMouseButtons.clear();
    clearHeldMovementInput();
    cancelPrimaryActionHold();
    cancelSecondaryPlacementHold(true);
    clearRangedCharge(true);
  }

  function onWindowBlur(): void {
    releaseTransientInput();
  }

  function onVisibilityChange(): void {
    if (document.visibilityState !== "visible") releaseTransientInput();
  }

  function onMouseMove(event: MouseEvent): void {
    if (paused || document.pointerLockElement !== canvas || playerHealth <= 0) return;
    const look = applyMouseLookDelta(
      pose.yaw,
      pose.pitch,
      event.movementX,
      event.movementY,
      options.getMouseLookSensitivity?.(),
    );
    pose.yaw = look.yaw;
    pose.pitch = look.pitch;
    poseDirty = true;
  }

  function onWheel(event: WheelEvent): void {
    if (paused || document.pointerLockElement !== canvas) return;
    const direction = hotbarWheelDirection(event.deltaY);
    if (direction === 0) return;
    event.preventDefault();
    cancelSecondaryPlacementHold();
    options.onHotbarCycle?.(direction);
  }

  function playerIntersectsBlock(x: number, y: number, z: number, block: BlockId): boolean {
    return pose.x + 0.29 > x
      && pose.x - 0.29 < x + 1
      && playerIntersectsBlockCollisionHeight(pose.y, cameraPosture.bodyHeight, y, block)
      && pose.z + 0.29 > z
      && pose.z - 0.29 < z + 1;
  }

  function tryPlaceSelectedBlock(): boolean {
    if (!target || selectedBlock === BLOCK.AIR || options.canEditBlock?.() === false
      || options.canPlaceSelectedBlock?.(selectedBlock) === false) return false;
    const { x, y, z } = target.place;
    if (options.twoBlockBeds && selectedBlock === BLOCK.BED) {
      const plan = planBedPlacement({
        foot: { x, y, z },
        yaw: pose.yaw,
        getBlock,
        intersectsPlayer: (blockX, blockY, blockZ) => playerIntersectsBlock(blockX, blockY, blockZ, BLOCK.BED),
      });
      if (!plan.ok) return false;
      if (!commitEditBatch(plan.edits[0], BLOCK.AIR, [plan.edits[1]], () => registerBedStructure(plan.bed))) return false;
      emitHandAction("place");
      return true;
    }
    const saplingPlacement = selectedBlock === BLOCK.SAPLING;
    const supportedSapling = !saplingPlacement || canPlaceSapling(target, getBlock(x, y - 1, z));
    if (
      getBlock(x, y, z) !== BLOCK.AIR
      || !supportedSapling
      || (!saplingPlacement && playerIntersectsBlock(x, y, z, selectedBlock))
    ) return false;
    if (!emitEdit({ x, y, z, block: doorPlacementBlock(selectedBlock) })) return false;
    emitHandAction("place");
    return true;
  }

  function repeatHeldBlockPlacement(now: number): boolean {
    if (!options.continuousBlockPlacement || !shouldRepeatSecondaryPlacement(secondaryPlacementHold, now)) return false;
    secondaryPlacementHold = advanceSecondaryPlacement(secondaryPlacementHold, now);
    return tryPlaceSelectedBlock();
  }

  function attackEntityUnderCrosshair(): boolean {
    const eye = interactionEye();
    const facing = direction();
    const reach = options.reach ?? 6;
    const mobTarget = raycastMobs(eye, facing, mobSimulation.mobs, reach);
    const remoteTarget = options.onRemotePlayerAttack
      ? raycastRemotePlayers(eye, facing, remoteStates.values(), reach)
      : null;
    const nearestDistance = Math.min(
      mobTarget?.distance ?? Number.POSITIVE_INFINITY,
      remoteTarget?.distance ?? Number.POSITIVE_INFINITY,
    );
    // Solid voxels occlude both players and mobs.
    if (!Number.isFinite(nearestDistance) || !mobTargetHasClickPriority(nearestDistance, target?.distance ?? null)) return false;
    const rawDamage = options.getAttackDamage?.() ?? 1;
    const attackDamage = Number.isFinite(rawDamage) ? clampNumber(rawDamage, 0, 100) : 1;
    if (remoteTarget && remoteTarget.distance <= (mobTarget?.distance ?? Number.POSITIVE_INFINITY)) {
      clearMining();
      emitHandAction("attack");
      void options.onRemotePlayerAttack?.({ ...remoteTarget }, attackDamage);
      return true;
    }
    if (!mobTarget) return false;
    if (options.onMobAttack) {
      clearMining();
      emitHandAction("attack");
      void options.onMobAttack({ ...mobTarget }, attackDamage);
      return true;
    }
    clearMining();
    const attackNow = performance.now();
    if (!localMobAttackIsReady(localMobAttackReadyAt, attackNow)) return true;
    const result = damageMob(mobSimulation, mobTarget.id, attackDamage, options.onMobDrops);
    if (!result.found) return false;
    if (result.applied) {
      localMobAttackReadyAt = advanceLocalMobAttackReadyAt(localMobAttackReadyAt, attackNow, true);
      if (!result.killed) applyConfirmedPlayerHitMobKnockback(
        `local-melee:${mobTarget.id}:${attackNow}`,
        mobTarget.id,
        pose.x,
        pose.z,
        attackDamage,
      );
      options.onLocalMobHit?.();
      emitHandAction("attack");
    }
    writeReactiveMobPoseSnapshots();
    return true;
  }

  function useMobUnderCrosshair(): boolean {
    if (!options.onMobUse) return false;
    const eye = interactionEye();
    const facing = direction();
    const mobTarget = raycastMobs(eye, facing, mobSimulation.mobs, options.reach ?? 6);
    if (!mobTarget || !mobTargetHasClickPriority(mobTarget.distance, target?.distance ?? null)) return false;
    if (!options.onMobUse({ ...mobTarget })) return false;
    clearMining();
    emitHandAction("use");
    return true;
  }

  function rangedShotIntent(now: number): RangedShotIntent {
    const eye = interactionEye();
    const facing = direction();
    const blockTarget = raycastVoxels(eye, facing, getBlock, PLAYER_RANGED_REACH);
    const mobTarget = raycastMobs(eye, facing, mobSimulation.mobs, PLAYER_RANGED_REACH);
    const remoteTarget = raycastRemotePlayers(eye, facing, remoteStates.values(), PLAYER_RANGED_REACH);
    const occlusionDistance = blockTarget?.distance ?? PLAYER_RANGED_REACH;
    const nearestEntityDistance = Math.min(
      mobTarget?.distance ?? Number.POSITIVE_INFINITY,
      remoteTarget?.distance ?? Number.POSITIVE_INFINITY,
    );
    const target = nearestEntityDistance <= occlusionDistance + 0.001
      ? remoteTarget && remoteTarget.distance <= (mobTarget?.distance ?? Number.POSITIVE_INFINITY)
        ? { kind: "player" as const, id: remoteTarget.id, name: remoteTarget.name, distance: remoteTarget.distance }
        : mobTarget
          ? { kind: "mob" as const, id: mobTarget.id, mobKind: mobTarget.kind, distance: mobTarget.distance }
          : { kind: "none" as const, id: "" as const, distance: occlusionDistance }
      : { kind: "none" as const, id: "" as const, distance: occlusionDistance };
    return {
      chargeMs: clampNumber(now - rangedChargeStartedAt, 0, PLAYER_BOW_FULL_CHARGE_MS),
      target,
      origin: [eye[0], eye[1], eye[2]],
      direction: [facing[0], facing[1], facing[2]],
    };
  }

  function requestCanvasPointerLock(): Promise<boolean> {
    return requestPointerLockForTarget(
      canvas,
      document,
      window,
      250,
      () => !destroyed,
      () => document.exitPointerLock(),
    );
  }

  function applyCapturedMouseDown(button: number): void {
    if (playerHealth <= 0) return;
    if (button === 0) {
      if (primaryActionHold.held) return;
      const attackedEntity = attackEntityUnderCrosshair();
      primaryActionHold = pressPrimaryAction(attackedEntity);
      if (!attackedEntity) beginHeldBlockMining();
    } else if (button === 2) {
      if (secondaryButtonHeld) return;
      secondaryButtonHeld = true;
      if (useMobUnderCrosshair()) return;
      const bypassBlockInteraction = bypassBlockInteractionForPlacement(
        keys.has("ShiftLeft") || keys.has("ShiftRight"),
        selectedBlock,
      );
      if (target && !bypassBlockInteraction) {
        const doorEdit = createDoorToggleEdit(target);
        if (doorEdit) {
          if (options.canEditBlock?.() === false) return;
          emitHandAction("use");
          emitEdit(doorEdit);
          return;
        }
        if (tryInteractBlock(target, options.onInteractBlock)) {
          emitHandAction("use");
          return;
        }
      }
      if (options.isRangedWeaponSelected?.()) {
        if (rangedChargeStartedAt === 0) {
          rangedChargeStartedAt = performance.now();
          lastRangedChargeFeedbackAt = -Infinity;
          options.onRangedChargeChange?.(true, 0);
        }
        return;
      }
      if (options.onUseSelectedItem?.()) {
        emitHandAction("use");
        return;
      }
      const placementBlock = selectedBlock;
      const accepted = tryPlaceSelectedBlock();
      if (options.continuousBlockPlacement) {
        const stillPayable = selectedBlock === placementBlock
          && options.canPlaceSelectedBlock?.(placementBlock) !== false;
        secondaryPlacementHold = pressSecondaryPlacement(accepted && stillPayable, placementBlock, performance.now());
      }
    }
  }

  const pressedMouseButtons = new Set<number>();

  function onMouseDown(event: MouseEvent): void {
    event.preventDefault();
    if (paused) return;
    pressedMouseButtons.add(event.button);
    if (document.pointerLockElement !== canvas) {
      const button = event.button;
      void requestCanvasPointerLock().then((locked) => {
        if (!locked || paused) return;
        applyCapturedMouseDown(button);
        if (!pressedMouseButtons.has(button)) applyCapturedMouseUp(button);
      });
      return;
    }
    applyCapturedMouseDown(event.button);
  }

  function applyCapturedMouseUp(button: number): void {
    if (button === 0) cancelPrimaryActionHold();
    if (button === 2) {
      cancelSecondaryPlacementHold(true);
    }
    if (button === 2 && rangedChargeStartedAt > 0) {
      const intent = rangedShotIntent(performance.now());
      clearRangedCharge();
      emitHandAction("use");
      void options.onRangedRelease?.(intent);
    }
  }

  function onMouseUp(event: MouseEvent): void {
    pressedMouseButtons.delete(event.button);
    applyCapturedMouseUp(event.button);
  }

  function onPointerLockChange(): void {
    if (document.pointerLockElement !== canvas) {
      releaseTransientInput();
      resetMovementView();
    }
    options.onPointerLockChange?.(document.pointerLockElement === canvas);
  }

  function onContextMenu(event: MouseEvent): void { event.preventDefault(); }

  if (!options.preserveInitialPose) {
    pose.y = resolveSafeSpawnY(
      pose.y,
      terrainHeight(pose.x, pose.z, seed) + 1.02,
      (candidateY) => collides(pose.x, candidateY, pose.z),
    );
  }
  rebuildWorldChunks([...chunkBlocks.keys()]);

  return {
    start() {
      if (running || destroyed) return;
      running = true;
      lastFrame = performance.now();
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onWindowBlur);
      document.addEventListener("visibilitychange", onVisibilityChange);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("pointerlockchange", onPointerLockChange);
      canvas.addEventListener("mousedown", onMouseDown);
      canvas.addEventListener("mouseup", onMouseUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("contextmenu", onContextMenu);
      options.onPoseChange?.({ ...pose });
      options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
      options.onMovementModeChange?.("idle", 0.5);
      // Seed a complete frozen frame for a paused HMR remount. The RAF heartbeat
      // then refreshes that retained geometry at a bounded cadence so a menu or
      // browser-compositor repaint cannot clear the pose preview.
      if (paused && !firstPersonFeedbackHidden && playerHealth > 0
        && document.visibilityState === "visible") {
        render(pausedVisualTime, 0, pausedVisualTime);
        lastPausedRenderAt = pausedVisualTime;
      }
      frameId = requestAnimationFrame(frame);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      resetMovementView();
      cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      cancelPrimaryActionHold();
      cancelSecondaryPlacementHold(true);
      clearRangedCharge();
      for (const mesh of chunkMeshes.values()) {
        if (mesh.textureBuffer) gl.deleteBuffer(mesh.textureBuffer);
        if (mesh.transparentBuffer) gl.deleteBuffer(mesh.transparentBuffer);
        if (mesh.colorBuffer) gl.deleteBuffer(mesh.colorBuffer);
      }
      chunkMeshes.clear();
      pendingChunkMeshRebuilds.clear();
      loadedChunkKeys.clear();
      chunkBlocks.clear();
      blocks.clear();
      primedTnt.clear();
      torchLights.clear();
      mobTorchColumns.clear();
      remotePlayerRenderer.destroy();
      playerSkinRenderer.destroy();
      firstPersonSkinRenderer.destroy();
      droppedItemRenderer.destroy();
      playerProjectileRenderer.destroy();
      destroyFirstPersonRenderer();
      blockParticles.clear();
      gl.deleteBuffer(particleBuffer);
      gl.deleteBuffer(lineBuffer);
      gl.deleteBuffer(crackBuffer);
      gl.deleteBuffer(atmosphereBuffer);
      mobRenderer.destroy();
      gl.deleteProgram(program);
      gl.deleteProgram(terrainProgram);
      gl.deleteProgram(atmosphereProgram);
      gl.deleteTexture(terrainTexture);
    },
    applyWorldEdits(edits) {
      return commitWorldEditBatch(edits, true) !== null;
    },
    applyMobCombatStates(states, nextServerTimeOffsetMs) {
      if (Number.isFinite(nextServerTimeOffsetMs)) mobCombatServerTimeOffsetMs = nextServerTimeOffsetMs as number;
      applyAuthoritativeMobCombatStates(
        mobSimulation,
        states,
        Date.now() + mobCombatServerTimeOffsetMs,
      );
      writeReactiveMobPoseSnapshots();
    },
    applyMobMotionSnapshot(poses: readonly MobMotionPose[], nextServerTimeOffsetMs?: number) {
      if (Number.isFinite(nextServerTimeOffsetMs)) mobCombatServerTimeOffsetMs = nextServerTimeOffsetMs as number;
      const now = performance.now();
      const priorAlpha = sharedMobMotionActive
        ? clampNumber((now - sharedMobMotionAppliedAt) / sharedMobMotionIntervalMs, 0, 1)
        : 1;
      if (sharedMobMotionActive && sharedMobMotionAppliedAt > 0) {
        const observedInterval = now - sharedMobMotionAppliedAt;
        if (observedInterval >= 80 && observedInterval <= 2_000) {
          sharedMobMotionIntervalMs = clampNumber(observedInterval, 100, 750);
        }
      }
      const byId = new Map(poses.map((pose) => [pose.mobId, pose] as const));
      for (const mob of mobSimulation.mobs) {
        const authoritative = byId.get(mob.id);
        if (!authoritative || authoritative.kind !== mob.kind) continue;
        const displayedX = mob.previousX + (mob.x - mob.previousX) * priorAlpha;
        const displayedY = mob.previousY + (mob.y - mob.previousY) * priorAlpha;
        const displayedZ = mob.previousZ + (mob.z - mob.previousZ) * priorAlpha;
        const displayedYaw = mob.previousYaw + (mob.yaw - mob.previousYaw) * priorAlpha;
        mob.previousX = displayedX;
        mob.previousY = displayedY;
        mob.previousZ = displayedZ;
        mob.previousYaw = displayedYaw;
        mob.x = authoritative.x;
        mob.y = authoritative.y;
        mob.z = authoritative.z;
        mob.yaw = authoritative.yaw;
        mob.behavior = authoritative.behavior;
        mob.hostileActive = authoritative.behavior === "chase" || authoritative.behavior === "fuse";
        if (mob.kind === "creeper" && authoritative.fuseProgress > 0) {
          const fuseDurationSeconds = 1.5;
          mob.fuseStartedAtSeconds = mobSimulation.elapsedSeconds
            - clampNumber(authoritative.fuseProgress, 0, 1) * fuseDurationSeconds;
          mob.fuseUntilSeconds = mob.fuseStartedAtSeconds + fuseDurationSeconds;
        } else if (mob.kind === "creeper") {
          mob.fuseStartedAtSeconds = 0;
          mob.fuseUntilSeconds = 0;
        }
      }
      sharedMobMotionActive = true;
      sharedMobMotionAppliedAt = now;
      mobProjectileSnapshots.length = 0;
      writeReactiveMobPoseSnapshots();
    },
    getMobIds() {
      return mobIds.slice();
    },
    shearMob(mobId, acceptWool) {
      const result = shearLocalMob(mobSimulation, mobId, acceptWool);
      if (result.ok) writeReactiveMobPoseSnapshots();
      return result;
    },
    damageLocalMobWithRangedShot(mobId, damage, eventId, sourceX, sourceZ) {
      const result = damageMob(mobSimulation, mobId, damage, options.onMobDrops);
      if (result.applied) {
        if (!result.killed) applyConfirmedPlayerHitMobKnockback(eventId, mobId, sourceX, sourceZ, damage);
        writeReactiveMobPoseSnapshots();
      }
      return result;
    },
    applyConfirmedPlayerHitMobKnockback,
    setSelectedBlock(block) {
      if (block !== selectedBlock) cancelSecondaryPlacementHold();
      selectedBlock = block;
      clearMining();
    },
    setSelectedItem(itemId) {
      selectedItem = itemId && itemId in ITEMS ? itemId : null;
      setFirstPersonHeldItem(selectedItem, selectedBlock);
      if (paused) lastPausedRenderAt = Number.NEGATIVE_INFINITY;
    },
    setPlayerSkin(source, model) {
      playerSkinRenderer.setSkin(source, model);
      firstPersonSkinRenderer.setSkin(source, model);
      if (paused) lastPausedRenderAt = Number.NEGATIVE_INFINITY;
    },
    setPlayerArmor(appearance) {
      playerSkinRenderer.setArmor(appearance);
      if (paused) lastPausedRenderAt = Number.NEGATIVE_INFINITY;
    },
    cycleCameraMode() {
      cameraMode = nextPlayerCameraMode(cameraMode);
      if (paused) lastPausedRenderAt = Number.NEGATIVE_INFINITY;
      return cameraMode;
    },
    getCameraMode() {
      return cameraMode;
    },
    setFirstPersonFeedbackHidden(hidden) {
      const nextHidden = hidden === true;
      if (firstPersonFeedbackHidden === nextHidden) return;
      firstPersonFeedbackHidden = nextHidden;
      if (paused) lastPausedRenderAt = Number.NEGATIVE_INFINITY;
      if (nextHidden && running && !paused) {
        const now = performance.now();
        render(now, 0, now);
      }
    },
    setPoseLabDrawPreview(drawn) {
      const next = drawn === null ? null : drawn === true;
      if (firstPersonBowPreviewDrawn === next) return;
      firstPersonBowPreviewDrawn = next;
      if (paused) lastPausedRenderAt = Number.NEGATIVE_INFINITY;
    },
    setRemotePlayers(players) {
      const now = performance.now();
      const incomingIds = new Set<string>();
      for (const player of players.slice(0, MAX_REMOTE_PLAYERS)) {
        const id = String(player.id).slice(0, 128);
        if (!id || incomingIds.has(id)) continue;
        incomingIds.add(id);
        const current = remoteStates.get(id);
        if (current) applyRemoteAvatarSnapshot(current, player, now);
        else remoteStates.set(id, createRemoteAvatarMotion({ ...player, id }, now));
      }
      for (const id of remoteStates.keys()) {
        if (!incomingIds.has(id)) remoteStates.delete(id);
      }
    },
    setDroppedItems(items) {
      droppedItemRenderer.setItems(items);
    },
    setPlayerProjectiles(projectiles: readonly PlayerProjectileVisual[]) {
      playerProjectileRenderer.setProjectiles(projectiles);
    },
    spawnBlockParticles(event) {
      return blockParticles.spawn(event);
    },
    setPrimedTnt(x, y, z, primed) {
      const key = blockKey(x, y, z);
      if (primed) {
        if (getBlock(x, y, z) !== BLOCK.TNT) return false;
        if (!mobRenderer.setLocalPrimedTnt(x, y, z, true)) return false;
        primedTnt.add(key);
      } else {
        primedTnt.delete(key);
        mobRenderer.setLocalPrimedTnt(x, y, z, false);
      }
      rebuildWorldChunks(
        dirtyChunkKeysForEdits([{ x, y, z, block: BLOCK.TNT }]).filter((owner) => loadedChunkKeys.has(owner)),
      );
      return true;
    },
    setPrimedTntFuses(fuses: readonly PrimedTntVisualFuse[], authoritativeNow?: number) {
      const nextKeys = new Set<string>();
      const visibleFuses: PrimedTntVisualFuse[] = [];
      for (const fuse of fuses) {
        if (visibleFuses.length >= mobRenderer.maximumPrimedTnt) break;
        if (![fuse.x, fuse.y, fuse.z].every(Number.isSafeInteger)) continue;
        if (getBlock(fuse.x, fuse.y, fuse.z) !== BLOCK.TNT) continue;
        const key = blockKey(fuse.x, fuse.y, fuse.z);
        if (nextKeys.has(key)) continue;
        nextKeys.add(key);
        visibleFuses.push(fuse);
      }
      const changed: WorldEdit[] = [];
      for (const key of primedTnt) {
        if (nextKeys.has(key)) continue;
        const [x, y, z] = key.split(",").map(Number);
        changed.push({ x, y, z, block: BLOCK.TNT });
      }
      for (const key of nextKeys) {
        if (primedTnt.has(key)) continue;
        const [x, y, z] = key.split(",").map(Number);
        changed.push({ x, y, z, block: BLOCK.TNT });
      }
      primedTnt.clear();
      for (const key of nextKeys) primedTnt.add(key);
      const accepted = mobRenderer.setPrimedTntFuses(visibleFuses, authoritativeNow);
      if (changed.length) {
        rebuildWorldChunks(dirtyChunkKeysForEdits(changed).filter((owner) => loadedChunkKeys.has(owner)));
      }
      return accepted;
    },
    explodeTnt(x, y, z) {
      const sourceKey = blockKey(x, y, z);
      if (!primedTnt.has(sourceKey) || getBlock(x, y, z) !== BLOCK.TNT) return [];
      const blast = {
        center: { x: x + 0.5, y, z: z + 0.5 },
        radius: CREEPER_EXPLOSION_RADIUS,
      };
      const exposure = sampleCreeperExplosionExposure(blast, pose, (cell) =>
        cell.x === x && cell.y === y && cell.z === z
          ? "air"
          : localCreeperExposureBlock(getBlock(cell.x, cell.y, cell.z)));
      const rawDamage = resolveLocalTntExplosionDamage(blast, pose, exposure);
      const edits = planLocalTntExplosion(x, y, z, getBlock);
      const appliedEdits = applyLocalExplosionEdits(edits);
      if (!appliedEdits) return [];
      const damage = rawDamage > 0
        ? mitigatedPlayerDamage(rawDamage, options.getPlayerProtection?.() ?? 0)
        : 0;
      const appliedDamage = Math.min(playerHealth, damage);
      if (appliedDamage > 0 && options.canTakePlayerDamage?.() !== false) {
        playerHealth -= appliedDamage;
        options.onPlayerDamage?.(appliedDamage, "tnt");
        options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
      }
      primedTnt.delete(sourceKey);
      mobRenderer.setLocalPrimedTnt(x, y, z, false);
      return appliedEdits;
    },
    settleFallingBlocks(edit, previousBlock) {
      const settled = planLocalFallingBlockSettlement(edit, previousBlock, getBlock);
      if (settled.length === 0) return [];
      return commitWorldEditBatch(settled) ?? [];
    },
    setDayNightClock(config, nextServerTimeOffsetMs) {
      serverTimeOffsetMs = applyDayNightClockUpdate(
        dayNightConfig,
        config,
        serverTimeOffsetMs,
        nextServerTimeOffsetMs,
      );
      worldTimeMs = Date.now() + serverTimeOffsetMs;
      if (running && !paused) {
        const now = performance.now();
        render(now, 0, now);
      }
    },
    setRenderDistance(radius) {
      const next = clampNumber(Math.floor(radius), 1, MAX_LOCAL_STREAMING_CHUNK_RADIUS);
      if (next === streamingChunkRadius) return streamingChunkRadius;
      streamingChunkRadius = next;
      updateStreamingWindow(true);
      return streamingChunkRadius;
    },
    setPaused(nextPaused) {
      const next = nextPaused === true;
      if (paused === next) return paused;
      paused = next;
      clearHeldMovementInput();
      velocity[0] = 0;
      velocity[1] = 0;
      velocity[2] = 0;
      knockbackVelocity[0] = 0;
      knockbackVelocity[2] = 0;
      cancelPrimaryActionHold();
      cancelSecondaryPlacementHold(true);
      clearRangedCharge(true);
      resetMovementView();
      if (paused) {
        pausedStartedAt = performance.now();
        pausedVisualTime = pausedStartedAt;
        lastPausedRenderAt = Number.NEGATIVE_INFINITY;
      } else {
        const resumedAt = performance.now();
        if (sharedMobMotionAppliedAt > 0) {
          sharedMobMotionAppliedAt += Math.max(0, resumedAt - pausedStartedAt);
        }
        pausedStartedAt = 0;
        pausedVisualTime = 0;
        lastPausedRenderAt = Number.NEGATIVE_INFINITY;
        lastFrame = resumedAt;
      }
      return paused;
    },
    isPaused() {
      return paused;
    },
    cancelRangedActionForEscape() {
      if (rangedChargeStartedAt <= 0) return false;
      cancelSecondaryPlacementHold(true);
      clearRangedCharge(true);
      return true;
    },
    setRespawnPoint(point) {
      const validated = validateRespawnPoint(point, Number.MAX_SAFE_INTEGER);
      if (validated) respawnPoint = validated;
    },
    setPlayerHealth(health) {
      const nextHealth = Number.isFinite(health)
        ? clampNumber(health, 0, PLAYER_MAX_HEALTH)
        : playerHealth;
      if (nextHealth !== playerHealth) {
        playerHealth = nextHealth;
        options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
      }
      return playerHealth;
    },
    adjustPlayerHealth(delta) {
      const change = Number.isFinite(delta) ? delta : 0;
      const nextHealth = clampNumber(playerHealth + change, 0, PLAYER_MAX_HEALTH);
      if (nextHealth !== playerHealth) {
        playerHealth = nextHealth;
        options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
      }
      return playerHealth;
    },
    applyConfirmedMobKnockback,
    reconcilePose(nextPose) {
      cancelSecondaryPlacementHold(true);
      pose.x = nextPose.x;
      pose.y = nextPose.y;
      pose.z = nextPose.z;
      pose.yaw = nextPose.yaw;
      pose.pitch = nextPose.pitch;
      clearPlayerMotion();
      playerViewSuspended = false;
      fallAirborne = false;
      fallPeakY = pose.y;
      updateStreamingWindow(true);
      poseDirty = true;
      options.onPoseChange?.({ ...pose });
    },
    getPose() { return { ...pose }; },
    getRespawnPoint() { return { ...respawnPoint }; },
    getPlayerHealth() { return playerHealth; },
    getWorldTimeMs() { return worldTimeMs; },
    exportRuntimeSnapshot() {
      return {
        version: VOXEL_RUNTIME_SNAPSHOT_VERSION,
        pose: { ...pose },
        respawnPoint: { ...respawnPoint },
        playerHealth,
        worldTimeMs,
        dayNight: { ...dayNightConfig },
        mobAccumulatorSeconds,
        mobSimulation: exportMobSimulationSnapshot(mobSimulation),
      };
    },
    importRuntimeSnapshot(value) {
      const snapshot = validateVoxelRuntimeSnapshot(value);
      if (!snapshot || !restoreMobSimulationSnapshot(mobSimulation, snapshot.mobSimulation)) return false;
      pose.x = snapshot.pose.x;
      pose.y = snapshot.pose.y;
      pose.z = snapshot.pose.z;
      pose.yaw = snapshot.pose.yaw;
      pose.pitch = snapshot.pose.pitch;
      respawnPoint = { ...snapshot.respawnPoint };
      playerHealth = snapshot.playerHealth;
      worldTimeMs = snapshot.worldTimeMs;
      dayNightConfig.cycleLengthMs = snapshot.dayNight.cycleLengthMs;
      dayNightConfig.epochMs = snapshot.dayNight.epochMs;
      dayNightConfig.epochPhase = snapshot.dayNight.epochPhase;
      serverTimeOffsetMs = worldTimeMs - Date.now();
      mobCombatServerTimeOffsetMs = serverTimeOffsetMs;
      mobAccumulatorSeconds = snapshot.mobAccumulatorSeconds;
      mobIds = listMobIds(mobSimulation);
      sharedMobMotionActive = false;
      clearPlayerMotion(false);
      clearMining();
      cancelSecondaryPlacementHold(true);
      clearRangedCharge(true);
      resetMovementView();
      playerViewSuspended = playerHealth <= 0;
      fallAirborne = false;
      fallPeakY = pose.y;
      target = null;
      updateStreamingWindow(true);
      writeReactiveMobPoseSnapshots();
      writeMobProjectileSnapshots(mobSimulation, mobProjectileSnapshots);
      poseDirty = true;
      options.onPoseChange?.({ ...pose });
      options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
      return true;
    },
    getTarget() { return target ? { block: { ...target.block }, place: { ...target.place }, distance: target.distance } : null; },
    getBlockAt(x, y, z) {
      if (![x, y, z].every(Number.isSafeInteger)) return BLOCK.AIR;
      return getBlock(x, y, z);
    },
    findNearestCave,
    getBedAt(x, y, z) {
      if (![x, y, z].every(Number.isSafeInteger)) return null;
      return getStoredBedAt(x, y, z);
    },
    exportBedStructures() {
      return [...bedStructures.values()]
        .sort((left, right) => bedStructureKey(left).localeCompare(bedStructureKey(right)))
        .map((bed) => createBedStructure(bed.foot, bed.direction));
    },
    getPerformanceStats,
    requestPointerLock() { return requestCanvasPointerLock(); },
    respawn() {
      cancelSecondaryPlacementHold(true);
      pose.x = respawnPoint.x;
      pose.z = respawnPoint.z;
      pose.yaw = respawnPoint.yaw;
      pose.pitch = respawnPoint.pitch;
      updateStreamingWindow(true);
      pose.y = resolveSafeSpawnY(
        respawnPoint.y,
        respawnPoint.y,
        (candidateY) => collides(respawnPoint.x, candidateY, respawnPoint.z),
      );
      clearPlayerMotion();
      playerViewSuspended = false;
      fallAirborne = false;
      fallPeakY = pose.y;
      playerHealth = PLAYER_MAX_HEALTH;
      poseDirty = true;
      options.onPoseChange?.({ ...pose });
      options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
    },
  };
}
