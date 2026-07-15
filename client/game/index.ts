export { createVoxelEngine } from "./voxelEngine.ts";
export {
  DEFAULT_FOV_RADIANS,
  SNEAKING_BODY_HEIGHT,
  SNEAKING_EYE_HEIGHT,
  SNEAK_SPEED,
  SPRINT_FOV_RADIANS,
  SPRINT_SPEED,
  STANDING_BODY_HEIGHT,
  STANDING_EYE_HEIGHT,
  WALK_SPEED,
  clampSneakAxisMovement,
  movementActivityMultiplier,
  normalizeMovementInput,
  postureTargetsForMovement,
  resolvePlayerMovement,
  resolveSneakIntent,
  sampleHeadBob,
  smoothMovementValue,
  smoothPlayerPosture,
  writeHorizontalMovementDelta,
  writePlayerEye,
} from "./playerMovement.ts";
export { BED_MESH_VERTEX_COUNT, CHEST_MESH_VERTEX_COUNT, DOOR_MESH_VERTEX_COUNT, MAX_ACTIVE_TORCH_LIGHTS, MAX_RESPAWN_HEIGHT, PLAYER_MAX_HEALTH, STONE_BRICK_SLAB_MESH_VERTEX_COUNT, TORCH_LIGHT_RADIUS, TORCH_MESH_VERTEX_COUNT, appendBedMesh, appendChestMesh, appendDoorMesh, appendStoneBrickSlabMesh, appendTorchMesh, applyDayNightClockUpdate, blockHasCollision, blockOccludesFaces, createDoorToggleEdit, doorPlacementBlock, isDoorBlock, planLocalFallingBlockSettlement, planLocalTntExplosion, resolveSafeSpawnY, selectNearestTorchLights, toggledDoorBlock, tryInteractBlock, validateRespawnPoint } from "./voxelEngine.ts";
export { STONE_BRICK_SLAB_HEIGHT, blockCollisionHeight, blockContainsSolidPoint, blockSupportsPlayerFeet, playerIntersectsBlockCollisionHeight } from "./blockGeometry.ts";
export { BLOCK } from "./types.ts";
export { blockKey, createTerrain, raycastVoxels, terrainHeight } from "./terrain.ts";
export { WORLD_CHUNK_SIZE, chunkCoordinate, chunkKeyForBlock, dirtyChunkKeysForEdit, dirtyChunkKeysForEdits } from "./chunks.ts";
export { MAX_PRIMED_TNT_VISUALS, PRIMED_TNT_VERTICES_PER_ENTITY, createMobRenderer, mobVertexCountForKind, primedTntBufferBytes, samplePrimedTntVisual } from "./mobRenderer.ts";
export { DROPPED_ITEM_MESH_INTERVAL_MS, DROPPED_ITEM_RENDER_DISTANCE, DROPPED_ITEM_VERTICES_PER_ITEM, MAX_RENDERED_DROPPED_ITEMS, createDroppedItemRenderer, droppedItemBufferCapacity, writeDroppedItemGeometry } from "./droppedItemRenderer.ts";
export { MAX_RENDERED_PLAYER_PROJECTILES, PLAYER_PROJECTILE_GRAVITY, PLAYER_PROJECTILE_LIFETIME_MS, PLAYER_PROJECTILE_MESH_INTERVAL_MS, PLAYER_PROJECTILE_RENDER_DISTANCE, PLAYER_PROJECTILE_VERTICES, createPlayerProjectileRenderer, playerProjectileBufferCapacity, samplePlayerProjectile } from "./playerProjectileRenderer.ts";
export { AVATAR_VERTICES_PER_PLAYER, MAX_NAMEPLATE_VERTICES_PER_PLAYER, REMOTE_MESH_INTERVAL_MS, createRemotePlayerRenderer, remotePlayerBufferCapacity, writeRemotePlayerGeometry } from "./remotePlayerRenderer.ts";
export {
  MAX_CONTACT_DAMAGE_PER_TICK,
  MOB_COMBAT_AUTHORITY,
  MOB_DEFINITIONS,
  applyAuthoritativeMobCombatStates,
  consumeMobContactDamage,
  createMobSimulation,
  createMobSpawns,
  damageMob,
  listMobIds,
  mobTargetHasClickPriority,
  raycastMobs,
  shearLocalMob,
  respawnExpiredAuthoritativeMobs,
  stepMobSimulation,
  writeMobPoseSnapshots,
} from "./mobs.ts";
export {
  DEFAULT_DAY_NIGHT_CONFIG,
  MORNING_PHASE,
  createDayNightState,
  phaseAtTime,
  sampleDayNight,
  timeToMorningMs,
} from "./dayNight.ts";
export {
  ATMOSPHERE_SCREEN_TRIANGLE,
  atmosphereLightLevels,
  celestialDirection,
  writeCelestialDirection,
} from "./atmosphere.ts";
export {
  MAX_PLAYER_NAME_LENGTH,
  MAX_REMOTE_PLAYERS,
  advanceRemoteAvatarMotion,
  applyRemoteAvatarSnapshot,
  createRemoteAvatarMotion,
  sanitizePlayerName,
  shortestAngleDelta,
} from "./avatar.ts";
export type {
  BlockId,
  BlockTarget,
  LocalExplosionEdit,
  PlayerPose,
  PrimedTntVisualFuse,
  RemotePlayer,
  RespawnPoint,
  RangedShotIntent,
  RangedShotTarget,
  VoxelEngine,
  VoxelEngineOptions,
  VoxelPerformanceStats,
  WorldEdit,
} from "./types.ts";
export type { LocalMobShearResult, MobBehavior, MobCombatApplyResult, MobCombatStateSnapshot, MobDefinition, MobDrop, MobKind, MobPoseSnapshot, MobRayTarget, MobSimulation, MobState } from "./mobs.ts";
export type { DayNightConfig, DayNightState, TimeOfDayLabel } from "./dayNight.ts";
export type { HeadBobOffsets, HorizontalMovementDelta, NormalizedMovementInput, PlayerEye, PlayerMovementInput, PlayerMovementMode, PlayerPostureTargets, ResolvedPlayerMovement } from "./playerMovement.ts";
export type { DroppedItemGeometryStats, DroppedItemRenderItem, DroppedItemRenderer, DroppedItemRenderStats } from "./droppedItemRenderer.ts";
export type { BallisticSample, PlayerProjectileRenderer, PlayerProjectileRenderStats, PlayerProjectileVisual } from "./playerProjectileRenderer.ts";
export type { PrimedTntVisualSample } from "./mobRenderer.ts";
