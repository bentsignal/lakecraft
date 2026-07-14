export type MobKind = "pig" | "cow" | "sheep" | "zombie";
export type MobBehavior = "dormant" | "idle" | "wander" | "chase";
export type MobDropId = "pork" | "beef" | "leather" | "wool" | "mutton" | "rotten_flesh";

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
  height: number;
  contactDamage: number;
  attackCooldownSeconds: number;
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
    height: 0.9,
    contactDamage: 0,
    attackCooldownSeconds: 0,
    drops: Object.freeze([{ itemId: "pork", minCount: 1, maxCount: 3, chance: 1 }]),
  }),
  cow: Object.freeze({
    kind: "cow",
    passive: true,
    maxHealth: 10,
    moveSpeed: 1,
    chaseSpeed: 1,
    collisionRadius: 0.48,
    height: 1.35,
    contactDamage: 0,
    attackCooldownSeconds: 0,
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
    height: 1.25,
    contactDamage: 0,
    attackCooldownSeconds: 0,
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
    height: 1.8,
    contactDamage: 3,
    attackCooldownSeconds: 1,
    drops: Object.freeze([{ itemId: "rotten_flesh", minCount: 0, maxCount: 2, chance: 0.85 }]),
  }),
});

export const DEFAULT_MAX_MOB_POPULATION = 24;
export const HARD_MAX_MOB_POPULATION = 64;

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
}

export interface MobSimulation {
  elapsedSeconds: number;
  tick: number;
  mobs: MobState[];
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
    const kind = slot < passiveCount ? passiveKind(slot, options.seed) : "zombie";
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
      previousX: spawn.x,
      previousY: spawn.y,
      previousZ: spawn.z,
      previousYaw: spawn.yaw,
      health: MOB_DEFINITIONS[spawn.kind].maxHealth,
      alive: true,
      behavior: spawn.kind === "zombie" ? "dormant" : "idle",
      behaviorUntilSeconds: 0,
      directionX: 0,
      directionZ: 0,
      desiredX: spawn.x,
      desiredZ: spawn.z,
      hostileActive: false,
      randomState: spawn.behaviorSeed || 0x6d2b79f5,
      damageSequence: 0,
    };
  }
  return { elapsedSeconds: 0, tick: 0, mobs };
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

    if (!definition.passive && !input.isNight) {
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
      if (distanceSquared <= 16 * 16 && distanceSquared > 0.0001) {
        const inverseDistance = 1 / Math.sqrt(distanceSquared);
        mob.directionX = playerDx * inverseDistance;
        mob.directionZ = playerDz * inverseDistance;
        mob.behavior = "chase";
        mob.behaviorUntilSeconds = simulation.elapsedSeconds + 0.25;
        speed = definition.chaseSpeed;
        chasing = true;
      }
    }

    if (mob.behavior === "chase" && !chasing) {
      mob.behavior = "idle";
      mob.behaviorUntilSeconds = simulation.elapsedSeconds;
    }

    if (mob.behavior !== "chase" && simulation.elapsedSeconds >= mob.behaviorUntilSeconds) {
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
    output[outputIndex] = snapshot;
    outputIndex += 1;
  }
  output.length = outputIndex;
  return output;
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
