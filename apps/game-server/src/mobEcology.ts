import {
  type MobAuthorityKind,
  type MobAuthorityState,
} from "../../../shared/mobCombat.ts";
import { createDeterministicMobSpawnLayout } from "../../../shared/mobSpawnLayout.ts";
import {
  MOB_MOTION_TICKS_PER_SECOND,
  MOB_MOTION_UNITS_PER_BLOCK,
  createMobMotionState,
  restoreMobMotionCheckpoint,
  stepMobMotion,
  writeMobMotionCheckpoint,
  writeMobMotionPoses,
  type MobMotionPose,
  type MobMotionState,
  type MobMotionTargetSnapshot,
} from "../../../shared/mobMotionAuthority.ts";
import type { WorldStore } from "./database.ts";
import { WORLD_TERRAIN_SEED, type TerrainAuthority } from "./terrain.ts";
import { BLOCK_TYPES } from "../../../shared/protocol.ts";

export const RAILWAY_MOB_PASSIVE_CAP = 8;
export const RAILWAY_MOB_HOSTILE_CAP = 4;
export const RAILWAY_MOB_POPULATION_CAP = RAILWAY_MOB_PASSIVE_CAP + RAILWAY_MOB_HOSTILE_CAP;
export const RAILWAY_MOB_SPAWN_RADIUS = 22;
export const RAILWAY_MOB_CLEAR_RADIUS = 12;
const ECOLOGY_REHOME_DISTANCE = 18;
const ECOLOGY_RETAIN_DISTANCE = 32;
const HABITAT_REFRESH_INTERVAL_MS = 2_000;
const CHECKPOINT_INTERVAL_MS = 5_000;
const CONTACT_COOLDOWN_TICKS = MOB_MOTION_TICKS_PER_SECOND;
const PASSIVE_KINDS = new Set<MobAuthorityKind>(["pig", "cow", "sheep", "chicken"]);

export interface RailwayMobSnapshot {
  serverNow: number;
  tick: number;
  poses: MobMotionPose[];
  states: MobAuthorityState[];
}

export interface RailwayMobContactHit {
  operationId: string;
  mobId: string;
  targetId: string;
  damage: number;
  attackerX: number;
  attackerZ: number;
}

export class RailwayMobEcology {
  private state: MobMotionState | null = null;
  private centerX = 0;
  private centerZ = 0;
  private nightMode = false;
  private epoch = 0;
  private lastCheckpointAt = Number.NEGATIVE_INFINITY;
  private lastHabitatRefreshAt = Number.NEGATIVE_INFINITY;
  private readonly contactReadyTick = new Map<string, number>();

  constructor(
    readonly enabled: boolean,
    private readonly terrain: TerrainAuthority,
    private readonly store: WorldStore,
    spawnX: number,
    spawnZ: number,
  ) {
    this.centerX = Math.floor(spawnX);
    this.centerZ = Math.floor(spawnZ);
    if (!enabled) return;
    const saved = store.loadMobWorld();
    const restored = saved ? restoreMobMotionCheckpoint(saved.checkpoint) : null;
    if (saved && restored) {
      this.state = restored;
      this.centerX = saved.centerX;
      this.centerZ = saved.centerZ;
      this.nightMode = saved.nightMode;
      this.epoch = restored.epoch;
      this.lastCheckpointAt = saved.updatedAt;
    }
  }

  tick(targets: readonly MobMotionTargetSnapshot[], isNight: boolean, serverNow: number): RailwayMobContactHit[] {
    if (!this.enabled) return [];
    const center = populationCenter(targets, this.centerX, this.centerZ);
    if (!this.state) {
      this.rebuild(center.x, center.z, isNight, serverNow);
    } else {
      if (Math.max(Math.abs(center.x - this.centerX), Math.abs(center.z - this.centerZ)) >= ECOLOGY_REHOME_DISTANCE) {
        this.centerX = center.x;
        this.centerZ = center.z;
      }
      this.nightMode = isNight;
      if (serverNow - this.lastHabitatRefreshAt >= HABITAT_REFRESH_INTERVAL_MS) {
        this.refreshOneHabitat(isNight);
        this.lastHabitatRefreshAt = serverNow;
      }
    }
    if (!this.state) return [];
    // Cave hostiles must stay active during daylight. Surface hostiles exist
    // only in the night layout, so the motion authority can safely run the
    // hostile behavior gate for every server-owned hostile here.
    stepMobMotion(this.state, { isNight: true, targets });
    this.clampMotionToHabitat();
    if (serverNow - this.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) this.persist(serverNow);
    return this.contactHits(targets, serverNow);
  }

