import {
  type MobAuthorityKind,
  type MobAuthorityState,
} from "../../../shared/mobCombat.ts";
import {
  createDeterministicMobSpawnLayout,
  mobSpawnHashUint,
  type DeterministicMobSpawn,
} from "../../../shared/mobSpawnLayout.ts";
import {
  CREEPER_FUSE_TICKS,
  MOB_MOTION_TICKS_PER_SECOND,
  MOB_MOTION_UNITS_PER_BLOCK,
  createMobMotionState,
  isCreeperFuseDue,
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

/** Four habitats cover four widely separated active players without an unbounded global simulation. */
export const RAILWAY_MOB_MAX_HABITATS = 4;
export const RAILWAY_MOB_PASSIVE_PER_HABITAT = 4;
export const RAILWAY_MOB_HOSTILE_PER_HABITAT = 8;
export const RAILWAY_MOB_PASSIVE_CAP = RAILWAY_MOB_MAX_HABITATS * RAILWAY_MOB_PASSIVE_PER_HABITAT;
export const RAILWAY_MOB_HOSTILE_CAP = RAILWAY_MOB_MAX_HABITATS * RAILWAY_MOB_HOSTILE_PER_HABITAT;
export const RAILWAY_MOB_POPULATION_CAP = RAILWAY_MOB_PASSIVE_CAP + RAILWAY_MOB_HOSTILE_CAP;
export const RAILWAY_MOB_SPAWN_RADIUS = 32;
export const RAILWAY_MOB_CLEAR_RADIUS = 12;
export const RAILWAY_MOB_HABITAT_SIZE = 48;
export const RAILWAY_MOB_VISIBILITY_RADIUS = 64;
export const RAILWAY_MOB_PER_PLAYER_SNAPSHOT_CAP = 24;
const ECOLOGY_RETAIN_DISTANCE = 52;
const HABITAT_REFRESH_INTERVAL_MS = 10_000;
const DESPAWN_GRACE_TICKS = 30 * MOB_MOTION_TICKS_PER_SECOND;
const CHECKPOINT_INTERVAL_MS = 5_000;
const CONTACT_COOLDOWN_TICKS = MOB_MOTION_TICKS_PER_SECOND;
const SKELETON_SHOT_MIN_TICKS = 20;
const SKELETON_ARROW_BLOCKS_PER_TICK = 1.6;
const HOSTILE_LIGHT_THRESHOLD = 7;
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
  source?: "contact" | "projectile";
}

export interface RailwayMobProjectile {
  projectileId: string;
  mobId: string;
  targetId: string;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  spawnedTick: number;
  impactTick: number;
}

export interface RailwayMobExplosion {
  eventId: string;
  mobId: string;
  epoch: number;
  fuseStartedTick: number;
  explosionTick: number;
  currentTick: number;
  center: { x: number; y: number; z: number };
}

type Habitat = { key: string; x: number; z: number };

export class RailwayMobEcology {
  private state: MobMotionState | null = null;
  private centerX = 0;
  private centerZ = 0;
  private nightMode = false;
  private epoch = 0;
  private lastCheckpointAt = Number.NEGATIVE_INFINITY;
  private lastHabitatRefreshAt = Number.NEGATIVE_INFINITY;
  private habitatSignature = "";
  private readonly contactReadyTick = new Map<string, number>();
  private readonly undesiredSinceTick = new Map<string, number>();
  private readonly skeletonReadyTick = new Map<string, number>();
  private readonly projectiles = new Map<string, RailwayMobProjectile>();
  private readonly queuedExplosions: RailwayMobExplosion[] = [];
  private readonly pendingExplosionIds = new Set<string>();
  private readonly suppressedUntil = new Map<string, number>();
  private readonly darknessCache = new Map<string, boolean>();

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
    const habitats = activeHabitats(targets, this.centerX, this.centerZ);
    const signature = habitats.map((habitat) => habitat.key).join("|");
    if (!this.state) {
      this.rebuild(habitats, isNight, serverNow);
    } else {
      this.centerX = habitats[0]?.x ?? this.centerX;
      this.centerZ = habitats[0]?.z ?? this.centerZ;
      this.nightMode = isNight;
      const topologyChanged = signature !== this.habitatSignature;
      if (topologyChanged || serverNow - this.lastHabitatRefreshAt >= HABITAT_REFRESH_INTERVAL_MS) {
        this.refreshHabitats(habitats, isNight, topologyChanged, serverNow);
        this.habitatSignature = signature;
        this.lastHabitatRefreshAt = serverNow;
      }
    }
    if (!this.state) return [];

