import type { MobAuthorityState } from "../../shared/mobCombat.ts";
import {
  CREEPER_FUSE_CANCEL_RANGE_BLOCKS,
  CREEPER_FUSE_START_RANGE_BLOCKS,
  CREEPER_FUSE_TICKS,
  CREEPER_FUSE_VERTICAL_RANGE_BLOCKS,
  MOB_MOTION_TICKS_PER_SECOND,
  mobFacingYaw,
} from "../../shared/mobMotionAuthority.ts";
import * as BS from "../../shared/bundleStrings.ts";
import {
  PASSIVE_MOB_HERD_SIZE,
  createDeterministicMobSpawnLayout,
  mobSpawnHash01 as hash01,
  mobSpawnHashUint as hashUint,
} from "../../shared/mobSpawnLayout.ts";
export { PASSIVE_MOB_HERD_SIZE } from "../../shared/mobSpawnLayout.ts";

export type MobKind = "pig" | "cow" | "sheep" | "chicken" | "zombie" | "skeleton" | "creeper" | "spider";
export type MobBehavior = "dormant" | "idle" | "wander" | "chase" | "fuse";
export type MobDropId = "pork" | "beef" | "leather" | "wool" | "mutton" | "raw_chicken" | "feather" | "rotten_flesh" | "stick" | "string" | "arrow" | "bone" | "gunpowder";

/** Lakebed combat state is authoritative when supplied; local combat remains a development fallback. */
export const MOB_COMBAT_AUTHORITY = "lakebed-optional" as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export interface MobDropDefinition {
  itemId: MobDropId;
  minCount: number;
  maxCount: number;
  chance: number;
}

export interface MobDefinition {
  kind: MobKind;
  passive: boolean;
  maxHealth: number;
  moveSpeed: number;
  chaseSpeed: number;
  collisionRadius: number;
  /** Generous crosshair hit radius; quadruped models are longer than their collision footprint. */
  targetRadius: number;
  height: number;
  contactDamage: number;
  attackCooldownSeconds: number;
  rangedDamage: number;
  rangedCooldownSeconds: number;
  rangedRange: number;
  projectileSpeed: number;
  drops: readonly MobDropDefinition[];
}

function drop(itemId: MobDropId, minCount: number, maxCount: number, chance = 1): MobDropDefinition {
  return { itemId, minCount, maxCount, chance };
}

function defineMob(
  kind: MobKind,
  passive: boolean,
  maxHealth: number,
  moveSpeed: number,
  chaseSpeed: number,
  collisionRadius: number,
  targetRadius: number,
  height: number,
  contactDamage: number,
  attackCooldownSeconds: number,
  rangedDamage: number,
  rangedCooldownSeconds: number,
  rangedRange: number,
  projectileSpeed: number,
  drops: MobDropDefinition[],
): MobDefinition {
  return Object.freeze({
    kind, passive, maxHealth, moveSpeed, chaseSpeed, collisionRadius, targetRadius, height,
    contactDamage, attackCooldownSeconds, rangedDamage, rangedCooldownSeconds, rangedRange,
    projectileSpeed, drops: Object.freeze(drops),
  });
}

export const MOB_DEFINITIONS: Readonly<Record<MobKind, MobDefinition>> = Object.freeze({
  pig: defineMob("pig", true, 10, 1.15, 1.15, 0.45, 1.05, 1, 0, 0, 0, 0, 0, 0,
    [drop("pork", 1, 3)]),
  cow: defineMob("cow", true, 10, 1, 1, 0.48, 1.22, 1.35, 0, 0, 0, 0, 0, 0,
    [drop("beef", 1, 3), drop("leather", 0, 2, 0.75)]),
  sheep: defineMob("sheep", true, 8, 1.05, 1.05, 0.44, 1.16, 1.25, 0, 0, 0, 0, 0, 0,
    [drop("wool", 1, 1), drop("mutton", 1, 2)]),
  chicken: defineMob("chicken", true, 4, 1.1, 1.1, 0.3, 0.78, 1.1, 0, 0, 0, 0, 0, 0,
    [drop("raw_chicken", 1, 1), drop("feather", 0, 2)]),
  zombie: defineMob("zombie", false, 20, 0.9, 1.45, 0.38, 0.4, 1.8, 3, 1, 0, 0, 0, 0,
    [drop("rotten_flesh", 0, 2, 0.85)]),
  skeleton: defineMob("skeleton", false, 20, 0.82, 1.15, 0.34, 0.38, 1.9, 0, 0, 3, 2.1, 16, 8.5,
    [drop("arrow", 0, 2), drop("bone", 0, 2)]),
  creeper: defineMob("creeper", false, 20, 0.84, 1.1, 0.36, 0.4, 1.7, 0, 0, 0, 0, 0, 0,
    [drop(BS.gunpowder, 0, 2)]),
  spider: defineMob("spider", false, 16, 1.02, 1.55, 0.68, 0.72, 0.8, 2, 1, 0, 0, 0, 0,
    [drop("string", 0, 2)]),
});

export const DEFAULT_MAX_MOB_POPULATION = 24;
export const HARD_MAX_MOB_POPULATION = 64;
export const MAX_MOB_PROJECTILES = 24;
export const MOB_PROJECTILE_LIFETIME_SECONDS = 3;
export const MOB_PROJECTILE_GRAVITY = 2.4;
export const LOCAL_MOB_LINE_OF_SIGHT_MAX_SAMPLES = 64;
export const MOB_PLAYER_CONTACT_RADIUS = 0.32;
export const MOB_PLAYER_MELEE_REACH_MARGIN = 0.22;

export function meleeMobPlayerStandoff(kind: MobKind): number {
  const definition = MOB_DEFINITIONS[kind];
  return definition.contactDamage > 0 ? definition.collisionRadius + MOB_PLAYER_CONTACT_RADIUS : 0;
}

/** Melee reach extends slightly past the physical no-overlap boundary. */
export function meleeMobPlayerAttackReach(kind: MobKind): number {
  const standoff = meleeMobPlayerStandoff(kind);
  return standoff > 0 ? standoff + MOB_PLAYER_MELEE_REACH_MARGIN : 0;
}

/** Stable zero-distance escape vector; it never consumes the mob's replay RNG. */
export function stableMobSeparationDirection(behaviorSeed: number): readonly [number, number] {
  switch ((Number.isSafeInteger(behaviorSeed) ? behaviorSeed : 0) & 3) {
    case 0: return [1, 0];
    case 1: return [0, 1];
    case 2: return [-1, 0];
    default: return [0, -1];
  }
}
export const LOCAL_MOB_HOSTILE_SPAWN_LIGHT_MAX = 0.24;
export const LOCAL_MOB_SPIDER_NEUTRAL_LIGHT_MIN = 0.52;
export const LOCAL_MOB_SPIDER_ENGAGEMENT_SECONDS = 1.5;
export const LOCAL_MOB_SUNLIGHT_DAMAGE_INTERVAL_SECONDS = 1;
export const LOCAL_MOB_SUNLIGHT_DAMAGE = 2;
export const LOCAL_MOB_SUNLIGHT_INTENSITY_MIN = 0.5;
export const LOCAL_MOB_DEATH_ANIMATION_SECONDS = 0.7;

/** Light affects spider temperament; other hostiles remain dangerous after spawning. */
export function localMobHostileActive(kind: MobKind, localLight: number, spiderEngaged = false): boolean {
  if (MOB_DEFINITIONS[kind].passive) return false;
  return kind !== "spider" || spiderEngaged || localLight < LOCAL_MOB_SPIDER_NEUTRAL_LIGHT_MIN;
}

/** Bounded allocation-free eye ray used only by the local hostile simulation. */
export function localMobHasLineOfSight(
  mob: Readonly<Pick<MobState, "kind" | "x" | "y" | "z">>,
  player: Readonly<MobTarget>,
  isBlocked?: (x: number, y: number, z: number) => boolean,
): boolean {
  if (!isBlocked) return true;
  const dx = player.x - mob.x;
  const dy = player.y + 0.9 - (mob.y + MOB_DEFINITIONS[mob.kind].height * 0.75);
  const dz = player.z - mob.z;
  const distance = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(distance)) return false;
  const samples = clamp(Math.ceil(distance * 4), 1, LOCAL_MOB_LINE_OF_SIGHT_MAX_SAMPLES);
  for (let sample = 1; sample < samples; sample += 1) {
    const ratio = sample / samples;
    if (isBlocked(mob.x + dx * ratio, mob.y + MOB_DEFINITIONS[mob.kind].height * 0.75 + dy * ratio, mob.z + dz * ratio)) {
      return false;
    }
  }
  return true;
}

export interface MobSpawnDescriptor {
  id: string;
  kind: MobKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  homeX: number;
  homeZ: number;
  behaviorSeed: number;
}