  snapshot(serverNow: number): RailwayMobSnapshot {
    if (!this.enabled || !this.state) return { serverNow, tick: 0, poses: [], states: [] };
    const poses = writeMobMotionPoses(this.state);
    return {
      serverNow,
      tick: this.state.tick,
      poses,
      states: this.store.mobAuthorityStates(poses, serverNow),
    };
  }

  pose(mobId: string): MobMotionPose | null {
    if (!this.state) return null;
    return writeMobMotionPoses(this.state).find((pose) => pose.mobId === mobId) ?? null;
  }

  persist(serverNow = Date.now()): void {
    if (!this.enabled || !this.state) return;
    this.store.saveMobWorld({
      checkpoint: writeMobMotionCheckpoint(this.state),
      centerX: this.centerX,
      centerZ: this.centerZ,
      nightMode: this.nightMode,
      updatedAt: serverNow,
    });
    this.lastCheckpointAt = serverNow;
  }

  private rebuild(centerX: number, centerZ: number, isNight: boolean, serverNow: number): void {
    this.centerX = Math.round(centerX);
    this.centerZ = Math.round(centerZ);
    this.nightMode = isNight;
    this.epoch += 1;
    const spawns = this.desiredSpawns(isNight);
    this.state = createMobMotionState({ seed: WORLD_TERRAIN_SEED, epoch: this.epoch, snapshot: spawns.map((spawn) => ({
      mobId: spawn.id,
      kind: spawn.kind,
      x: spawn.x + 0.5,
      y: spawn.y,
      z: spawn.z + 0.5,
      yaw: spawn.yaw,
    })) });
    this.contactReadyTick.clear();
    this.lastHabitatRefreshAt = serverNow;
    this.persist(serverNow);
  }

  private desiredSpawns(isNight: boolean) {
    return createDeterministicMobSpawnLayout({
      seed: WORLD_TERRAIN_SEED,
      radius: RAILWAY_MOB_SPAWN_RADIUS,
      centerX: this.centerX,
      centerZ: this.centerZ,
      terrainHeight: (x, z) => this.terrain.height(x, z),
      resolveSpawnPosition: (kind, x, surfaceY, z, attempt) => {
        if (PASSIVE_KINDS.has(kind)) return [x, surfaceY, z] as const;
        if (isNight && attempt % 2 === 0) return [x, surfaceY, z] as const;
        return this.findCaveFloor(x, surfaceY, z, attempt);
      },
      isSpawnable: (_kind, x, y, z) => this.canStand(x, y, z),
      maxPopulation: RAILWAY_MOB_POPULATION_CAP,
      passivePopulation: RAILWAY_MOB_PASSIVE_CAP,
      hostilePopulation: RAILWAY_MOB_HOSTILE_CAP,
      spawnClearRadius: RAILWAY_MOB_CLEAR_RADIUS,
      hardMaxPopulation: 64,
    });
  }

  private refreshOneHabitat(isNight: boolean): void {
    if (!this.state) return;
    const desired = new Map(this.desiredSpawns(isNight).map((spawn) => [spawn.id, spawn] as const));
    for (const mob of this.state.mobs) {
      const replacement = desired.get(mob.mobId);
      if (!replacement) continue;
      const homeX = mob.homeX / MOB_MOTION_UNITS_PER_BLOCK;
      const homeZ = mob.homeZ / MOB_MOTION_UNITS_PER_BLOCK;
      const outside = Math.max(Math.abs(homeX - this.centerX), Math.abs(homeZ - this.centerZ)) > ECOLOGY_RETAIN_DISTANCE;
      const verticalChanged = Math.abs(mob.y / MOB_MOTION_UNITS_PER_BLOCK - replacement.y) > 2;
      if (!outside && (!PASSIVE_KINDS.has(mob.kind) ? !verticalChanged : true)) continue;
      mob.x = mob.homeX = Math.round((replacement.x + 0.5) * MOB_MOTION_UNITS_PER_BLOCK);
      mob.y = Math.round(replacement.y * MOB_MOTION_UNITS_PER_BLOCK);
      mob.z = mob.homeZ = Math.round((replacement.z + 0.5) * MOB_MOTION_UNITS_PER_BLOCK);
      mob.yaw = Math.round(replacement.yaw * 1_000_000);
      mob.directionX = 0;
      mob.directionZ = 0;
      mob.behaviorUntilTick = this.state.tick;
      mob.targetUserId = "";
      mob.fuseStartedTick = 0;
      mob.fuseUntilTick = 0;
      return;
    }
  }