    const activeHostileMobIds = this.state.mobs
      .filter((mob) => !PASSIVE_KINDS.has(mob.kind))
      .filter((mob) => this.isDarkAt(
        Math.floor(mob.x / MOB_MOTION_UNITS_PER_BLOCK),
        Math.floor(mob.y / MOB_MOTION_UNITS_PER_BLOCK),
        Math.floor(mob.z / MOB_MOTION_UNITS_PER_BLOCK),
        isNight,
      ))
      .map((mob) => mob.mobId);
    stepMobMotion(this.state, { isNight, targets, activeHostileMobIds });
    this.clampMotionToHabitat();
    const hits = this.contactHits(targets, serverNow);
    hits.push(...this.advanceSkeletonProjectiles(targets, activeHostileMobIds, serverNow));
    this.queueDueCreeperExplosions();
    if (serverNow - this.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) this.persist(serverNow);
    return hits;
  }

  snapshot(
    serverNow: number,
    focus?: Readonly<{ x: number; z: number }>,
  ): RailwayMobSnapshot {
    if (!this.enabled || !this.state) return { serverNow, tick: 0, poses: [], states: [] };
    let poses = writeMobMotionPoses(this.state);
    if (focus) {
      poses = poses
        .filter((pose) => Math.hypot(pose.x - focus.x, pose.z - focus.z) <= RAILWAY_MOB_VISIBILITY_RADIUS)
        .sort((left, right) => (left.x - focus.x) ** 2 + (left.z - focus.z) ** 2
          - ((right.x - focus.x) ** 2 + (right.z - focus.z) ** 2)
          || left.mobId.localeCompare(right.mobId))
        .slice(0, RAILWAY_MOB_PER_PLAYER_SNAPSHOT_CAP)
        .sort((left, right) => left.mobId.localeCompare(right.mobId));
    }
    return { serverNow, tick: this.state.tick, poses, states: this.store.mobAuthorityStates(poses, serverNow) };
  }

  projectileSnapshot(): RailwayMobProjectile[] {
    return [...this.projectiles.values()].sort((left, right) => left.projectileId.localeCompare(right.projectileId));
  }

  /** Deterministic server-light probe used by spawn policy and authority tests. */
  hostileSpawnEligible(x: number, y: number, z: number, isNight: boolean): boolean {
    return this.canStand(x, y, z) && this.isDarkAt(x, y, z, isNight);
  }

  invalidateLighting(): void {
    this.darknessCache.clear();
  }

  drainExplosions(): RailwayMobExplosion[] {
    return this.queuedExplosions.splice(0, this.queuedExplosions.length);
  }

  acknowledgeExplosion(mobId: string, serverNow: number): void {
    if (!this.state) return;
    this.state.mobs = this.state.mobs.filter((mob) => mob.mobId !== mobId);
    for (const [id, projectile] of this.projectiles) if (projectile.mobId === mobId) this.projectiles.delete(id);
    for (const eventId of this.pendingExplosionIds) if (eventId.startsWith(`${mobId}:`)) this.pendingExplosionIds.delete(eventId);
    this.suppressedUntil.set(mobId, serverNow + 30_000);
    this.persist(serverNow);
  }

  pose(mobId: string): MobMotionPose | null {
    return this.state ? writeMobMotionPoses(this.state).find((pose) => pose.mobId === mobId) ?? null : null;
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

  private rebuild(habitats: readonly Habitat[], isNight: boolean, serverNow: number): void {
    const effective = habitats.length ? habitats : [{ key: habitatKey(this.centerX, this.centerZ), x: this.centerX, z: this.centerZ }];
    this.centerX = effective[0]!.x;
    this.centerZ = effective[0]!.z;
    this.nightMode = isNight;
    this.epoch += 1;
    const spawns = this.desiredSpawns(effective, isNight);
    this.state = createMobMotionState({
      seed: WORLD_TERRAIN_SEED,
      epoch: this.epoch,
      snapshot: spawns.map((spawn) => ({
        mobId: spawn.id,
        kind: spawn.kind,
        x: spawn.x + 0.5,
        y: spawn.y,
        z: spawn.z + 0.5,
        yaw: spawn.yaw,
      })),
    });
    this.contactReadyTick.clear();
    this.habitatSignature = effective.map((habitat) => habitat.key).join("|");
    this.lastHabitatRefreshAt = serverNow;
    this.persist(serverNow);
  }

  private desiredSpawns(habitats: readonly Habitat[], isNight: boolean): DeterministicMobSpawn[] {
    const result: DeterministicMobSpawn[] = [];
    const occupiedIds = new Set<string>();
    const occupiedCells = new Set<string>();
    for (const habitat of habitats.slice(0, RAILWAY_MOB_MAX_HABITATS)) {
      const habitatSeed = (WORLD_TERRAIN_SEED + mobSpawnHashUint(habitat.x, habitat.z, WORLD_TERRAIN_SEED)) >>> 0;
      const layout = createDeterministicMobSpawnLayout({
        seed: habitatSeed,
        radius: RAILWAY_MOB_SPAWN_RADIUS,
        centerX: habitat.x,
        centerZ: habitat.z,
        terrainHeight: (x, z) => this.terrain.height(x, z),
        resolveSpawnPosition: (kind, x, surfaceY, z, attempt) => {
          if (PASSIVE_KINDS.has(kind)) return [x, surfaceY, z] as const;
          if (isNight && attempt % 2 === 0 && this.isDarkAt(x, surfaceY, z, true)) {
            return [x, surfaceY, z] as const;
          }
          return this.findDarkCaveFloor(x, surfaceY, z, attempt, isNight);
        },
        isSpawnable: (kind, x, y, z) => this.canStand(x, y, z)
          && (PASSIVE_KINDS.has(kind) || this.isDarkAt(x, y, z, isNight)),
        maxPopulation: RAILWAY_MOB_PASSIVE_PER_HABITAT + (isNight ? RAILWAY_MOB_HOSTILE_PER_HABITAT : 4),
        passivePopulation: RAILWAY_MOB_PASSIVE_PER_HABITAT,
        hostilePopulation: isNight ? RAILWAY_MOB_HOSTILE_PER_HABITAT : 4,
        spawnClearRadius: RAILWAY_MOB_CLEAR_RADIUS,
        hardMaxPopulation: RAILWAY_MOB_PASSIVE_PER_HABITAT + RAILWAY_MOB_HOSTILE_PER_HABITAT,
      });
      for (let localSlot = 0; localSlot < layout.length; localSlot += 1) {
        const spawn = layout[localSlot]!;
        const cell = `${spawn.x}:${spawn.y}:${spawn.z}`;
        if (occupiedCells.has(cell)) continue;
        const id = stableHabitatMobId(spawn.kind, habitat.key, localSlot, occupiedIds);
        if (!id) continue;
        occupiedIds.add(id);
        occupiedCells.add(cell);
        result.push({ ...spawn, id });
      }
    }
    return result.slice(0, RAILWAY_MOB_POPULATION_CAP);
  }

  private refreshHabitats(
    habitats: readonly Habitat[],
    isNight: boolean,
    topologyChanged: boolean,
    serverNow: number,
  ): void {
    if (!this.state || !habitats.length) return;
    const desired = new Map(this.desiredSpawns(habitats, isNight).map((spawn) => [spawn.id, spawn] as const));
    const retained = [] as typeof this.state.mobs;
    for (const mob of this.state.mobs) {
      const homeX = mob.homeX / MOB_MOTION_UNITS_PER_BLOCK;
      const homeZ = mob.homeZ / MOB_MOTION_UNITS_PER_BLOCK;
      const nearHabitat = habitats.some((habitat) => Math.hypot(homeX - habitat.x, homeZ - habitat.z) <= ECOLOGY_RETAIN_DISTANCE);
      if (desired.has(mob.mobId) || nearHabitat) {
        this.undesiredSinceTick.delete(mob.mobId);
        retained.push(mob);
        continue;
      }
      const since = this.undesiredSinceTick.get(mob.mobId) ?? this.state.tick;
      this.undesiredSinceTick.set(mob.mobId, since);
      if (this.state.tick - since < DESPAWN_GRACE_TICKS) retained.push(mob);
    }
    this.state.mobs = retained;
    const existing = new Set(retained.map((mob) => mob.mobId));
    const additions = [...desired.values()].filter((spawn) => !existing.has(spawn.id));
    // A newly joined remote habitat arrives as one coherent ecology; ordinary
    // refreshes add at most one herd/hostile group and never teleport incumbents.
    const additionBudget = topologyChanged ? 12 : 4;
    for (const spawn of additions.slice(0, Math.max(0, Math.min(additionBudget, RAILWAY_MOB_POPULATION_CAP - retained.length)))) {
      if ((this.suppressedUntil.get(spawn.id) ?? 0) > serverNow) continue;
      const created = createMobMotionState({
        seed: WORLD_TERRAIN_SEED,
        epoch: this.state.epoch,
        snapshot: [{ mobId: spawn.id, kind: spawn.kind, x: spawn.x + 0.5, y: spawn.y, z: spawn.z + 0.5, yaw: spawn.yaw }],
      })?.mobs[0];
      if (created) this.state.mobs.push(created);
    }
    this.state.mobs.sort((left, right) => left.mobId.localeCompare(right.mobId));
  }

  private findDarkCaveFloor(
    originX: number,
    surfaceY: number,
    originZ: number,
    attempt: number,
    isNight: boolean,
  ): readonly [number, number, number] | null {
    for (let offset = 0; offset < 25; offset += 1) {
      const index = (offset + attempt) % 25;
      const x = originX + index % 5 - 2;
      const z = originZ + Math.floor(index / 5) - 2;
      for (let y = surfaceY - 3; y >= -62; y -= 1) {
        if (this.canStand(x, y, z) && this.isDarkAt(x, y, z, isNight)) return [x, y, z];
      }
    }
    return null;
  }

  private isDarkAt(x: number, y: number, z: number, isNight: boolean): boolean {
    const key = `${x}:${y}:${z}:${isNight ? 1 : 0}`;
    const cached = this.darknessCache.get(key);
    if (cached !== undefined) {
      this.darknessCache.delete(key);
      this.darknessCache.set(key, cached);
      return cached;
    }
    const skyLight = this.hasOpenSky(x, y, z) ? (isNight ? 4 : 15) : 0;
    const dark = Math.max(skyLight, this.blockLightAt(x, y, z)) <= HOSTILE_LIGHT_THRESHOLD;
    this.darknessCache.set(key, dark);
    while (this.darknessCache.size > 4_096) {
      const oldest = this.darknessCache.keys().next().value;
      if (oldest === undefined) break;
      this.darknessCache.delete(oldest);
    }
    return dark;
  }

  private hasOpenSky(x: number, y: number, z: number): boolean {
    const top = Math.max(y + 2, this.terrain.height(x, z) + 2);
    for (let probeY = y + 2; probeY <= top; probeY += 1) {
      if (!passableBlock(this.terrain.blockAt(x, probeY, z))) return false;
    }
    return true;
  }

  private blockLightAt(x: number, y: number, z: number): number {
    let brightest = 0;
    // Light level 15 can only remain above the hostile threshold within seven
    // Manhattan cells, so this bounded probe is exact for spawn eligibility.
    for (let dx = -7; dx <= 7; dx += 1) for (let dy = -7; dy <= 7; dy += 1) {
      for (let dz = -7; dz <= 7; dz += 1) {
        const distance = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (distance > 7) continue;
        const emission = emittedLight(this.terrain.blockAt(x + dx, y + dy, z + dz));
        if (!emission || emission - distance <= brightest) continue;
        if (this.hasLineOfSight(x + 0.5, y + 1, z + 0.5, x + dx + 0.5, y + dy + 0.5, z + dz + 0.5)) {
          brightest = emission - distance;
        }
      }
    }
    return brightest;
  }

  private hasLineOfSight(fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dz = toZ - fromZ;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) * 2));
    for (let step = 1; step < steps; step += 1) {
      const ratio = step / steps;
      if (!passableBlock(this.terrain.blockAt(
        Math.floor(fromX + dx * ratio),
        Math.floor(fromY + dy * ratio),
        Math.floor(fromZ + dz * ratio),
      ))) return false;
    }
    return true;
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
      if (PASSIVE_KINDS.has(mob.kind) || mob.kind === "creeper" || mob.kind === "skeleton"
        || !mob.targetUserId || (states.get(mob.mobId)?.health ?? 0) <= 0) continue;
      const target = targetById.get(mob.targetUserId);
      if (!target) continue;
      const x = mob.x / MOB_MOTION_UNITS_PER_BLOCK;
      const y = mob.y / MOB_MOTION_UNITS_PER_BLOCK;
      const z = mob.z / MOB_MOTION_UNITS_PER_BLOCK;
      const reach = mob.kind === "spider" ? 1.35 : 1.15;
      if (Math.hypot(target.x - x, target.z - z) > reach || Math.abs(target.y - y) > 2.2) continue;
      const key = `${mob.mobId}\u0000${target.userId}`;
      if ((this.contactReadyTick.get(key) ?? 0) > this.state.tick) continue;
      this.contactReadyTick.set(key, this.state.tick + CONTACT_COOLDOWN_TICKS);
      hits.push({
        operationId: `mob:${mob.mobId}:${this.state.tick.toString(36)}:${target.userId}`.slice(0, 96),
        mobId: mob.mobId,
        targetId: target.userId,
        damage: mob.kind === "zombie" ? 3 : 2,
        attackerX: x,
        attackerZ: z,
        source: "contact",
      });
    }
    return hits;
  }

  private advanceSkeletonProjectiles(
    targets: readonly MobMotionTargetSnapshot[],
    activeHostileMobIds: readonly string[],
    serverNow: number,
  ): RailwayMobContactHit[] {
    if (!this.state) return [];
    const active = new Set(activeHostileMobIds);
    const targetById = new Map(targets.filter((target) => target.active !== false).map((target) => [target.userId, target]));
    const states = new Map(this.store.mobAuthorityStates(this.state.mobs, serverNow).map((state) => [state.mobId, state]));
    for (const mob of this.state.mobs) {
      if (mob.kind !== "skeleton" || !active.has(mob.mobId) || !mob.targetUserId
        || (states.get(mob.mobId)?.health ?? 0) <= 0 || (this.skeletonReadyTick.get(mob.mobId) ?? 0) > this.state.tick) continue;
      const target = targetById.get(mob.targetUserId);
      if (!target) continue;
      const x = mob.x / MOB_MOTION_UNITS_PER_BLOCK;
      const y = mob.y / MOB_MOTION_UNITS_PER_BLOCK + 1.45;
      const z = mob.z / MOB_MOTION_UNITS_PER_BLOCK;
      const distance = Math.hypot(target.x - x, target.y + 0.9 - y, target.z - z);
      if (distance < 3 || distance > 14 || !this.hasLineOfSight(x, y, z, target.x, target.y + 0.9, target.z)) continue;
      const projectileId = `${mob.mobId}:arrow:${this.state.tick.toString(36)}`;
      this.projectiles.set(projectileId, {
        projectileId,
        mobId: mob.mobId,
        targetId: target.userId,
        x, y, z,
        targetX: target.x,
        targetY: target.y + 0.9,
        targetZ: target.z,
        spawnedTick: this.state.tick,
        impactTick: this.state.tick + Math.max(2, Math.ceil(distance / SKELETON_ARROW_BLOCKS_PER_TICK)),
      });
      this.skeletonReadyTick.set(mob.mobId,
        this.state.tick + SKELETON_SHOT_MIN_TICKS + mobSpawnHashUint(this.state.tick, mob.randomState, WORLD_TERRAIN_SEED) % 11);
    }
    const hits: RailwayMobContactHit[] = [];
    for (const [projectileId, projectile] of this.projectiles) {
      if (projectile.impactTick > this.state.tick) continue;
      this.projectiles.delete(projectileId);
      const target = targetById.get(projectile.targetId);
      if (!target || Math.hypot(
        target.x - projectile.targetX,
        target.y + 0.9 - projectile.targetY,
        target.z - projectile.targetZ,
      ) > 1.25 || !this.hasLineOfSight(projectile.x, projectile.y, projectile.z, target.x, target.y + 0.9, target.z)) continue;
      hits.push({
        operationId: `projectile:${projectileId}:${projectile.targetId}`.slice(0, 96),
        mobId: projectile.mobId,
        targetId: projectile.targetId,
        damage: 2,
        attackerX: projectile.x,
        attackerZ: projectile.z,
        source: "projectile",
      });
    }
    return hits;
  }

  private queueDueCreeperExplosions(): void {
    if (!this.state) return;
    for (const mob of this.state.mobs) {
      if (!isCreeperFuseDue(mob, this.state.tick)) continue;
      const eventId = `${mob.mobId}:${this.state.epoch.toString(36)}:${mob.fuseStartedTick.toString(36)}`;
      if (this.pendingExplosionIds.has(eventId)) continue;
      this.pendingExplosionIds.add(eventId);
      this.queuedExplosions.push({
        eventId,
        mobId: mob.mobId,
        epoch: this.state.epoch,
        fuseStartedTick: mob.fuseStartedTick,
        explosionTick: mob.fuseStartedTick + CREEPER_FUSE_TICKS,
        currentTick: this.state.tick,
        center: {
          x: mob.x / MOB_MOTION_UNITS_PER_BLOCK,
          y: mob.y / MOB_MOTION_UNITS_PER_BLOCK,
          z: mob.z / MOB_MOTION_UNITS_PER_BLOCK,
        },
      });
    }
  }
}

