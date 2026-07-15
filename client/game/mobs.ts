import type { MobAuthorityState } from "../../shared/mobCombat.ts";
import {
  CREEPER_FUSE_CANCEL_RANGE_BLOCKS,
  CREEPER_FUSE_START_RANGE_BLOCKS,
  CREEPER_FUSE_TICKS,
  CREEPER_FUSE_VERTICAL_RANGE_BLOCKS,
  MOB_MOTION_TICKS_PER_SECOND,
} from "../../shared/mobMotionAuthority.ts";

export type MobKind = "pig" | "cow" | "sheep" | "zombie" | "skeleton" | "creeper";
export type MobBehavior = "dormant" | "idle" | "wander" | "chase" | "fuse";
export type MobDropId = "pork" | "beef" | "leather" | "wool" | "mutton" | "rotten_flesh" | "stick" | "string" | "arrow";

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
    targetRadius: 0.62,
    height: 0.9,
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
    targetRadius: 0.7,
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
    targetRadius: 0.68,
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
      { itemId: "string", minCount: 0, maxCount: 2, chance: 0.65 },
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
    // Gunpowder joins the item registry with authoritative explosions; an
    // ordinary melee kill cannot currently mint an unknown inventory item.
    drops: Object.freeze([]),
  }),
});

export const DEFAULT_MAX_MOB_POPULATION = 24;
export const HARD_MAX_MOB_POPULATION = 64;
export const MAX_MOB_PROJECTILES = 24;
export const MOB_PROJECTILE_LIFETIME_SECONDS = 3;
export const MOB_PROJECTILE_GRAVITY = 2.4;

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

export interface MobStepInput {
  dtSeconds: number;
  isNight: boolean;
  terrainHeight: (x: number, z: number) => number;
  player?: Readonly<MobTarget> | null;
  /** Return false when a mob's body would overlap a solid block or entity. */
  canOccupy?: (kind: MobKind, x: number, y: number, z: number, radius: number, height: number) => boolean;
  /** Called for arrow world collision; movement and attacks remain client-only. */
  isProjectileBlocked?: (x: number, y: number, z: number) => boolean;
  worldRadius?: number;
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
  /** Stable 0..1 priming state; 1 means an authority explosion may be due. */
  fuseProgress: number;
}

export interface MobDrop {
  itemId: MobDropId;
  count: number;
}

export interface MobDamageResult {
  found: boolean;
  killed: boolean;
  remainingHealth: number;
  drops: MobDrop[];
}

/** Minimal client view of the bounded state returned by shared mob-combat queries. */
export type MobCombatStateSnapshot = Pick<
  MobAuthorityState,
  "mobId" | "kind" | "health" | "maxHealth" | "revision" | "deadUntil"
>;

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
  const offset = hashUint(seed, 71, seed + 19) % 3;
  const choice = (index + offset) % 3;
  return choice === 0 ? "pig" : choice === 1 ? "cow" : "sheep";
}