export interface MobSpawnOptions {
  seed: number;
  radius: number;
  centerX?: number;
  centerZ?: number;
  terrainHeight: (x: number, z: number) => number;
  /** Optional deterministic surface/cave floor selection for one candidate. */
  resolveSpawnY?: (kind: MobKind, x: number, surfaceY: number, z: number, attempt: number) => number;
  /** Optional deterministic relocation to a nearby valid surface/cave floor. */
  resolveSpawnPosition?: (
    kind: MobKind,
    x: number,
    surfaceY: number,
    z: number,
    attempt: number,
  ) => readonly [x: number, y: number, z: number];
  /** Final collision/ground veto supplied by the world implementation. */
  isSpawnable?: (kind: MobKind, x: number, y: number, z: number) => boolean;
  /** Cached normalized local light sampled only while generating spawn candidates. */
  localLight?: (kind: MobKind, x: number, y: number, z: number) => number;
  maxPopulation?: number;
  passivePopulation?: number;
  hostilePopulation?: number;
  spawnClearRadius?: number;
}

export interface MobState extends MobSpawnDescriptor {
  homeY: number;
  previousX: number;
  previousY: number;
  previousZ: number;
  previousYaw: number;
  health: number;
  alive: boolean;
  behavior: MobBehavior;
  behaviorUntilSeconds: number;
  directionX: number;
  directionZ: number;
  desiredX: number;
  desiredZ: number;
  hostileActive: boolean;
  randomState: number;
  damageSequence: number;
  nextContactDamageAtSeconds: number;
  nextRangedAttackAtSeconds: number;
  rangedSequence: number;
  authoritativeRevision: number;
  authoritativeDeadUntil: number;
  /** Sheep keep their clipped appearance until their next death/respawn cycle. */
  sheared: boolean;
  fuseStartedAtSeconds: number;
  fuseUntilSeconds: number;
  spiderUntil: number;
  sunDamageAt: number;
  deathUntil: number;
}

export interface MobSimulation {
  elapsedSeconds: number;
  tick: number;
  mobs: MobState[];
  projectiles: MobProjectile[];
  pendingProjectileDamage: number;
}

export interface LocalCreeperExplosionEvent {
  mobId: string;
  x: number;
  y: number;
  z: number;
}

export const MOB_SIMULATION_SNAPSHOT_VERSION = 2 as const;
export const LOCAL_MOB_RESPAWN_DELAY_SECONDS = 30;
export const LOCAL_MOB_RESPAWN_PLAYER_DISTANCE = 16;

/**
 * Complete, bounded local simulation state. This deliberately includes inactive
 * projectile pool entries so a restored simulation resumes deterministically.
 */
export interface MobSimulationSnapshot {
  version: typeof MOB_SIMULATION_SNAPSHOT_VERSION;
  elapsedSeconds: number;
  tick: number;
  mobs: MobState[];
  projectiles: MobProjectile[];
  pendingProjectileDamage: number;
}

export interface MobProjectile {
  id: number;
  active: boolean;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  previousX: number;
  previousY: number;
  previousZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  yaw: number;
  pitch: number;
  remainingSeconds: number;
  damage: number;
}

const MOB_STATE_SNAPSHOT_KEYS = [
  "id", "kind", "x", "y", "z", "yaw", "homeX", "homeZ", "behaviorSeed",
  "homeY", BS.previousX, BS.previousY, BS.previousZ, "previousYaw", "health", "alive",
  "behavior", "behaviorUntilSeconds", "directionX", "directionZ", "desiredX", "desiredZ",
  "hostileActive", "randomState", "damageSequence", "nextContactDamageAtSeconds",
  "nextRangedAttackAtSeconds", "rangedSequence", "authoritativeRevision",
  "authoritativeDeadUntil", "sheared", "fuseStartedAtSeconds", "fuseUntilSeconds",
  "spiderUntil", "sunDamageAt", "deathUntil",
] as const;
const MOB_PROJECTILE_SNAPSHOT_KEYS = [
  "id", "active", "ownerId", "x", "y", "z", BS.previousX, BS.previousY, BS.previousZ,
  "velocityX", "velocityY", "velocityZ", "yaw", "pitch", "remainingSeconds", "damage",
] as const;
const MOB_POSITION_SNAPSHOT_KEYS = [
  "x", "y", "z", "homeX", "homeY", "homeZ", BS.previousX, BS.previousY, BS.previousZ,
  "desiredX", "desiredZ",
] as const;
const MOB_TIME_SNAPSHOT_KEYS = [
  "behaviorUntilSeconds", "nextContactDamageAtSeconds", "nextRangedAttackAtSeconds",
  "fuseStartedAtSeconds", "fuseUntilSeconds", "spiderUntil",
  "sunDamageAt", "deathUntil",
] as const;
const PROJECTILE_POSITION_SNAPSHOT_KEYS = [
  "x", "y", "z", BS.previousX, BS.previousY, BS.previousZ,
] as const;
const PROJECTILE_VELOCITY_SNAPSHOT_KEYS = ["velocityX", "velocityY", "velocityZ"] as const;

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function safeIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function validMobStateSnapshot(value: unknown): value is MobState {
  const mob = snapshotRecord(value);
  if (!mob || !hasExactKeys(mob, MOB_STATE_SNAPSHOT_KEYS)) return false;
  if (typeof mob.id !== "string" || mob.id.length < 1 || mob.id.length > 128) return false;
  if (typeof mob.kind !== "string" || !(mob.kind in MOB_DEFINITIONS)) return false;
  const kind = mob.kind as MobKind;
  if (!MOB_POSITION_SNAPSHOT_KEYS.every((field) => finiteInRange(mob[field], -1_000_000, 1_000_000))) return false;
  if (!finiteInRange(mob.yaw, -Math.PI * 4, Math.PI * 4)
    || !finiteInRange(mob.previousYaw, -Math.PI * 4, Math.PI * 4)) return false;
  if (!safeIntegerInRange(mob.behaviorSeed, 0, 0xffff_ffff)
    || !safeIntegerInRange(mob.randomState, 1, 0xffff_ffff)
    || !safeIntegerInRange(mob.damageSequence, 0, Number.MAX_SAFE_INTEGER)
    || !safeIntegerInRange(mob.rangedSequence, 0, Number.MAX_SAFE_INTEGER)
    || !safeIntegerInRange(mob.authoritativeRevision, -1, Number.MAX_SAFE_INTEGER)) return false;
  if (typeof mob.behavior !== "string" || !(["dormant", "idle", "wander", "chase", "fuse"] as const).includes(mob.behavior as MobBehavior)) return false;
  if (typeof mob.alive !== "boolean" || typeof mob.hostileActive !== "boolean" || typeof mob.sheared !== "boolean") return false;
  if (!finiteInRange(mob.health, 0, MOB_DEFINITIONS[kind].maxHealth)) return false;
  if ((mob.alive as boolean) !== ((mob.health as number) > 0)) return false;
  if ((mob.sheared as boolean) && kind !== "sheep") return false;
  if (!finiteInRange(mob.directionX, -1, 1) || !finiteInRange(mob.directionZ, -1, 1)) return false;
  if (!MOB_TIME_SNAPSHOT_KEYS.every((field) => finiteInRange(mob[field], 0, 1_000_000_000_000))) return false;
  if (!finiteInRange(mob.authoritativeDeadUntil, 0, 10_000_000_000_000_000)) return false;
  if (kind !== "creeper" && ((mob.fuseStartedAtSeconds as number) !== 0 || (mob.fuseUntilSeconds as number) !== 0)) return false;
  if ((mob.fuseStartedAtSeconds as number) > (mob.fuseUntilSeconds as number)) return false;
  if (kind !== "spider" && (mob.spiderUntil as number) !== 0) return false;
  if (kind !== "zombie" && kind !== "skeleton"
    && (mob.sunDamageAt as number) !== 0) return false;
  if (mob.alive && (mob.deathUntil as number) !== 0) return false;
  return true;
}

function validMobProjectileSnapshot(value: unknown, expectedId: number): value is MobProjectile {
  const projectile = snapshotRecord(value);
  if (!projectile || !hasExactKeys(projectile, MOB_PROJECTILE_SNAPSHOT_KEYS)) return false;
  if (projectile.id !== expectedId || typeof projectile.active !== "boolean") return false;
  if (typeof projectile.ownerId !== "string" || projectile.ownerId.length > 128) return false;
  if (!PROJECTILE_POSITION_SNAPSHOT_KEYS.every((field) => finiteInRange(projectile[field], -1_000_000, 1_000_000))) return false;
  if (!PROJECTILE_VELOCITY_SNAPSHOT_KEYS.every((field) => finiteInRange(projectile[field], -1_000, 1_000))) return false;
  if (!finiteInRange(projectile.yaw, -Math.PI * 4, Math.PI * 4)
    || !finiteInRange(projectile.pitch, -Math.PI * 2, Math.PI * 2)
    || !finiteInRange(projectile.remainingSeconds, -MOB_PROJECTILE_LIFETIME_SECONDS, MOB_PROJECTILE_LIFETIME_SECONDS)
    || !finiteInRange(projectile.damage, 0, 100)) return false;
  return true;
}

function cloneMobState(mob: Readonly<MobState>): MobState {
  return { ...mob };
}

function cloneMobProjectile(projectile: Readonly<MobProjectile>): MobProjectile {
  return { ...projectile };
}