function activeHabitats(
  targets: readonly MobMotionTargetSnapshot[],
  fallbackX: number,
  fallbackZ: number,
): Habitat[] {
  const byKey = new Map<string, Habitat>();
  for (const target of targets.filter((candidate) => candidate.active !== false).slice()
    .sort((left, right) => left.userId.localeCompare(right.userId))) {
    const key = habitatKey(target.x, target.z);
    if (!byKey.has(key)) byKey.set(key, habitatFromKey(key));
    if (byKey.size >= RAILWAY_MOB_MAX_HABITATS) break;
  }
  if (!byKey.size) {
    const key = habitatKey(fallbackX, fallbackZ);
    byKey.set(key, habitatFromKey(key));
  }
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function habitatKey(x: number, z: number): string {
  const half = RAILWAY_MOB_HABITAT_SIZE / 2;
  return `${Math.floor((x + half) / RAILWAY_MOB_HABITAT_SIZE)},${Math.floor((z + half) / RAILWAY_MOB_HABITAT_SIZE)}`;
}

function habitatFromKey(key: string): Habitat {
  const [cellX, cellZ] = key.split(",").map(Number);
  return {
    key,
    x: cellX * RAILWAY_MOB_HABITAT_SIZE,
    z: cellZ * RAILWAY_MOB_HABITAT_SIZE,
  };
}

function stableHabitatMobId(
  kind: MobAuthorityKind,
  habitat: string,
  localSlot: number,
  occupied: ReadonlySet<string>,
): string | null {
  const base = mobSpawnHashUint(localSlot, hashText(habitat), WORLD_TERRAIN_SEED) % 64;
  for (let probe = 0; probe < 64; probe += 1) {
    const id = `${kind}-${WORLD_TERRAIN_SEED.toString(36)}-${((base + probe) % 64).toString(36)}`;
    if (!occupied.has(id)) return id;
  }
  return null;
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function emittedLight(blockId: number): number {
  const name = BLOCK_TYPES[blockId] ?? "";
  if (name === "torch" || name.startsWith("wall_torch_") || name === "glowstone"
    || name === "sea_lantern" || name === "shroomlight" || name.endsWith("froglight")) return 15;
  if (name === "magma_block") return 3;
  return 0;
}

function passableBlock(blockId: number): boolean {
  const name = BLOCK_TYPES[blockId] ?? "";
  return name === "air" || name === "torch" || name === "ladder" || name === "sapling"
    || name === "door_open" || name.endsWith("_fence_gate_open") || name.startsWith("wall_torch_");
}
