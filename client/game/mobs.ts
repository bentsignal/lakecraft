import type { MobAuthorityState } from "../../shared/mobCombat.ts";
import {
  CREEPER_FUSE_CANCEL_RANGE_BLOCKS,
  CREEPER_FUSE_START_RANGE_BLOCKS,
  CREEPER_FUSE_TICKS,
  CREEPER_FUSE_VERTICAL_RANGE_BLOCKS,
  MOB_MOTION_TICKS_PER_SECOND,
} from "../../shared/mobMotionAuthority.ts";
import * as BS from "../../shared/bundleStrings.ts";

export type MobKind = "pig" | "cow" | "sheep" | "chicken" | "zombie" | "skeleton" | "creeper" | "spider";
export type MobBehavior = "dormant" | "idle" | "wander" | "chase" | "fuse";
export type MobDropId = "pork" | "beef" | "leather" | "wool" | "mutton" | "raw_chicken" | "feather" | "rotten_flesh" | "stick" | "string" | "arrow" | "bone" | "gunpowder";

/** Lakebed combat state is authoritative when supplied; local combat remains a development fallback. */
export const MOB_COMBAT_AUTHORITY = "lakebed-optional" as const;

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

export const MOB_DEFINITIONS: Readonly<Record<MobKind, MobDefinition>> = Object.freeze({
  pig: Object.freeze({
    kind: "pig",
    passive: true,
    maxHealth: 10,
    moveSpeed: 1.15,
    chaseSpeed: 1.15,
    collisionRadius: 0.45,
    targetRadius: 1.05,
    height: 1,
    contactDamage: 0,
    attackCooldownSeconds: 0,
    rangedDamage: 0,
    rangedCooldownSeconds: 0,
    rangedRange: 0,
    projectileSpeed: 0,
    drops: Object.freeze([{ itemId: "pork", minCount: 1, maxCount: 3, chance: 1 }]),
  }),
  cow: Object.freeze({
    kind: "cow",
    passive: true,
    maxHealth: 10,
    moveSpeed: 1,
    chaseSpeed: 1,
    collisionRadius: 0.48,
    targetRadius: 1.22,
    height: 1.35,
    contactDamage: 0,
    attackCooldownSeconds: 0,
    rangedDamage: 0,
    rangedCooldownSeconds: 0,
    rangedRange: 0,
    projectileSpeed: 0,
    drops: Object.freeze([
      { itemId: "beef", minCount: 1, maxCount: 3, chance: 1 },
      { itemId: "leather", minCount: 0, maxCount: 2, chance: 0.75 },
    ]),
  }),
  sheep: Object.freeze({
    kind: "sheep",
    passive: true,
    maxHealth: 8,
    moveSpeed: 1.05,
    chaseSpeed: 1.05,
    collisionRadius: 0.44,
    targetRadius: 1.16,
    height: 1.25,
    contactDamage: 0,
    attackCooldownSeconds: 0,
    rangedDamage: 0,
    rangedCooldownSeconds: 0,
    rangedRange: 0,
    projectileSpeed: 0,
    drops: Object.freeze([
      { itemId: "wool", minCount: 1, maxCount: 1, chance: 1 },
      { itemId: "mutton", minCount: 1, maxCount: 2, chance: 1 },
    ]),
  }),
  chicken: Object.freeze({
    kind: "chicken",
    passive: true,
    maxHealth: 4,
    moveSpeed: 1.1,
    chaseSpeed: 1.1,
    collisionRadius: 0.3,
    targetRadius: 0.78,
    height: 1.1,
    contactDamage: 0,
    attackCooldownSeconds: 0,
    rangedDamage: 0,
    rangedCooldownSeconds: 0,
    rangedRange: 0,
    projectileSpeed: 0,
    drops: Object.freeze([
      { itemId: "raw_chicken", minCount: 1, maxCount: 1, chance: 1 },
      { itemId: "feather", minCount: 0, maxCount: 2, chance: 1 },
    ]),
  }),
  zombie: Object.freeze({
    kind: "zombie",
    passive: false,
    maxHealth: 20,
    moveSpeed: 0.9,
    chaseSpeed: 1.45,
    collisionRadius: 0.38,
    targetRadius: 0.4,
    height: 1.8,
    contactDamage: 3,
    attackCooldownSeconds: 1,
    rangedDamage: 0,
    rangedCooldownSeconds: 0,
    rangedRange: 0,
    projectileSpeed: 0,
    drops: Object.freeze([{ itemId: "rotten_flesh", minCount: 0, maxCount: 2, chance: 0.85 }]),
  }),
  skeleton: Object.freeze({
    kind: "skeleton",
    passive: false,
    maxHealth: 20,
    moveSpeed: 0.82,
    chaseSpeed: 1.15,
    collisionRadius: 0.34,
    targetRadius: 0.38,
    height: 1.9,
    contactDamage: 0,
    attackCooldownSeconds: 0,
    rangedDamage: 3,
    rangedCooldownSeconds: 2.1,
    rangedRange: 16,
    projectileSpeed: 8.5,
    drops: Object.freeze([
      { itemId: "arrow", minCount: 0, maxCount: 2, chance: 1 },
      { itemId: "bone", minCount: 0, maxCount: 2, chance: 1 },
    ]),
  }),
  creeper: Object.freeze({
    kind: "creeper",
    passive: false,
    maxHealth: 20,
    moveSpeed: 0.84,
    chaseSpeed: 1.1,
    collisionRadius: 0.36,
    targetRadius: 0.4,
    height: 1.7,
    contactDamage: 0,
    attackCooldownSeconds: 0,
    rangedDamage: 0,
    rangedCooldownSeconds: 0,
    rangedRange: 0,
    projectileSpeed: 0,
    drops: Object.freeze([{ itemId: BS.gunpowder, minCount: 0, maxCount: 2, chance: 1 }]),
  }),
  spider: Object.freeze({
    kind: "spider",
    passive: false,
    maxHealth: 16,
    moveSpeed: 1.02,
    chaseSpeed: 1.55,
    collisionRadius: 0.68,
    targetRadius: 0.72,
    height: 0.8,
    contactDamage: 2,
    attackCooldownSeconds: 1,
    rangedDamage: 0,
    rangedCooldownSeconds: 0,
    rangedRange: 0,
    projectileSpeed: 0,
    drops: Object.freeze([{ itemId: "string", minCount: 0, maxCount: 2, chance: 1 }]),
  }),
});