/** Returns a detached, JSON-safe snapshot of all deterministic local mob state. */
export function exportMobSimulationSnapshot(simulation: Readonly<MobSimulation>): MobSimulationSnapshot {
  return {
    version: MOB_SIMULATION_SNAPSHOT_VERSION,
    elapsedSeconds: simulation.elapsedSeconds,
    tick: simulation.tick,
    mobs: simulation.mobs.slice(0, HARD_MAX_MOB_POPULATION).map(cloneMobState),
    projectiles: simulation.projectiles.slice(0, MAX_MOB_PROJECTILES).map(cloneMobProjectile),
    pendingProjectileDamage: simulation.pendingProjectileDamage,
  };
}

/** Strictly validates untrusted persisted data and returns a detached copy. */
export function validateMobSimulationSnapshot(value: unknown): MobSimulationSnapshot | null {
  const snapshot = snapshotRecord(value);
  if (!snapshot || !hasExactKeys(snapshot, [
    "version", "elapsedSeconds", "tick", "mobs", "projectiles", "pendingProjectileDamage",
  ])) return null;
  if (snapshot.version !== MOB_SIMULATION_SNAPSHOT_VERSION
    || !finiteInRange(snapshot.elapsedSeconds, 0, 1_000_000_000_000)
    || !safeIntegerInRange(snapshot.tick, 0, Number.MAX_SAFE_INTEGER)
    || !finiteInRange(snapshot.pendingProjectileDamage, 0, 12)
    || !Array.isArray(snapshot.mobs)
    || snapshot.mobs.length > HARD_MAX_MOB_POPULATION
    || !Array.isArray(snapshot.projectiles)
    || snapshot.projectiles.length !== MAX_MOB_PROJECTILES) return null;
  const ids = new Set<string>();
  for (const mob of snapshot.mobs) {
    if (!validMobStateSnapshot(mob) || ids.has(mob.id)) return null;
    ids.add(mob.id);
  }
  for (let index = 0; index < snapshot.projectiles.length; index += 1) {
    const projectile = snapshot.projectiles[index];
    if (!validMobProjectileSnapshot(projectile, index)) return null;
    if (projectile.active && (!projectile.ownerId || !ids.has(projectile.ownerId))) return null;
  }
  return {
    version: MOB_SIMULATION_SNAPSHOT_VERSION,
    elapsedSeconds: snapshot.elapsedSeconds as number,
    tick: snapshot.tick as number,
    mobs: (snapshot.mobs as MobState[]).map(cloneMobState),
    projectiles: (snapshot.projectiles as MobProjectile[]).map(cloneMobProjectile),
    pendingProjectileDamage: snapshot.pendingProjectileDamage as number,
  };
}

/** Atomically replaces a simulation only after the entire snapshot validates. */
export function restoreMobSimulationSnapshot(simulation: MobSimulation, value: unknown): boolean {
  const snapshot = validateMobSimulationSnapshot(value);
  if (!snapshot) return false;
  simulation.elapsedSeconds = snapshot.elapsedSeconds;
  simulation.tick = snapshot.tick;
  simulation.mobs = snapshot.mobs;
  simulation.projectiles = snapshot.projectiles;
  simulation.pendingProjectileDamage = snapshot.pendingProjectileDamage;
  return true;
}

export interface MobProjectileSnapshot {
  id: number;
  x: number;
  y: number;
  z: number;
  previousX: number;
  previousY: number;
  previousZ: number;
  yaw: number;
  pitch: number;
}

export interface MobTarget {
  x: number;
  y: number;
  z: number;
}

export interface MobDamageSource {
  eventId: string;
  mobId: string;
  x: number;
  z: number;
  damage: number;
}

export interface MobStepInput {
  dtSeconds: number;
  isNight: boolean;
  terrainHeight: (x: number, z: number) => number;
  player?: Readonly<MobTarget> | null;
  /** Return false when a mob's body would overlap a solid block or entity. */
  canOccupy?: (kind: MobKind, x: number, y: number, z: number, radius: number, height: number) => boolean;
  /** Called for arrow world collision; movement and attacks remain client-only. */
  isProjectileBlocked?: (x: number, y: number, z: number) => boolean;
  /** Optional retained output for newly confirmed local projectile impacts. */
  projectileDamageSources?: MobDamageSource[];
  /** Cached normalized light lookup; called at the fixed mob simulation cadence. */
  localLight?: (kind: MobKind, x: number, y: number, z: number) => number;
  /** Cached direct-sky lookup; neighboring sky spill does not count. */
  directSky?: (kind: MobKind, x: number, y: number, z: number) => boolean;
  sunIntensity?: number;
  onFatalDrops?: (event: Readonly<LocalMobDeathDropEvent>) => boolean;
  worldRadius?: number;
  worldCenterX?: number;
  worldCenterZ?: number;
}

export interface MobPoseSnapshot {
  id: string;
  kind: MobKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  previousX: number;
  previousY: number;
  previousZ: number;
  previousYaw: number;
  behavior: MobBehavior;
  health: number;
  maxHealth: number;
  hostileActive: boolean;
  sheared: boolean;
  /** Stable 0..1 priming state; 1 means an authority explosion may be due. */
  fuseProgress: number;
  sunBurning: boolean;
  /** Stable 0..1 fall-over progress; live mobs are always zero. */
  deathFall: number;
}

export interface MobDrop {
  itemId: MobDropId;
  count: number;
}

/**
 * One deterministic local mob-death reward offered before the death commits.
 * The receiver must reserve every stack atomically; returning false preserves
 * the living mob and its damage sequence so a bounded drop pool cannot delete
 * earned items.
 */
export interface LocalMobDeathDropEvent {
  eventId: string;
  mobId: string;
  x: number;
  y: number;
  z: number;
  drops: readonly MobDrop[];
}

export interface MobDamageResult {
  found: boolean;
  applied: boolean;
  killed: boolean;
  remainingHealth: number;
  drops: MobDrop[];
}

/** Minimal client view of the bounded state returned by shared mob-combat queries. */
export type MobCombatStateSnapshot = Pick<
  MobAuthorityState,
  "mobId" | "kind" | "health" | "maxHealth" | "revision" | "deadUntil" | "sheared"
>;

export type LocalMobShearResult =
  | { ok: true; woolCount: number }
  | { ok: false; reason: "invalid_mob" | "already_sheared" | "rejected" };

export interface MobCombatApplyResult {
  applied: number;
  stale: number;
  invalid: number;
  unknown: number;
}

export interface MobRayTarget {
  id: string;
  kind: MobKind;
  distance: number;
  x: number;
  y: number;
  z: number;
}

export const MAX_CONTACT_DAMAGE_PER_TICK = 6;

function nextRandom(mob: MobState): number {
  let value = mob.randomState | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  mob.randomState = value >>> 0 || 0x6d2b79f5;
  return mob.randomState / 4294967296;
}

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

/** Creates a bounded, stable spawn list from only seed and terrain callbacks. */
export function createMobSpawns(options: Readonly<MobSpawnOptions>): MobSpawnDescriptor[] {
  const maxPopulation = clamp(
    finiteInteger(options.maxPopulation ?? DEFAULT_MAX_MOB_POPULATION, DEFAULT_MAX_MOB_POPULATION),
    0,
    HARD_MAX_MOB_POPULATION,
  );
  const passiveTarget = Math.max(0, finiteInteger(options.passivePopulation ?? 15, 15));
  const hostileTarget = Math.max(0, finiteInteger(options.hostilePopulation ?? 6, 6));
  const target = Math.min(maxPopulation, passiveTarget + hostileTarget);
  if (target === 0) return [];

  return createDeterministicMobSpawnLayout({
    seed: options.seed,
    radius: options.radius,
    centerX: options.centerX,
    centerZ: options.centerZ,
    terrainHeight: options.terrainHeight,
    maxPopulation,
    passivePopulation: passiveTarget,
    hostilePopulation: hostileTarget,
    spawnClearRadius: options.spawnClearRadius ?? 6,
    hardMaxPopulation: HARD_MAX_MOB_POPULATION,
    resolveSpawnPosition: (kind, x, surfaceY, z, attempt) => options.resolveSpawnPosition?.(kind, x, surfaceY, z, attempt)
      ?? [x, options.resolveSpawnY?.(kind, x, surfaceY, z, attempt) ?? surfaceY, z],
    isSpawnable: (kind, x, y, z) => (!options.isSpawnable || options.isSpawnable(kind, x, y, z))
      && (MOB_DEFINITIONS[kind].passive || !options.localLight
        || options.localLight(kind, x, y + MOB_DEFINITIONS[kind].height * 0.75, z)
          < LOCAL_MOB_HOSTILE_SPAWN_LIGHT_MAX),
  }).map((spawn) => ({ ...spawn, homeX: spawn.x, homeZ: spawn.z }));
}

/**
 * Keeps recycled local mobs out of the player's immediate horizontal view.
 * A dot-product test avoids square roots and remains deterministic for the
 * persisted player pose that selected the streamed chunk.
 */