  private findCaveFloor(
    originX: number,
    surfaceY: number,
    originZ: number,
    attempt: number,
  ): readonly [number, number, number] | null {
    for (let offset = 0; offset < 25; offset += 1) {
      const index = (offset + attempt) % 25;
      const x = originX + index % 5 - 2;
      const z = originZ + Math.floor(index / 5) - 2;
      for (let y = surfaceY - 3; y >= -62; y -= 1) {
        if (this.canStand(x, y, z) && this.hasSkyRoof(x, y, z)) return [x, y, z];
      }
    }
    return null;
  }

  private hasSkyRoof(x: number, y: number, z: number): boolean {
    const top = this.terrain.height(x, z);
    for (let probeY = y + 2; probeY <= top; probeY += 1) {
      if (!passableBlock(this.terrain.blockAt(x, probeY, z))) return true;
    }
    return false;
  }

  private canStand(x: number, y: number, z: number): boolean {
    return passableBlock(this.terrain.blockAt(x, y, z))
      && passableBlock(this.terrain.blockAt(x, y + 1, z))
      && !passableBlock(this.terrain.blockAt(x, y - 1, z));
  }

  private clampMotionToHabitat(): void {
    if (!this.state) return;
    for (const mob of this.state.mobs) {
      const x = Math.floor(mob.x / MOB_MOTION_UNITS_PER_BLOCK);
      const z = Math.floor(mob.z / MOB_MOTION_UNITS_PER_BLOCK);
      const homeY = Math.floor(mob.y / MOB_MOTION_UNITS_PER_BLOCK);
      let resolvedY: number | null = null;
      for (let delta = 1; delta >= -1; delta -= 1) {
        if (this.canStand(x, homeY + delta, z)) { resolvedY = homeY + delta; break; }
      }
      if (resolvedY === null) {
        mob.x = mob.homeX;
        mob.z = mob.homeZ;
        mob.directionX = 0;
        mob.directionZ = 0;
      } else {
        mob.y = resolvedY * MOB_MOTION_UNITS_PER_BLOCK;
      }
    }
  }

  private contactHits(targets: readonly MobMotionTargetSnapshot[], serverNow: number): RailwayMobContactHit[] {
    if (!this.state) return [];
    const targetById = new Map(targets.filter((target) => target.active !== false).map((target) => [target.userId, target]));
    const states = new Map(this.store.mobAuthorityStates(this.state.mobs, serverNow).map((state) => [state.mobId, state]));
    const hits: RailwayMobContactHit[] = [];
    for (const mob of this.state.mobs) {
      if (PASSIVE_KINDS.has(mob.kind) || !mob.targetUserId || (states.get(mob.mobId)?.health ?? 0) <= 0) continue;
      const target = targetById.get(mob.targetUserId);
      if (!target) continue;
      const x = mob.x / MOB_MOTION_UNITS_PER_BLOCK;
      const y = mob.y / MOB_MOTION_UNITS_PER_BLOCK;
      const z = mob.z / MOB_MOTION_UNITS_PER_BLOCK;
      // Creeper terrain/player explosions already have a stricter shared fuse
      // contract; do not degrade them into immediate melee damage here.
      if (mob.kind === "creeper") continue;
      const reach = mob.kind === "spider" ? 1.35 : 1.15;
      if (Math.hypot(target.x - x, target.z - z) > reach || Math.abs(target.y - y) > 2.2) continue;
      const key = `${mob.mobId}\u0000${target.userId}`;
      if ((this.contactReadyTick.get(key) ?? 0) > this.state.tick) continue;
      this.contactReadyTick.set(key, this.state.tick + CONTACT_COOLDOWN_TICKS);
      const damage = mob.kind === "zombie" ? 3 : 2;
      hits.push({
        operationId: `mob:${mob.mobId}:${this.state.tick.toString(36)}:${target.userId}`.slice(0, 96),
        mobId: mob.mobId,
        targetId: target.userId,
        damage,
        attackerX: x,
        attackerZ: z,
      });
    }
    return hits;
  }
}

function populationCenter(
  targets: readonly MobMotionTargetSnapshot[],
  fallbackX: number,
  fallbackZ: number,
): { x: number; z: number } {
  const active = targets.filter((target) => target.active !== false);
  if (!active.length) return { x: fallbackX, z: fallbackZ };
  const selected = active.slice().sort((left, right) =>
    (left.x - fallbackX) ** 2 + (left.z - fallbackZ) ** 2
      - ((right.x - fallbackX) ** 2 + (right.z - fallbackZ) ** 2)
    || left.userId.localeCompare(right.userId))[0];
  return { x: Math.round(selected.x), z: Math.round(selected.z) };
}

function passableBlock(blockId: number): boolean {
  const name = BLOCK_TYPES[blockId] ?? "";
  return name === "air" || name === "torch" || name === "ladder" || name === "sapling"
    || name === "door_open" || name.endsWith("_fence_gate_open") || name.startsWith("wall_torch_");
}