export const DEFAULT_MAX_MOB_POPULATION = 24;
export const HARD_MAX_MOB_POPULATION = 64;
export const MAX_MOB_PROJECTILES = 24;
export const MOB_PROJECTILE_LIFETIME_SECONDS = 3;
export const MOB_PROJECTILE_GRAVITY = 2.4;
export const LOCAL_MOB_LINE_OF_SIGHT_MAX_SAMPLES = 64;

/** Creepers remain hostile in daylight; the other current hostiles do not. */
export function localMobHostileActive(kind: MobKind, isNight: boolean): boolean {
  return !MOB_DEFINITIONS[kind].passive && (isNight || kind === "creeper");
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
  const samples = Math.min(LOCAL_MOB_LINE_OF_SIGHT_MAX_SAMPLES, Math.max(1, Math.ceil(distance * 4)));
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
  /** Final collision/ground veto supplied by the world implementation. */
  isSpawnable?: (kind: MobKind, x: number, y: number, z: number) => boolean;
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

export const MOB_SIMULATION_SNAPSHOT_VERSION = 1 as const;
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
] as const;

const MOB_PROJECTILE_SNAPSHOT_KEYS = [
  "id", "active", "ownerId", "x", "y", "z", BS.previousX, BS.previousY, BS.previousZ,
  "velocityX", "velocityY", "velocityZ", "yaw", "pitch", "remainingSeconds", "damage",
] as const;

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
  const positionFields = ["x", "y", "z", "homeX", "homeY", "homeZ", BS.previousX, BS.previousY, BS.previousZ, "desiredX", "desiredZ"] as const;
  if (!positionFields.every((field) => finiteInRange(mob[field], -1_000_000, 1_000_000))) return false;
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
  const timeFields = [
    "behaviorUntilSeconds", "nextContactDamageAtSeconds", "nextRangedAttackAtSeconds",
    "fuseStartedAtSeconds", "fuseUntilSeconds",
  ] as const;
  if (!timeFields.every((field) => finiteInRange(mob[field], 0, 1_000_000_000_000))) return false;
  if (!finiteInRange(mob.authoritativeDeadUntil, 0, 10_000_000_000_000_000)) return false;
  if (kind !== "creeper" && ((mob.fuseStartedAtSeconds as number) !== 0 || (mob.fuseUntilSeconds as number) !== 0)) return false;
  if ((mob.fuseStartedAtSeconds as number) > (mob.fuseUntilSeconds as number)) return false;
  return true;
}