export function isLocalMobSpawnOutsideView(
  playerX: number,
  playerZ: number,
  playerYaw: number,
  spawnX: number,
  spawnZ: number,
): boolean {
  const dx = spawnX - playerX;
  const dz = spawnZ - playerZ;
  const distanceSquared = dx * dx + dz * dz;
  if (!Number.isFinite(distanceSquared) || distanceSquared < 1) return false;
  const facingDot = dx * Math.sin(playerYaw) - dz * Math.cos(playerYaw);
  // 0.75 is wider than the ordinary camera half-FOV, leaving a small margin.
  return facingDot <= 0 || facingDot * facingDot < distanceSquared * 0.75 ** 2;
}

function mobStateForSpawn(spawn: Readonly<MobSpawnDescriptor>): MobState {
  return {
    ...spawn,
    homeY: spawn.y,
    previousX: spawn.x,
    previousY: spawn.y,
    previousZ: spawn.z,
    previousYaw: spawn.yaw,
    health: MOB_DEFINITIONS[spawn.kind].maxHealth,
    alive: true,
    behavior: MOB_DEFINITIONS[spawn.kind].passive ? "idle" : "dormant",
    behaviorUntilSeconds: 0,
    directionX: 0,
    directionZ: 0,
    desiredX: spawn.x,
    desiredZ: spawn.z,
    hostileActive: false,
    randomState: spawn.behaviorSeed || 0x6d2b79f5,
    damageSequence: 0,
    nextContactDamageAtSeconds: 0,
    nextRangedAttackAtSeconds: 0.65 + (spawn.behaviorSeed % 1_000) / 1_000,
    rangedSequence: 0,
    authoritativeRevision: -1,
    authoritativeDeadUntil: 0,
    sheared: false,
    fuseStartedAtSeconds: 0,
    fuseUntilSeconds: 0,
    spiderUntil: 0,
    sunDamageAt: 0,
    deathUntil: 0,
  };
}

export function createMobSimulation(spawns: readonly MobSpawnDescriptor[]): MobSimulation {
  const count = Math.min(HARD_MAX_MOB_POPULATION, spawns.length);
  const mobs = new Array<MobState>(count);
  for (let index = 0; index < count; index += 1) {
    mobs[index] = mobStateForSpawn(spawns[index]);
  }
  const projectiles = new Array<MobProjectile>(MAX_MOB_PROJECTILES);
  for (let index = 0; index < projectiles.length; index += 1) {
    projectiles[index] = {
      id: index,
      active: false,
      ownerId: "",
      x: 0,
      y: 0,
      z: 0,
      previousX: 0,
      previousY: 0,
      previousZ: 0,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      yaw: 0,
      pitch: 0,
      remainingSeconds: 0,
      damage: 0,
    };
  }
  return { elapsedSeconds: 0, tick: 0, mobs, projectiles, pendingProjectileDamage: 0 };
}

/** Retains in-range objects verbatim, evicts only out-of-range objects, then fills vacancies. */
export function reconcileLocalMobStreaming(
  simulation: MobSimulation,
  spawns: readonly MobSpawnDescriptor[],
  centerX: number,
  centerZ: number,
  retainRadius: number,
): number {
  const radius = Math.max(0, Number.isFinite(retainRadius) ? retainRadius : 0);
  const target = Math.min(HARD_MAX_MOB_POPULATION, Math.max(simulation.mobs.length, spawns.length));
  const retained: MobState[] = [];
  const retainedIds = new Set<string>();
  const retiredById = new Map<string, MobState>();
  for (const previous of simulation.mobs) {
    if (Math.max(Math.abs(previous.x - centerX), Math.abs(previous.z - centerZ)) <= radius) {
      if (Math.max(Math.abs(previous.homeX - centerX), Math.abs(previous.homeZ - centerZ)) > radius) {
        previous.homeX = previous.desiredX = previous.x;
        previous.homeY = previous.y;
        previous.homeZ = previous.desiredZ = previous.z;
      }
      retained.push(previous);
      retainedIds.add(previous.id);
    } else {
      retiredById.set(previous.id, previous);
      for (const projectile of simulation.projectiles) {
        if (projectile.active && projectile.ownerId === previous.id) projectile.active = false;
      }
    }
  }
  let added = 0;
  for (let index = 0; index < spawns.length && retained.length < target; index += 1) {
    const spawn = spawns[index];
    if (retainedIds.has(spawn.id)) continue;
    const replacement = mobStateForSpawn(spawn);
    replacement.damageSequence = retiredById.get(spawn.id)?.damageSequence ?? 0;
    retained.push(replacement);
    retainedIds.add(spawn.id);
    added += 1;
  }
  simulation.mobs = retained;
  return Math.max(retiredById.size, added);
}

/**
 * Rehomes a bounded number of inactive hostile slots when the streamed habitat
 * changes (for example, after loading an older surface-only save near caves).
 * Active, dying, fused, or otherwise protected mobs remain untouched.
 */
export function refreshLocalHostileHabitats(
  simulation: MobSimulation,
  spawns: readonly MobSpawnDescriptor[],
  canRetire: (mob: Readonly<MobState>, replacement: Readonly<MobSpawnDescriptor>) => boolean,
  maximumReplacements = 1,
): number {
  const limit = clamp(finiteInteger(maximumReplacements, 1), 0, 4);
  if (limit === 0) return 0;
  const byId = new Map<string, MobSpawnDescriptor>();
  for (const spawn of spawns) {
    if (!MOB_DEFINITIONS[spawn.kind].passive) byId.set(spawn.id, spawn);
  }
  let replaced = 0;
  for (let index = 0; index < simulation.mobs.length && replaced < limit; index += 1) {
    const previous = simulation.mobs[index];
    const replacement = byId.get(previous.id);
    if (!replacement || MOB_DEFINITIONS[previous.kind].passive
      || previous.kind !== replacement.kind
      || previous.homeX === replacement.x && previous.homeY === replacement.y && previous.homeZ === replacement.z
      || !canRetire(previous, replacement)) continue;
    for (const projectile of simulation.projectiles) {
      if (projectile.active && projectile.ownerId === previous.id) projectile.active = false;
    }
    const next = mobStateForSpawn(replacement);
    next.damageSequence = previous.damageSequence;
    simulation.mobs[index] = next;
    replaced += 1;
  }
  return replaced;
}

/** Returns a stable-order copy suitable for the bounded Lakebed authority query. */
export function listMobIds(simulation: Readonly<MobSimulation>): string[] {
  return simulation.mobs.slice(0, HARD_MAX_MOB_POPULATION).map((mob) => mob.id);
}

function choosePassiveBehavior(mob: MobState, elapsedSeconds: number): void {
  if (nextRandom(mob) < 0.42) {
    mob.behavior = "idle";
    mob.directionX = 0;
    mob.directionZ = 0;
    mob.behaviorUntilSeconds = elapsedSeconds + 0.8 + nextRandom(mob) * 2.6;
    return;
  }
  const angle = nextRandom(mob) * Math.PI * 2;
  mob.behavior = "wander";
  mob.directionX = Math.sin(angle);
  mob.directionZ = Math.cos(angle);
  mob.behaviorUntilSeconds = elapsedSeconds + 1.4 + nextRandom(mob) * 3.8;
}

function insideWorldBounds(
  x: number,
  z: number,
  radius: number,
  centerX: number,
  centerZ: number,
  limit: number,
): boolean {
  return Math.abs(x - centerX) + radius <= limit && Math.abs(z - centerZ) + radius <= limit;
}

function moveHeightAt(mob: MobState, x: number, z: number, input: Readonly<MobStepInput>): number | null {
  const definition = MOB_DEFINITIONS[mob.kind];
  const limit = Number.isFinite(input.worldRadius) ? Math.max(1, Math.abs(input.worldRadius as number)) : Infinity;
  const centerX = Number.isFinite(input.worldCenterX) ? input.worldCenterX as number : 0;
  const centerZ = Number.isFinite(input.worldCenterZ) ? input.worldCenterZ as number : 0;
  if (!insideWorldBounds(x, z, definition.collisionRadius, centerX, centerZ, limit)) return null;
  const y = input.terrainHeight(Math.floor(x), Math.floor(z)) + 1;
  if (Math.abs(y - mob.y) > 1.01) return null;
  if (input.canOccupy?.(mob.kind, x, y, z, definition.collisionRadius, definition.height) ?? true) return y;
  // While crossing a one-block ledge, the rear of the collision footprint can
  // still overlap the upper block. Continue horizontally at the current foot
  // height until the whole body clears the edge, then settle onto the lower
  // floor. Snapping down immediately makes the ledge look like a solid wall.
  if (y < mob.y
    && (input.canOccupy?.(mob.kind, x, mob.y, z, definition.collisionRadius, definition.height) ?? true)) {
    return mob.y;
  }
  return null;
}

function applyMovement(mob: MobState, x: number, y: number, z: number): void {
  mob.x = x;
  mob.z = z;
  mob.y = y;
}

function stopMob(mob: MobState, behavior: MobBehavior): void {
  mob.behavior = behavior;
  mob.directionX = mob.directionZ = 0;
  mob.desiredX = mob.x;
  mob.desiredZ = mob.z;
}