function hostileKind(index: number, seed: number): MobKind {
  const choice = (index + hashUint(seed, 113, seed + 29) % 3) % 3;
  return choice === 0 ? "zombie" : choice === 1 ? "skeleton" : "creeper";
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
    const x = Math.max(-radius, Math.min(radius, Math.round(Math.cos(angle) * distance)));
    const z = Math.max(-radius, Math.min(radius, Math.round(Math.sin(angle) * distance)));
    if (Math.max(Math.abs(x), Math.abs(z)) <= clearRadius) continue;
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

export function createMobSimulation(spawns: readonly MobSpawnDescriptor[]): MobSimulation {
  const count = Math.min(HARD_MAX_MOB_POPULATION, spawns.length);
  const mobs = new Array<MobState>(count);
  for (let index = 0; index < count; index += 1) {
    const spawn = spawns[index];
    mobs[index] = {
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
      fuseStartedAtSeconds: 0,
      fuseUntilSeconds: 0,
    };
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
  if (Math.abs(x) + definition.collisionRadius > limit || Math.abs(z) + definition.collisionRadius > limit) return false;
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
      simulation.pendingProjectileDamage = Math.min(12, simulation.pendingProjectileDamage + projectile.damage);
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
    if (!mob.alive) continue;
    const definition = MOB_DEFINITIONS[mob.kind];
    mob.previousX = mob.x;
    mob.previousY = mob.y;
    mob.previousZ = mob.z;
    mob.previousYaw = mob.yaw;
    mob.hostileActive = !definition.passive && input.isNight;

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

    if (!definition.passive && !input.isNight) {
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
      if (distanceSquared <= 16 * 16) {
        const distance = Math.sqrt(distanceSquared);
        const inverseDistance = distance > 0.0001 ? 1 / distance : 0;
        if (mob.kind === "creeper") {
          const verticalDistance = Math.abs(input.player.y - mob.y);
          const fuseActive = mob.fuseStartedAtSeconds > 0 && mob.fuseUntilSeconds > mob.fuseStartedAtSeconds;
          if (fuseActive && (distance > CREEPER_FUSE_CANCEL_RANGE_BLOCKS
            || verticalDistance > CREEPER_FUSE_VERTICAL_RANGE_BLOCKS)) {
            mob.fuseStartedAtSeconds = 0;
            mob.fuseUntilSeconds = 0;
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

function rollDrops(mob: MobState): MobDrop[] {
  const definitions = MOB_DEFINITIONS[mob.kind].drops;
  const drops: MobDrop[] = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const drop = definitions[index];
    const chance = hash01(mob.behaviorSeed, mob.damageSequence + index, 811);
    if (chance > drop.chance) continue;
    const range = drop.maxCount - drop.minCount + 1;
    const count = drop.minCount + Math.floor(hash01(mob.behaviorSeed, mob.damageSequence + index, 829) * range);
    if (count > 0) drops.push({ itemId: drop.itemId, count });
  }
  return drops;
}

export function damageMob(simulation: MobSimulation, id: string, rawDamage: number): MobDamageResult {
  const mob = simulation.mobs.find((candidate) => candidate.id === id);
  if (!mob || !mob.alive) return { found: Boolean(mob), killed: false, remainingHealth: 0, drops: [] };
  const damage = Number.isFinite(rawDamage) ? Math.max(0, rawDamage) : 0;
  if (damage === 0) return { found: true, killed: false, remainingHealth: mob.health, drops: [] };
  mob.damageSequence += 1;
  mob.health = Math.max(0, mob.health - damage);
  if (mob.health > 0) return { found: true, killed: false, remainingHealth: mob.health, drops: [] };
  mob.alive = false;
  return { found: true, killed: true, remainingHealth: 0, drops: rollDrops(mob) };
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
  mob.nextContactDamageAtSeconds = 0;
  mob.nextRangedAttackAtSeconds = Math.max(0, elapsedSeconds) + 0.65 + (mob.behaviorSeed % 1_000) / 1_000;
  mob.rangedSequence = 0;
  mob.fuseStartedAtSeconds = 0;
  mob.fuseUntilSeconds = 0;
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
 * Consumes cooldown-ready zombie contact hits and returns bounded aggregate damage.
 * The mutation is local simulation state only; this alpha combat is not authoritative
 * or synchronized through Lakebed.
 */
export function consumeMobContactDamage(
  simulation: MobSimulation,
  player: Readonly<MobTarget>,
  nowSeconds: number,
  isNight: boolean,
  maximumDamage = MAX_CONTACT_DAMAGE_PER_TICK,
): number {
  if (!isNight || !Number.isFinite(nowSeconds)) return 0;
  const damageLimit = Number.isFinite(maximumDamage) ? Math.max(0, maximumDamage) : MAX_CONTACT_DAMAGE_PER_TICK;
  let damage = 0;
  for (let index = 0; index < simulation.mobs.length; index += 1) {
    const mob = simulation.mobs[index];
    if (!mob.alive || mob.kind !== "zombie" || nowSeconds + 1e-9 < mob.nextContactDamageAtSeconds) continue;
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
    mob.nextContactDamageAtSeconds = nowSeconds + definition.attackCooldownSeconds;
  }
  return damage;
}