function validMobProjectileSnapshot(value: unknown, expectedId: number): value is MobProjectile {
  const projectile = snapshotRecord(value);
  if (!projectile || !hasExactKeys(projectile, MOB_PROJECTILE_SNAPSHOT_KEYS)) return false;
  if (projectile.id !== expectedId || typeof projectile.active !== "boolean") return false;
  if (typeof projectile.ownerId !== "string" || projectile.ownerId.length > 128) return false;
  const coordinates = ["x", "y", "z", BS.previousX, BS.previousY, BS.previousZ] as const;
  if (!coordinates.every((field) => finiteInRange(projectile[field], -1_000_000, 1_000_000))) return false;
  const velocities = ["velocityX", "velocityY", "velocityZ"] as const;
  if (!velocities.every((field) => finiteInRange(projectile[field], -1_000, 1_000))) return false;
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

function hashUint(x: number, z: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(z + seed, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function hash01(x: number, z: number, seed: number): number {
  return hashUint(x, z, seed) / 4294967296;
}

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

function passiveKind(index: number, seed: number): MobKind {
  const offset = hashUint(seed, 71, seed + 19) % 4;
  const choice = (index + offset) % 4;
  return choice === 0 ? "pig" : choice === 1 ? "cow" : choice === 2 ? "sheep" : "chicken";
}

function hostileKind(index: number, seed: number): MobKind {
  const choice = (index + hashUint(seed, 113, seed + 29) % 4) % 4;
  return choice === 0 ? "zombie" : choice === 1 ? "skeleton" : choice === 2 ? "creeper" : "spider";
}

function hasSafeSlope(heightAt: (x: number, z: number) => number, x: number, z: number): boolean {
  const center = heightAt(x, z);
  return Math.abs(heightAt(x + 1, z) - center) <= 1
    && Math.abs(heightAt(x - 1, z) - center) <= 1
    && Math.abs(heightAt(x, z + 1) - center) <= 1
    && Math.abs(heightAt(x, z - 1) - center) <= 1;
}

/** Creates a bounded, stable spawn list from only seed and terrain callbacks. */
export function createMobSpawns(options: Readonly<MobSpawnOptions>): MobSpawnDescriptor[] {
  const maxPopulation = Math.max(0, Math.min(
    HARD_MAX_MOB_POPULATION,
    finiteInteger(options.maxPopulation ?? DEFAULT_MAX_MOB_POPULATION, DEFAULT_MAX_MOB_POPULATION),
  ));
  const passiveTarget = Math.max(0, finiteInteger(options.passivePopulation ?? 15, 15));
  const hostileTarget = Math.max(0, finiteInteger(options.hostilePopulation ?? 6, 6));
  const target = Math.min(maxPopulation, passiveTarget + hostileTarget);
  if (target === 0) return [];

  const requestedPopulation = passiveTarget + hostileTarget;
  const passiveCount = requestedPopulation === 0
    ? 0
    : Math.min(passiveTarget, Math.round(target * passiveTarget / requestedPopulation));
  const radius = Math.max(1, Math.abs(finiteInteger(options.radius, 1)));
  const centerX = finiteInteger(options.centerX ?? 0, 0);
  const centerZ = finiteInteger(options.centerZ ?? 0, 0);
  const clearRadius = Math.max(0, Math.min(radius - 1, finiteInteger(options.spawnClearRadius ?? 6, 6)));
  const usableRange = Math.max(1, radius - clearRadius);
  const occupied = new Set<string>();
  const spawns: MobSpawnDescriptor[] = [];
  const maxAttempts = Math.max(96, target * 32);

  for (let attempt = 0; attempt < maxAttempts && spawns.length < target; attempt += 1) {
    const slot = spawns.length;
    const kind = slot < passiveCount
      ? passiveKind(slot, options.seed)
      : hostileKind(slot - passiveCount, options.seed);
    const angle = hash01(attempt, slot, options.seed + 101) * Math.PI * 2;
    const distance = clearRadius + 1 + Math.sqrt(hash01(slot, attempt, options.seed + 131)) * (usableRange - 1);
    const x = centerX + Math.max(-radius, Math.min(radius, Math.round(Math.cos(angle) * distance)));
    const z = centerZ + Math.max(-radius, Math.min(radius, Math.round(Math.sin(angle) * distance)));
    if (Math.max(Math.abs(x - centerX), Math.abs(z - centerZ)) <= clearRadius) continue;
    const key = `${x},${z}`;
    if (occupied.has(key) || !hasSafeSlope(options.terrainHeight, x, z)) continue;
    const y = options.terrainHeight(x, z) + 1;
    if (options.isSpawnable && !options.isSpawnable(kind, x, y, z)) continue;

    const behaviorSeed = hashUint(x, z, options.seed + slot * 97 + 401) || 0x6d2b79f5;
    spawns.push({
      id: `${kind}-${(options.seed >>> 0).toString(36)}-${slot.toString(36)}`,
      kind,
      x,
      y,
      z,
      yaw: hash01(x, z, options.seed + 211) * Math.PI * 2 - Math.PI,
      homeX: x,
      homeZ: z,
      behaviorSeed,
    });
    occupied.add(key);
  }
  return spawns;
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

/**
 * Rehomes only local mobs that left the retained terrain square. Slots and
 * damage sequences stay stable, while discarded objects and their projectiles
 * immediately leave the fixed-size simulation.
 */
export function reconcileLocalMobStreaming(
  simulation: MobSimulation,
  spawns: readonly MobSpawnDescriptor[],
  centerX: number,
  centerZ: number,
  retainRadius: number,
): number {
  const count = Math.min(HARD_MAX_MOB_POPULATION, spawns.length);
  const radius = Math.max(0, Number.isFinite(retainRadius) ? retainRadius : 0);
  let recycled = 0;
  for (let index = 0; index < Math.max(simulation.mobs.length, count); index += 1) {
    const previous = simulation.mobs[index];
    const spawn = index < count ? spawns[index] : undefined;
    if (previous && spawn && previous.id === spawn.id
      && Math.max(Math.abs(previous.x - centerX), Math.abs(previous.z - centerZ)) <= radius) {
      if (Math.max(Math.abs(previous.homeX - centerX), Math.abs(previous.homeZ - centerZ)) > radius) {
        previous.homeX = previous.desiredX = previous.x;
        previous.homeY = previous.y;
        previous.homeZ = previous.desiredZ = previous.z;
      }
      continue;
    }
    if (previous) {
      for (const projectile of simulation.projectiles) {
        if (projectile.active && projectile.ownerId === previous.id) projectile.active = false;
      }
    }
    if (spawn) {
      const replacement = mobStateForSpawn(spawn);
      if (previous?.id === spawn.id) replacement.damageSequence = previous.damageSequence;
      simulation.mobs[index] = replacement;
    }
    recycled += 1;
  }
  simulation.mobs.length = count;
  return recycled;
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

function canMoveTo(mob: MobState, x: number, z: number, input: Readonly<MobStepInput>): boolean {
  const definition = MOB_DEFINITIONS[mob.kind];
  const limit = Number.isFinite(input.worldRadius) ? Math.max(1, Math.abs(input.worldRadius as number)) : Infinity;
  const centerX = Number.isFinite(input.worldCenterX) ? input.worldCenterX as number : 0;
  const centerZ = Number.isFinite(input.worldCenterZ) ? input.worldCenterZ as number : 0;
  if (Math.abs(x - centerX) + definition.collisionRadius > limit
    || Math.abs(z - centerZ) + definition.collisionRadius > limit) return false;
  const y = input.terrainHeight(Math.floor(x), Math.floor(z)) + 1;
  if (Math.abs(y - mob.y) > 1.01) return false;
  return input.canOccupy?.(mob.kind, x, y, z, definition.collisionRadius, definition.height) ?? true;
}

function applyMovement(mob: MobState, x: number, z: number, input: Readonly<MobStepInput>): void {
  mob.x = x;
  mob.z = z;
  mob.y = input.terrainHeight(Math.floor(x), Math.floor(z)) + 1;
}

function moveMob(mob: MobState, dx: number, dz: number, input: Readonly<MobStepInput>): void {
  const targetX = mob.x + dx;
  const targetZ = mob.z + dz;
  mob.desiredX = targetX;
  mob.desiredZ = targetZ;
  if (canMoveTo(mob, targetX, targetZ, input)) {
    applyMovement(mob, targetX, targetZ, input);
    return;
  }
  if (dx !== 0 && canMoveTo(mob, targetX, mob.z, input)) {
    applyMovement(mob, targetX, mob.z, input);
    return;
  }
  if (dz !== 0 && canMoveTo(mob, mob.x, targetZ, input)) {
    applyMovement(mob, mob.x, targetZ, input);
    return;
  }
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

function segmentIntersectsPlayer(
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  player: Readonly<MobTarget>,
): boolean {
  let near = 0;
  let far = 1;
  const minX = player.x - 0.34;
  const maxX = player.x + 0.34;
  const minY = player.y;
  const maxY = player.y + 1.78;
  const minZ = player.z - 0.34;
  const maxZ = player.z + 0.34;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dz = toZ - fromZ;
  if (Math.abs(dx) < 1e-9) {
    if (fromX < minX || fromX > maxX) return false;
  } else {
    let first = (minX - fromX) / dx;
    let second = (maxX - fromX) / dx;
    if (first > second) { const swap = first; first = second; second = swap; }
    near = Math.max(near, first); far = Math.min(far, second);
    if (near > far) return false;
  }
  if (Math.abs(dy) < 1e-9) {
    if (fromY < minY || fromY > maxY) return false;
  } else {
    let first = (minY - fromY) / dy;
    let second = (maxY - fromY) / dy;
    if (first > second) { const swap = first; first = second; second = swap; }
    near = Math.max(near, first); far = Math.min(far, second);
    if (near > far) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (fromZ < minZ || fromZ > maxZ) return false;
  } else {
    let first = (minZ - fromZ) / dz;
    let second = (maxZ - fromZ) / dz;
    if (first > second) { const swap = first; first = second; second = swap; }
    near = Math.max(near, first); far = Math.min(far, second);
    if (near > far) return false;
  }
  return true;
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

/** Advances simulation in place without allocating during ordinary movement ticks. */
export function stepMobSimulation(simulation: MobSimulation, input: Readonly<MobStepInput>): MobSimulation {
  const dt = Math.max(0, Math.min(0.1, Number.isFinite(input.dtSeconds) ? input.dtSeconds : 0));
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
    mob.hostileActive = localMobHostileActive(mob.kind, input.isNight);

    if (mob.kind === "creeper" && mob.fuseStartedAtSeconds > 0
      && mob.fuseUntilSeconds > mob.fuseStartedAtSeconds
      && simulation.elapsedSeconds >= mob.fuseUntilSeconds) {
      // Remain visibly ready until a later authoritative explosion integration
      // consumes the latched event; do not silently restart a second fuse.
      mob.behavior = "fuse";
      mob.directionX = 0;
      mob.directionZ = 0;
      mob.desiredX = mob.x;
      mob.desiredZ = mob.z;
      continue;
    }

    if (!definition.passive && !mob.hostileActive) {
      mob.fuseStartedAtSeconds = 0;
      mob.fuseUntilSeconds = 0;
      mob.behavior = "dormant";
      mob.directionX = 0;
      mob.directionZ = 0;
      mob.desiredX = mob.x;
      mob.desiredZ = mob.z;
      continue;
    }

    let speed = definition.moveSpeed;
    let chasing = false;
    if (!definition.passive && input.player) {
      const playerDx = input.player.x - mob.x;
      const playerDz = input.player.z - mob.z;
      const distanceSquared = playerDx * playerDx + playerDz * playerDz;
      if (distanceSquared <= 16 * 16
        && localMobHasLineOfSight(mob, input.player, input.isProjectileBlocked)) {
        const distance = Math.sqrt(distanceSquared);
        const inverseDistance = distance > 0.0001 ? 1 / distance : 0;
        if (mob.kind === "creeper") {
          const verticalDistance = Math.abs(input.player.y - mob.y);
          const fuseActive = mob.fuseStartedAtSeconds > 0 && mob.fuseUntilSeconds > mob.fuseStartedAtSeconds;
          if (fuseActive && (distance > CREEPER_FUSE_CANCEL_RANGE_BLOCKS
            || verticalDistance > CREEPER_FUSE_VERTICAL_RANGE_BLOCKS)) {
            mob.fuseStartedAtSeconds = 0;
            mob.fuseUntilSeconds = 0;
            if (mob.behavior === "fuse") mob.behavior = "chase";
          }
          if (mob.fuseStartedAtSeconds > 0) {
            mob.behavior = "fuse";
            mob.directionX = 0;
            mob.directionZ = 0;
            mob.desiredX = mob.x;
            mob.desiredZ = mob.z;
            mob.behaviorUntilSeconds = mob.fuseUntilSeconds;
            chasing = true;
          } else if (distance <= CREEPER_FUSE_START_RANGE_BLOCKS
            && verticalDistance <= CREEPER_FUSE_VERTICAL_RANGE_BLOCKS) {
            mob.fuseStartedAtSeconds = simulation.elapsedSeconds;
            mob.fuseUntilSeconds = simulation.elapsedSeconds + CREEPER_FUSE_TICKS / MOB_MOTION_TICKS_PER_SECOND;
            mob.behavior = "fuse";
            mob.directionX = 0;
            mob.directionZ = 0;
            mob.desiredX = mob.x;
            mob.desiredZ = mob.z;
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
          mob.directionX = playerDx * inverseDistance;
          mob.directionZ = playerDz * inverseDistance;
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
      mob.fuseStartedAtSeconds = 0;
      mob.fuseUntilSeconds = 0;
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
      mob.yaw = Math.atan2(mob.directionX, mob.directionZ);
      moveMob(mob, mob.directionX * speed * dt, mob.directionZ * speed * dt, input);
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
    mob.fuseStartedAtSeconds = 0;
    mob.fuseUntilSeconds = 0;
  }
  output.length = outputIndex;
  return output;
}

/** Writes live poses into a reusable array for rendering or network snapshots. */
export function writeMobPoseSnapshots(
  simulation: Readonly<MobSimulation>,
  output: MobPoseSnapshot[] = [],
): MobPoseSnapshot[] {
  let outputIndex = 0;
  for (let index = 0; index < simulation.mobs.length; index += 1) {
    const mob = simulation.mobs[index];
    if (!mob.alive) continue;
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
      ? Math.max(0, Math.min(1,
        (simulation.elapsedSeconds - mob.fuseStartedAtSeconds)
          / (CREEPER_FUSE_TICKS / MOB_MOTION_TICKS_PER_SECOND)))
      : 0;
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

export function damageMob(
  simulation: MobSimulation,
  id: string,
  rawDamage: number,
  acceptFatalDrops?: (event: Readonly<LocalMobDeathDropEvent>) => boolean,
): MobDamageResult {
  const mob = simulation.mobs.find((candidate) => candidate.id === id);
  if (!mob || !mob.alive) return { found: Boolean(mob), applied: false, killed: false, remainingHealth: 0, drops: [] };
  const damage = Number.isFinite(rawDamage) ? Math.max(0, rawDamage) : 0;
  if (damage === 0) return { found: true, applied: false, killed: false, remainingHealth: mob.health, drops: [] };
  const damageSequence = mob.damageSequence + 1;
  const health = Math.max(0, mob.health - damage);
  if (health > 0) {
    mob.damageSequence = damageSequence;
    mob.health = health;
    return { found: true, applied: true, killed: false, remainingHealth: mob.health, drops: [] };
  }
  const drops = rollDrops(mob, damageSequence);
  if (acceptFatalDrops && !acceptFatalDrops({
    eventId: `${mob.id}:${damageSequence}`,
    mobId: mob.id,
    x: mob.x,
    y: mob.y,
    z: mob.z,
    drops,
  })) {
    return { found: true, applied: false, killed: false, remainingHealth: mob.health, drops: [] };
  }
  mob.damageSequence = damageSequence;
  mob.health = 0;
  mob.alive = false;
  mob.sheared = false;
  if (mob.authoritativeRevision < 0) {
    mob.behaviorUntilSeconds = simulation.elapsedSeconds + LOCAL_MOB_RESPAWN_DELAY_SECONDS;
  }
  return { found: true, applied: true, killed: true, remainingHealth: 0, drops };
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
  mob.x = mob.homeX;
  mob.y = mob.homeY;
  mob.z = mob.homeZ;
  mob.previousX = mob.homeX;
  mob.previousY = mob.homeY;
  mob.previousZ = mob.homeZ;
  mob.health = MOB_DEFINITIONS[mob.kind].maxHealth;
  mob.alive = true;
  mob.behavior = MOB_DEFINITIONS[mob.kind].passive ? "idle" : "dormant";
  mob.behaviorUntilSeconds = 0;
  mob.directionX = 0;
  mob.directionZ = 0;
  mob.desiredX = mob.homeX;
  mob.desiredZ = mob.homeZ;
  mob.hostileActive = false;
  mob.sheared = false;
  mob.nextContactDamageAtSeconds = 0;
  mob.nextRangedAttackAtSeconds = Math.max(0, elapsedSeconds) + 0.65 + (mob.behaviorSeed % 1_000) / 1_000;
  mob.rangedSequence = 0;
  mob.fuseStartedAtSeconds = 0;
  mob.fuseUntilSeconds = 0;
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
  if (Math.abs(mob.x - centerX) + definition.collisionRadius > limit
    || Math.abs(mob.z - centerZ) + definition.collisionRadius > limit) return false;
  if (Math.abs(mob.homeX - centerX) + definition.collisionRadius > limit
    || Math.abs(mob.homeZ - centerZ) + definition.collisionRadius > limit) {
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
      mob.hostileActive = false;
      mob.directionX = 0;
      mob.directionZ = 0;
    } else if (!mob.alive || state.health <= 0) {
      resetMobAtHome(mob, simulation.elapsedSeconds);
    } else {
      mob.health = Math.max(0, Math.min(MOB_DEFINITIONS[mob.kind].maxHealth, state.health));
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

function rayAxisInterval(
  origin: number,
  direction: number,
  minimum: number,
  maximum: number,
  near: number,
  far: number,
): readonly [number, number] | null {
  if (Math.abs(direction) < 1e-9) return origin >= minimum && origin <= maximum ? [near, far] : null;
  let first = (minimum - origin) / direction;
  let second = (maximum - origin) / direction;
  if (first > second) {
    const swap = first;
    first = second;
    second = swap;
  }
  const nextNear = Math.max(near, first);
  const nextFar = Math.min(far, second);
  return nextNear <= nextFar ? [nextNear, nextFar] : null;
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

  for (let index = 0; index < mobs.length; index += 1) {
    const mob = mobs[index];
    if (!mob.alive) continue;
    const definition = MOB_DEFINITIONS[mob.kind];
    const radius = definition.targetRadius;
    let near = 0;
    let far = nearestDistance;
    const xInterval = rayAxisInterval(origin[0], directionX, mob.x - radius, mob.x + radius, near, far);
    if (!xInterval) continue;
    near = xInterval[0]; far = xInterval[1];
    const yInterval = rayAxisInterval(origin[1], directionY, mob.y, mob.y + definition.height, near, far);
    if (!yInterval) continue;
    near = yInterval[0]; far = yInterval[1];
    const zInterval = rayAxisInterval(origin[2], directionZ, mob.z - radius, mob.z + radius, near, far);
    if (!zInterval) continue;
    near = zInterval[0];
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
  if (!isNight || !Number.isFinite(nowSeconds)) return 0;
  const damageLimit = Number.isFinite(maximumDamage) ? Math.max(0, maximumDamage) : MAX_CONTACT_DAMAGE_PER_TICK;
  let damage = 0;
  for (let index = 0; index < simulation.mobs.length; index += 1) {
    const mob = simulation.mobs[index];
    if (!mob.alive || MOB_DEFINITIONS[mob.kind].contactDamage <= 0
      || nowSeconds + 1e-9 < mob.nextContactDamageAtSeconds) continue;
    const definition = MOB_DEFINITIONS[mob.kind];
    const horizontalReach = definition.collisionRadius + 0.32;
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