function tryMoveMob(mob: MobState, dx: number, dz: number, input: Readonly<MobStepInput>): boolean {
  const targetX = mob.x + dx;
  const targetZ = mob.z + dz;
  mob.desiredX = targetX;
  mob.desiredZ = targetZ;
  const diagonalY = moveHeightAt(mob, targetX, targetZ, input);
  if (diagonalY !== null) {
    applyMovement(mob, targetX, diagonalY, targetZ);
    return true;
  }
  const xY = dx !== 0 ? moveHeightAt(mob, targetX, mob.z, input) : null;
  if (xY !== null) {
    applyMovement(mob, targetX, xY, mob.z);
    return true;
  }
  const zY = dz !== 0 ? moveHeightAt(mob, mob.x, targetZ, input) : null;
  if (zY !== null) {
    applyMovement(mob, mob.x, zY, targetZ);
    return true;
  }
  return false;
}

function moveMob(mob: MobState, dx: number, dz: number, input: Readonly<MobStepInput>): void {
  if (tryMoveMob(mob, dx, dz, input)) return;
  mob.behavior = "idle";
  mob.directionX = 0;
  mob.directionZ = 0;
  mob.behaviorUntilSeconds = 0;
}

function spawnSkeletonProjectile(
  simulation: MobSimulation,
  mob: MobState,
  player: Readonly<MobTarget>,
  definition: MobDefinition,
): boolean {
  let projectile: MobProjectile | undefined;
  for (let index = 0; index < simulation.projectiles.length; index += 1) {
    if (!simulation.projectiles[index].active) {
      projectile = simulation.projectiles[index];
      break;
    }
  }
  if (!projectile) return false;
  const startX = mob.x;
  const startY = mob.y + 1.38;
  const startZ = mob.z;
  const targetX = player.x;
  const targetY = player.y + 0.92;
  const targetZ = player.z;
  const dx = targetX - startX;
  const dy = targetY - startY;
  const dz = targetZ - startZ;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 0.001) return false;
  const inverseDistance = 1 / distance;
  projectile.active = true;
  projectile.ownerId = mob.id;
  projectile.x = projectile.previousX = startX;
  projectile.y = projectile.previousY = startY;
  projectile.z = projectile.previousZ = startZ;
  projectile.velocityX = dx * inverseDistance * definition.projectileSpeed;
  // A small deterministic lift counteracts gravity over ordinary combat ranges.
  projectile.velocityY = dy * inverseDistance * definition.projectileSpeed + Math.min(1.15, distance * 0.055);
  projectile.velocityZ = dz * inverseDistance * definition.projectileSpeed;
  projectile.yaw = Math.atan2(projectile.velocityX, projectile.velocityZ);
  projectile.pitch = Math.atan2(projectile.velocityY, Math.hypot(projectile.velocityX, projectile.velocityZ));
  projectile.remainingSeconds = MOB_PROJECTILE_LIFETIME_SECONDS;
  projectile.damage = definition.rangedDamage;
  mob.rangedSequence += 1;
  return true;
}

/** Clips one ray/segment axis into a caller-retained near/far pair. */
function clipAxisInterval(
  interval: [number, number],
  origin: number,
  direction: number,
  minimum: number,
  maximum: number,
): boolean {
  if (Math.abs(direction) < 1e-9) return origin >= minimum && origin <= maximum;
  let first = (minimum - origin) / direction;
  let second = (maximum - origin) / direction;
  if (first > second) {
    const swap = first;
    first = second;
    second = swap;
  }
  interval[0] = Math.max(interval[0], first);
  interval[1] = Math.min(interval[1], second);
  return interval[0] <= interval[1];
}

const PLAYER_SEGMENT_INTERVAL: [number, number] = [0, 1];

function segmentIntersectsPlayer(
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  player: Readonly<MobTarget>,
): boolean {
  PLAYER_SEGMENT_INTERVAL[0] = 0;
  PLAYER_SEGMENT_INTERVAL[1] = 1;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dz = toZ - fromZ;
  return clipAxisInterval(PLAYER_SEGMENT_INTERVAL, fromX, dx, player.x - 0.34, player.x + 0.34)
    && clipAxisInterval(PLAYER_SEGMENT_INTERVAL, fromY, dy, player.y, player.y + 1.78)
    && clipAxisInterval(PLAYER_SEGMENT_INTERVAL, fromZ, dz, player.z - 0.34, player.z + 0.34);
}

function stepMobProjectiles(simulation: MobSimulation, input: Readonly<MobStepInput>, dt: number): void {
  for (let index = 0; index < simulation.projectiles.length; index += 1) {
    const projectile = simulation.projectiles[index];
    if (!projectile.active) continue;
    projectile.previousX = projectile.x;
    projectile.previousY = projectile.y;
    projectile.previousZ = projectile.z;
    projectile.remainingSeconds -= dt;
    projectile.velocityY -= MOB_PROJECTILE_GRAVITY * dt;
    const nextX = projectile.x + projectile.velocityX * dt;
    const nextY = projectile.y + projectile.velocityY * dt;
    const nextZ = projectile.z + projectile.velocityZ * dt;
    if (projectile.remainingSeconds <= 0
      || nextY < -32
      || input.isProjectileBlocked?.(nextX, nextY, nextZ)) {
      projectile.active = false;
      continue;
    }
    if (input.player && segmentIntersectsPlayer(
      projectile.x,
      projectile.y,
      projectile.z,
      nextX,
      nextY,
      nextZ,
      input.player,
    )) {
      const acceptedDamage = Math.min(projectile.damage, 12 - simulation.pendingProjectileDamage);
      simulation.pendingProjectileDamage += acceptedDamage;
      if (acceptedDamage > 0 && input.projectileDamageSources) {
        const owner = simulation.mobs.find((mob) => mob.id === projectile.ownerId);
        input.projectileDamageSources.push({
          eventId: `projectile:${projectile.ownerId}:${projectile.id}:${simulation.tick}`,
          mobId: projectile.ownerId,
          x: owner?.x ?? projectile.previousX,
          z: owner?.z ?? projectile.previousZ,
          damage: acceptedDamage,
        });
      }
      projectile.active = false;
      continue;
    }
    projectile.x = nextX;
    projectile.y = nextY;
    projectile.z = nextZ;
    projectile.yaw = Math.atan2(projectile.velocityX, projectile.velocityZ);
    projectile.pitch = Math.atan2(projectile.velocityY, Math.hypot(projectile.velocityX, projectile.velocityZ));
  }
}

function localLightAt(mob: Readonly<MobState>, input: Readonly<MobStepInput>, x = mob.x, y = mob.y, z = mob.z): number {
  const sampled = input.localLight?.(mob.kind, x, y + MOB_DEFINITIONS[mob.kind].height * 0.75, z);
  if (Number.isFinite(sampled)) return clamp(sampled as number, 0, 1);
  return input.isNight ? 0 : 1;
}

function beginMobDeathAnimation(mob: MobState, elapsedSeconds: number): void {
  mob.deathUntil = elapsedSeconds + LOCAL_MOB_DEATH_ANIMATION_SECONDS;
  mob.hostileActive = false;
  mob.sunDamageAt = 0;
  mob.spiderUntil = 0;
  mob.directionX = mob.directionZ = 0;
}

/** Advances simulation in place without allocating during ordinary movement ticks. */
export function stepMobSimulation(simulation: MobSimulation, input: Readonly<MobStepInput>): MobSimulation {
  const dt = clamp(Number.isFinite(input.dtSeconds) ? input.dtSeconds : 0, 0, 0.1);
  simulation.elapsedSeconds += dt;
  simulation.tick += 1;

  for (let index = 0; index < simulation.mobs.length; index += 1) {
    const mob = simulation.mobs[index];
    if (!mob.alive) {
      if (mob.authoritativeRevision < 0
        && mob.behaviorUntilSeconds > 0
        && simulation.elapsedSeconds + 1e-9 >= mob.behaviorUntilSeconds
        && localMobHomeAvailable(simulation, mob, input)) {
        resetMobAtHome(mob, simulation.elapsedSeconds);
      }
      continue;
    }
    const definition = MOB_DEFINITIONS[mob.kind];
    mob.previousX = mob.x;
    mob.previousY = mob.y;
    mob.previousZ = mob.z;
    mob.previousYaw = mob.yaw;
    const light = localLightAt(mob, input);
    let targetVisible = false;
    if (!definition.passive && input.player) {
      const playerDx = input.player.x - mob.x;
      const playerDz = input.player.z - mob.z;
      targetVisible = playerDx * playerDx + playerDz * playerDz <= 16 * 16
        && localMobHasLineOfSight(mob, input.player, input.isProjectileBlocked);
    }
    let spiderEngaged = mob.kind === "spider"
      && simulation.elapsedSeconds < mob.spiderUntil;
    if (mob.kind === "spider" && targetVisible
      && (spiderEngaged || light < LOCAL_MOB_SPIDER_NEUTRAL_LIGHT_MIN)) {
      mob.spiderUntil = simulation.elapsedSeconds + LOCAL_MOB_SPIDER_ENGAGEMENT_SECONDS;
      spiderEngaged = true;
    }
    mob.hostileActive = localMobHostileActive(mob.kind, light, spiderEngaged);

    const sunIntensity = Number.isFinite(input.sunIntensity)
      ? clamp(input.sunIntensity as number, 0, 1)
      : 0;
    const burnsInSunlight = mob.kind === "zombie" || mob.kind === "skeleton";
    const sunBurning = burnsInSunlight
      && sunIntensity >= LOCAL_MOB_SUNLIGHT_INTENSITY_MIN
      && (input.directSky?.(
        mob.kind,
        mob.x,
        mob.y + definition.height * 0.75,
        mob.z,
      ) ?? false);
    if (sunBurning) {
      if (mob.sunDamageAt <= 0) {
        mob.sunDamageAt = simulation.elapsedSeconds + LOCAL_MOB_SUNLIGHT_DAMAGE_INTERVAL_SECONDS;
      } else if (simulation.elapsedSeconds + 1e-9 >= mob.sunDamageAt) {
        const result = damageMob(simulation, mob.id, LOCAL_MOB_SUNLIGHT_DAMAGE, input.onFatalDrops);
        mob.sunDamageAt = simulation.elapsedSeconds + LOCAL_MOB_SUNLIGHT_DAMAGE_INTERVAL_SECONDS;
        if (result.killed) continue;
      }
    } else {
      mob.sunDamageAt = 0;
    }

    if (mob.kind === "creeper" && mob.fuseStartedAtSeconds > 0
      && mob.fuseUntilSeconds > mob.fuseStartedAtSeconds
      && simulation.elapsedSeconds >= mob.fuseUntilSeconds) {
      // Remain visibly ready until a later authoritative explosion integration
      // consumes the latched event; do not silently restart a second fuse.
      stopMob(mob, "fuse");
      continue;
    }

    if (!definition.passive && !mob.hostileActive) {
      mob.fuseStartedAtSeconds = mob.fuseUntilSeconds = 0;
      stopMob(mob, "dormant");
      continue;
    }

    let speed = definition.moveSpeed;
    let chasing = false;
    let chaseMovementLimit = Number.POSITIVE_INFINITY;
    let separationX = 0;
    let separationZ = 0;
    if (!definition.passive && input.player && targetVisible) {
      const playerDx = input.player.x - mob.x;
      const playerDz = input.player.z - mob.z;
      const distanceSquared = playerDx * playerDx + playerDz * playerDz;
      if (distanceSquared <= 16 * 16) {
        const distance = Math.sqrt(distanceSquared);
        const inverseDistance = distance > 0.0001 ? 1 / distance : 0;
        if (mob.kind === "creeper") {
          const verticalDistance = Math.abs(input.player.y - mob.y);
          const fuseActive = mob.fuseStartedAtSeconds > 0 && mob.fuseUntilSeconds > mob.fuseStartedAtSeconds;
          if (fuseActive && (distance > CREEPER_FUSE_CANCEL_RANGE_BLOCKS
            || verticalDistance > CREEPER_FUSE_VERTICAL_RANGE_BLOCKS)) {
            mob.fuseStartedAtSeconds = mob.fuseUntilSeconds = 0;
            if (mob.behavior === "fuse") mob.behavior = "chase";
          }
          if (mob.fuseStartedAtSeconds > 0) {
            stopMob(mob, "fuse");
            mob.behaviorUntilSeconds = mob.fuseUntilSeconds;
            chasing = true;
          } else if (distance <= CREEPER_FUSE_START_RANGE_BLOCKS
            && verticalDistance <= CREEPER_FUSE_VERTICAL_RANGE_BLOCKS) {
            mob.fuseStartedAtSeconds = simulation.elapsedSeconds;
            mob.fuseUntilSeconds = simulation.elapsedSeconds + CREEPER_FUSE_TICKS / MOB_MOTION_TICKS_PER_SECOND;
            stopMob(mob, "fuse");
            mob.behaviorUntilSeconds = mob.fuseUntilSeconds;
            chasing = true;
          } else {
            mob.directionX = playerDx * inverseDistance;
            mob.directionZ = playerDz * inverseDistance;
            speed = definition.chaseSpeed;
          }
        } else if (mob.kind === "skeleton") {
          if (distance > 10) {
            mob.directionX = playerDx * inverseDistance;
            mob.directionZ = playerDz * inverseDistance;
            speed = definition.chaseSpeed;
          } else if (distance < 5) {
            mob.directionX = -playerDx * inverseDistance;
            mob.directionZ = -playerDz * inverseDistance;
            speed = definition.chaseSpeed;
          } else {
            const side = (mob.behaviorSeed & 1) === 0 ? 1 : -1;
            mob.directionX = playerDz * inverseDistance * side;
            mob.directionZ = -playerDx * inverseDistance * side;
            speed = definition.moveSpeed * 0.58;
          }
          if (simulation.elapsedSeconds + 1e-9 >= mob.nextRangedAttackAtSeconds
            && distance <= definition.rangedRange) {
            spawnSkeletonProjectile(simulation, mob, input.player, definition);
            mob.nextRangedAttackAtSeconds = simulation.elapsedSeconds + definition.rangedCooldownSeconds;
          }
        } else {
          const standoff = meleeMobPlayerStandoff(mob.kind);
          if (standoff > 0 && distance <= standoff) {
            if (distance > 0.0001) {
              mob.directionX = playerDx * inverseDistance;
              mob.directionZ = playerDz * inverseDistance;
              separationX = -mob.directionX;
              separationZ = -mob.directionZ;
            } else {
              const separation = stableMobSeparationDirection(mob.behaviorSeed);
              separationX = separation[0];
              separationZ = separation[1];
              // Face back toward the player along the same stable axis while separating.
              mob.directionX = -separationX;
              mob.directionZ = -separationZ;
            }
            chaseMovementLimit = 0;
            const correction = standoff - distance;
            if (correction > 1e-7) tryMoveMob(mob, separationX * correction, separationZ * correction, input);
          } else {
            mob.directionX = playerDx * inverseDistance;
            mob.directionZ = playerDz * inverseDistance;
            if (standoff > 0) chaseMovementLimit = Math.max(0, distance - standoff);
          }
          speed = definition.chaseSpeed;
        }
        if (mob.behavior !== "fuse") {
          mob.behavior = "chase";
          mob.behaviorUntilSeconds = simulation.elapsedSeconds + 0.25;
          chasing = true;
        }
      }
    }

    if (mob.kind === "creeper" && mob.fuseStartedAtSeconds > 0 && !chasing) {
      mob.fuseStartedAtSeconds = mob.fuseUntilSeconds = 0;
      mob.behavior = "idle";
      mob.behaviorUntilSeconds = simulation.elapsedSeconds;
    }

    if (mob.behavior === "chase" && !chasing) {
      mob.behavior = "idle";
      mob.behaviorUntilSeconds = simulation.elapsedSeconds;
    }

    if (mob.behavior !== "chase" && mob.behavior !== "fuse"
      && simulation.elapsedSeconds >= mob.behaviorUntilSeconds) {
      choosePassiveBehavior(mob, simulation.elapsedSeconds);
    }
    if (mob.behavior === "idle" || mob.behavior === "dormant") {
      mob.desiredX = mob.x;
      mob.desiredZ = mob.z;
      continue;
    }

    if (mob.behavior === "wander") {
      const homeDx = mob.homeX - mob.x;
      const homeDz = mob.homeZ - mob.z;
      const homeDistanceSquared = homeDx * homeDx + homeDz * homeDz;
      if (homeDistanceSquared > 8 * 8) {
        const inverseDistance = 1 / Math.sqrt(homeDistanceSquared);
        mob.directionX = homeDx * inverseDistance;
        mob.directionZ = homeDz * inverseDistance;
      }
    }
    if (mob.directionX !== 0 || mob.directionZ !== 0) {
      const intendedYaw = mobFacingYaw(mob.directionX, mob.directionZ, mob.yaw);
      const movementDistance = Math.min(speed * dt, chaseMovementLimit);
      if (movementDistance > 1e-7) {
        const beforeX = mob.x;
        const beforeZ = mob.z;
        moveMob(mob, mob.directionX * movementDistance, mob.directionZ * movementDistance, input);
        const movedX = mob.x - beforeX;
        const movedZ = mob.z - beforeZ;
        mob.yaw = mobFacingYaw(movedX, movedZ, intendedYaw);
      } else {
        mob.yaw = intendedYaw;
        mob.desiredX = mob.x;
        mob.desiredZ = mob.z;
      }
    }
  }
  stepMobProjectiles(simulation, input, dt);
  return simulation;
}

/** Consumes completed offline fuses exactly once and removes those creepers. */
export function consumeDueLocalCreeperExplosions(
  simulation: MobSimulation,
  output: LocalCreeperExplosionEvent[] = [],
): LocalCreeperExplosionEvent[] {
  let outputIndex = 0;
  for (const mob of simulation.mobs) {
    if (!mob.alive || mob.kind !== "creeper" || mob.fuseStartedAtSeconds <= 0
      || mob.fuseUntilSeconds <= mob.fuseStartedAtSeconds
      || simulation.elapsedSeconds < mob.fuseUntilSeconds) continue;
    const event = output[outputIndex] ?? {} as LocalCreeperExplosionEvent;
    event.mobId = mob.id;
    event.x = mob.x;
    event.y = mob.y;
    event.z = mob.z;
    output[outputIndex] = event;
    outputIndex += 1;
    mob.alive = false;
    mob.health = 0;
    mob.behaviorUntilSeconds = simulation.elapsedSeconds + LOCAL_MOB_RESPAWN_DELAY_SECONDS;
    mob.fuseStartedAtSeconds = mob.fuseUntilSeconds = 0;
    beginMobDeathAnimation(mob, simulation.elapsedSeconds);
  }
  output.length = outputIndex;
  return output;
}

/** Writes live and briefly dying poses into a reusable retained array. */
export function writeMobPoseSnapshots(
  simulation: Readonly<MobSimulation>,
  output: MobPoseSnapshot[] = [],
): MobPoseSnapshot[] {
  let outputIndex = 0;
  for (let index = 0; index < simulation.mobs.length; index += 1) {
    const mob = simulation.mobs[index];
    if (!mob.alive && (mob.deathUntil <= 0
      || simulation.elapsedSeconds + 1e-9 >= mob.deathUntil)) continue;
    const definition = MOB_DEFINITIONS[mob.kind];
    const snapshot = output[outputIndex] ?? {} as MobPoseSnapshot;
    snapshot.id = mob.id;
    snapshot.kind = mob.kind;
    snapshot.x = mob.x;
    snapshot.y = mob.y;
    snapshot.z = mob.z;
    snapshot.yaw = mob.yaw;
    snapshot.previousX = mob.previousX;
    snapshot.previousY = mob.previousY;
    snapshot.previousZ = mob.previousZ;
    snapshot.previousYaw = mob.previousYaw;
    snapshot.behavior = mob.behavior;
    snapshot.health = mob.health;
    snapshot.maxHealth = definition.maxHealth;
    snapshot.hostileActive = mob.hostileActive;
    snapshot.sheared = mob.sheared;
    snapshot.fuseProgress = mob.fuseStartedAtSeconds > 0
      ? clamp(
        (simulation.elapsedSeconds - mob.fuseStartedAtSeconds)
          / (CREEPER_FUSE_TICKS / MOB_MOTION_TICKS_PER_SECOND),
        0,
        1,
      )
      : 0;
    snapshot.sunBurning = mob.alive && mob.sunDamageAt > 0;
    snapshot.deathFall = mob.alive ? 0 : clamp(
      (simulation.elapsedSeconds - mob.deathUntil + LOCAL_MOB_DEATH_ANIMATION_SECONDS)
        / LOCAL_MOB_DEATH_ANIMATION_SECONDS,
      0,
      1,
    );
    output[outputIndex] = snapshot;
    outputIndex += 1;
  }
  output.length = outputIndex;
  return output;
}

/** Writes live arrows into a retained array; the projectile pool itself is fixed-size. */
export function writeMobProjectileSnapshots(
  simulation: Readonly<MobSimulation>,
  output: MobProjectileSnapshot[] = [],
): MobProjectileSnapshot[] {
  let outputIndex = 0;
  for (let index = 0; index < simulation.projectiles.length; index += 1) {
    const projectile = simulation.projectiles[index];
    if (!projectile.active) continue;
    const snapshot = output[outputIndex] ?? {} as MobProjectileSnapshot;
    snapshot.id = projectile.id;
    snapshot.x = projectile.x;
    snapshot.y = projectile.y;
    snapshot.z = projectile.z;
    snapshot.previousX = projectile.previousX;
    snapshot.previousY = projectile.previousY;
    snapshot.previousZ = projectile.previousZ;
    snapshot.yaw = projectile.yaw;
    snapshot.pitch = projectile.pitch;
    output[outputIndex] = snapshot;
    outputIndex += 1;
  }
  output.length = outputIndex;
  return output;
}

/** Clears and returns damage from arrow impacts since the previous simulation step. */
export function consumeMobProjectileDamage(simulation: MobSimulation, maximumDamage = 12): number {
  const limit = Number.isFinite(maximumDamage) ? Math.max(0, maximumDamage) : 12;
  const damage = Math.min(limit, simulation.pendingProjectileDamage);
  simulation.pendingProjectileDamage = 0;
  return damage;
}

function rollDrops(mob: MobState, damageSequence = mob.damageSequence): MobDrop[] {
  const definitions = MOB_DEFINITIONS[mob.kind].drops;
  const drops: MobDrop[] = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const drop = definitions[index];
    if (mob.kind === "sheep" && mob.sheared && drop.itemId === "wool") continue;
    const chance = hash01(mob.behaviorSeed, damageSequence + index, 811);
    if (chance > drop.chance) continue;
    const range = drop.maxCount - drop.minCount + 1;
    const count = drop.minCount + Math.floor(hash01(mob.behaviorSeed, damageSequence + index, 829) * range);
    if (count > 0) drops.push({ itemId: drop.itemId, count });
  }
  return drops;
}

function mobDamageResult(
  found: boolean,
  applied: boolean,
  killed: boolean,
  remainingHealth: number,
  drops: MobDrop[] = [],
): MobDamageResult {
  return { found, applied, killed, remainingHealth, drops };
}

export function damageMob(
  simulation: MobSimulation,
  id: string,
  rawDamage: number,
  onFatalDrops?: (event: Readonly<LocalMobDeathDropEvent>) => boolean,
): MobDamageResult {
  const mob = simulation.mobs.find((candidate) => candidate.id === id);
  if (!mob || !mob.alive) return mobDamageResult(Boolean(mob), false, false, 0);
  const damage = Number.isFinite(rawDamage) ? Math.max(0, rawDamage) : 0;
  if (damage === 0) return mobDamageResult(true, false, false, mob.health);
  const damageSequence = mob.damageSequence + 1;
  const health = Math.max(0, mob.health - damage);
  if (health > 0) {
    mob.damageSequence = damageSequence;
    mob.health = health;
    return mobDamageResult(true, true, false, mob.health);
  }
  const drops = rollDrops(mob, damageSequence);
  if (onFatalDrops && !onFatalDrops({
    eventId: `${mob.id}:${damageSequence}`,
    mobId: mob.id,
    x: mob.x,
    y: mob.y,
    z: mob.z,
    drops,
  })) {
    return mobDamageResult(true, false, false, mob.health);
  }
  mob.damageSequence = damageSequence;
  mob.health = 0;
  mob.alive = false;
  mob.sheared = false;
  beginMobDeathAnimation(mob, simulation.elapsedSeconds);
  if (mob.authoritativeRevision < 0) {
    mob.behaviorUntilSeconds = simulation.elapsedSeconds + LOCAL_MOB_RESPAWN_DELAY_SECONDS;
  }
  return mobDamageResult(true, true, true, 0, drops);
}

/**
 * Applies one local sheep clip. The accept callback lets the inventory layer
 * reserve all wool before the visual state changes, so durability and drops
 * stay atomic without teaching the renderer about inventory slots.
 */
export function shearLocalMob(
  simulation: MobSimulation,
  id: string,
  acceptWool: (count: number) => boolean,
): LocalMobShearResult {
  const mob = simulation.mobs.find((candidate) => candidate.id === id);
  if (!mob || !mob.alive || mob.kind !== "sheep") return { ok: false, reason: "invalid_mob" };
  if (mob.sheared) return { ok: false, reason: "already_sheared" };
  const woolCount = 1 + (hashUint(mob.behaviorSeed, mob.id.length, 947) % 3);
  if (!acceptWool(woolCount)) return { ok: false, reason: "rejected" };
  mob.sheared = true;
  return { ok: true, woolCount };
}

function resetMobAtHome(mob: MobState, elapsedSeconds: number): void {
  mob.x = mob.previousX = mob.homeX;
  mob.y = mob.previousY = mob.homeY;
  mob.z = mob.previousZ = mob.homeZ;
  mob.health = MOB_DEFINITIONS[mob.kind].maxHealth;
  mob.alive = true;
  mob.behavior = MOB_DEFINITIONS[mob.kind].passive ? "idle" : "dormant";
  mob.behaviorUntilSeconds = 0;
  mob.directionX = mob.directionZ = 0;
  mob.desiredX = mob.homeX;
  mob.desiredZ = mob.homeZ;
  mob.hostileActive = false;
  mob.sheared = false;
  mob.nextContactDamageAtSeconds = 0;
  mob.nextRangedAttackAtSeconds = Math.max(0, elapsedSeconds) + 0.65 + (mob.behaviorSeed % 1_000) / 1_000;
  mob.rangedSequence = 0;
  mob.fuseStartedAtSeconds = mob.fuseUntilSeconds = 0;
  mob.spiderUntil = 0;
  mob.sunDamageAt = 0;
  mob.deathUntil = 0;
}

function localMobHomeAvailable(
  simulation: Readonly<MobSimulation>,
  mob: MobState,
  input: Readonly<MobStepInput>,
): boolean {
  const definition = MOB_DEFINITIONS[mob.kind];
  const limit = Number.isFinite(input.worldRadius) ? Math.max(1, Math.abs(input.worldRadius as number)) : Infinity;
  const centerX = Number.isFinite(input.worldCenterX) ? input.worldCenterX as number : 0;
  const centerZ = Number.isFinite(input.worldCenterZ) ? input.worldCenterZ as number : 0;
  if (!insideWorldBounds(mob.x, mob.z, definition.collisionRadius, centerX, centerZ, limit)) return false;
  if (!insideWorldBounds(mob.homeX, mob.homeZ, definition.collisionRadius, centerX, centerZ, limit)) {
    // Older retained snapshots can carry a home from terrain that has since
    // unloaded. Rehome the same slot at its valid corpse position before the
    // ordinary distance, collision, and occupancy gates decide its respawn.
    mob.homeX = mob.desiredX = mob.x;
    mob.homeY = mob.y;
    mob.homeZ = mob.desiredZ = mob.z;
  }
  if (input.player) {
    const playerDx = input.player.x - mob.homeX;
    const playerDz = input.player.z - mob.homeZ;
    if (playerDx * playerDx + playerDz * playerDz < LOCAL_MOB_RESPAWN_PLAYER_DISTANCE ** 2) return false;
  }
  if (input.canOccupy && !input.canOccupy(
    mob.kind,
    mob.homeX,
    mob.homeY,
    mob.homeZ,
    definition.collisionRadius,
    definition.height,
  )) return false;
  if (!definition.passive && input.localLight
    && localLightAt(mob, input, mob.homeX, mob.homeY, mob.homeZ)
    >= LOCAL_MOB_HOSTILE_SPAWN_LIGHT_MAX) return false;
  for (const other of simulation.mobs) {
    if (!other.alive || other.id === mob.id) continue;
    const otherDefinition = MOB_DEFINITIONS[other.kind];
    if (Math.abs(other.y - mob.homeY) >= Math.max(definition.height, otherDefinition.height)) continue;
    const dx = other.x - mob.homeX;
    const dz = other.z - mob.homeZ;
    const separation = definition.collisionRadius + otherDefinition.collisionRadius;
    if (dx * dx + dz * dz < separation * separation) return false;
  }
  return true;
}

/**
 * Applies only newer combat revisions to deterministic local mobs. Movement
 * remains local, while health, death, and the respawn window follow Lakebed.
 */
export function applyAuthoritativeMobCombatStates(
  simulation: MobSimulation,
  states: readonly MobCombatStateSnapshot[],
  serverNow: number,
): MobCombatApplyResult {
  const byId = new Map(simulation.mobs.map((mob) => [mob.id, mob]));
  const now = Number.isFinite(serverNow) ? serverNow : 0;
  const result: MobCombatApplyResult = { applied: 0, stale: 0, invalid: 0, unknown: 0 };
  for (const state of states) {
    const mob = byId.get(state.mobId);
    if (!mob) {
      result.unknown += 1;
      continue;
    }
    if (state.kind !== mob.kind
      || typeof state.sheared !== "boolean"
      || !Number.isFinite(state.health)
      || !Number.isFinite(state.maxHealth)
      || !Number.isFinite(state.revision)
      || !Number.isFinite(state.deadUntil)
      || !Number.isInteger(state.health)
      || !Number.isInteger(state.revision)
      || !Number.isInteger(state.deadUntil)
      || state.maxHealth !== MOB_DEFINITIONS[mob.kind].maxHealth
      || state.health < 0
      || state.health > state.maxHealth
      || state.revision < 0
      || state.deadUntil < 0) {
      result.invalid += 1;
      continue;
    }
    const revision = Math.floor(state.revision);
    if (revision <= mob.authoritativeRevision) {
      result.stale += 1;
      continue;
    }
    mob.authoritativeRevision = revision;
    mob.authoritativeDeadUntil = Math.max(0, state.deadUntil);
    mob.sheared = state.kind === "sheep" && state.sheared;
    const dead = mob.authoritativeDeadUntil > now;
    if (dead) {
      mob.health = 0;
      mob.alive = false;
      beginMobDeathAnimation(mob, simulation.elapsedSeconds);
    } else if (!mob.alive || state.health <= 0) {
      resetMobAtHome(mob, simulation.elapsedSeconds);
    } else {
      mob.health = clamp(state.health, 0, MOB_DEFINITIONS[mob.kind].maxHealth);
      mob.alive = mob.health > 0;
    }
    result.applied += 1;
  }
  return result;
}

/** Respawns dead authoritative mobs once their Lakebed deadline has elapsed. */
export function respawnExpiredAuthoritativeMobs(simulation: MobSimulation, serverNow: number): number {
  if (!Number.isFinite(serverNow)) return 0;
  let respawned = 0;
  for (const mob of simulation.mobs) {
    if (mob.alive || mob.authoritativeRevision < 0 || mob.authoritativeDeadUntil <= 0 || serverNow < mob.authoritativeDeadUntil) continue;
    mob.authoritativeDeadUntil = 0;
    resetMobAtHome(mob, simulation.elapsedSeconds);
    respawned += 1;
  }
  return respawned;
}

/** Returns the nearest living mob intersected by a ray, without considering world-block occlusion. */
export function raycastMobs(
  origin: readonly [number, number, number],
  rawDirection: readonly [number, number, number],
  mobs: readonly MobState[],
  reach = 6,
): MobRayTarget | null {
  const directionLength = Math.hypot(rawDirection[0], rawDirection[1], rawDirection[2]);
  const maximumDistance = Number.isFinite(reach) ? Math.max(0, reach) : 6;
  if (directionLength < 1e-9 || maximumDistance === 0) return null;
  const directionX = rawDirection[0] / directionLength;
  const directionY = rawDirection[1] / directionLength;
  const directionZ = rawDirection[2] / directionLength;
  let nearest: MobRayTarget | null = null;
  let nearestDistance = maximumDistance;
  const interval: [number, number] = [0, maximumDistance];

  for (let index = 0; index < mobs.length; index += 1) {
    const mob = mobs[index];
    if (!mob.alive) continue;
    const definition = MOB_DEFINITIONS[mob.kind];
    const radius = definition.targetRadius;
    interval[0] = 0;
    interval[1] = nearestDistance;
    if (!clipAxisInterval(interval, origin[0], directionX, mob.x - radius, mob.x + radius)
      || !clipAxisInterval(interval, origin[1], directionY, mob.y, mob.y + definition.height)
      || !clipAxisInterval(interval, origin[2], directionZ, mob.z - radius, mob.z + radius)) continue;
    const near = interval[0];
    if (near > nearestDistance) continue;
    nearestDistance = near;
    nearest = {
      id: mob.id,
      kind: mob.kind,
      distance: near,
      x: origin[0] + directionX * near,
      y: origin[1] + directionY * near,
      z: origin[2] + directionZ * near,
    };
  }
  return nearest;
}

export function mobTargetHasClickPriority(mobDistance: number, blockDistance: number | null): boolean {
  if (!Number.isFinite(mobDistance) || mobDistance < 0) return false;
  return blockDistance === null || !Number.isFinite(blockDistance) || mobDistance <= blockDistance + 0.001;
}

/**
 * Consumes cooldown-ready hostile melee hits and returns bounded aggregate damage.
 * The mutation is local simulation state only; this alpha combat is not authoritative
 * or synchronized through Lakebed.
 */
export function consumeMobContactDamage(
  simulation: MobSimulation,
  player: Readonly<MobTarget>,
  nowSeconds: number,
  isNight: boolean,
  maximumDamage = MAX_CONTACT_DAMAGE_PER_TICK,
  sources?: MobDamageSource[],
): number {
  if (!Number.isFinite(nowSeconds)) return 0;
  const damageLimit = Number.isFinite(maximumDamage) ? Math.max(0, maximumDamage) : MAX_CONTACT_DAMAGE_PER_TICK;
  let damage = 0;
  for (let index = 0; index < simulation.mobs.length; index += 1) {
    const mob = simulation.mobs[index];
    // The tick-zero night fallback preserves direct unit consumers that have
    // not stepped AI yet; ordinary engine ticks use the light-aware flag.
    if (!mob.alive || (!mob.hostileActive && !(simulation.tick === 0 && isNight))
      || MOB_DEFINITIONS[mob.kind].contactDamage <= 0
      || nowSeconds + 1e-9 < mob.nextContactDamageAtSeconds) continue;
    const definition = MOB_DEFINITIONS[mob.kind];
    const horizontalReach = meleeMobPlayerAttackReach(mob.kind);
    const dx = player.x - mob.x;
    const dz = player.z - mob.z;
    if (dx * dx + dz * dz > horizontalReach * horizontalReach) continue;
    if (player.y + 1.78 <= mob.y || mob.y + definition.height <= player.y) continue;
    if (damage + definition.contactDamage > damageLimit) {
      // The attempted contact is consumed even when the aggregate cap absorbs it,
      // preventing a crowd from leaking queued hits across consecutive frames.
      mob.nextContactDamageAtSeconds = nowSeconds + definition.attackCooldownSeconds;
      continue;
    }
    damage += definition.contactDamage;
    sources?.push({
      eventId: `contact:${mob.id}:${simulation.tick}`,
      mobId: mob.id,
      x: mob.x,
      z: mob.z,
      damage: definition.contactDamage,
    });
    mob.nextContactDamageAtSeconds = nowSeconds + definition.attackCooldownSeconds;
  }
  return damage;
}
