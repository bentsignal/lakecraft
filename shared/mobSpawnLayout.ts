import type { MobAuthorityKind } from "./mobCombat.ts";

export const PASSIVE_MOB_HERD_SIZE = 3;

export interface DeterministicMobSpawn {
  id: string;
  kind: MobAuthorityKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  behaviorSeed: number;
}

export interface DeterministicMobSpawnOptions {
  seed: number;
  radius: number;
  centerX?: number;
  centerZ?: number;
  terrainHeight: (x: number, z: number) => number;
  resolveSpawnPosition?: (
    kind: MobAuthorityKind,
    x: number,
    surfaceY: number,
    z: number,
    attempt: number,
  ) => readonly [x: number, y: number, z: number] | null | undefined;
  isSpawnable?: (kind: MobAuthorityKind, x: number, y: number, z: number) => boolean;
  maxPopulation: number;
  passivePopulation: number;
  hostilePopulation: number;
  spawnClearRadius: number;
  hardMaxPopulation: number;
}

export function mobSpawnHashUint(x: number, z: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(z + seed, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function mobSpawnHash01(x: number, z: number, seed: number): number {
  return mobSpawnHashUint(x, z, seed) / 4_294_967_296;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));
const integer = (value: number, fallback: number): number => Number.isFinite(value) ? Math.floor(value) : fallback;
const passiveKind = (index: number, seed: number): MobAuthorityKind => {
  const choice = (index + mobSpawnHashUint(seed, 71, seed + 19) % 4) % 4;
  return choice === 0 ? "pig" : choice === 1 ? "cow" : choice === 2 ? "sheep" : "chicken";
};
const hostileKind = (index: number, seed: number): MobAuthorityKind => {
  const choice = (index + mobSpawnHashUint(seed, 113, seed + 29) % 4) % 4;
  return choice === 0 ? "zombie" : choice === 1 ? "skeleton" : choice === 2 ? "creeper" : "spider";
};

/** One deterministic ecology sampler shared by local play and Lakebed authority. */
export function createDeterministicMobSpawnLayout(
  options: Readonly<DeterministicMobSpawnOptions>,
): DeterministicMobSpawn[] {
  const hardMax = Math.max(0, integer(options.hardMaxPopulation, 0));
  const maxPopulation = clamp(integer(options.maxPopulation, 0), 0, hardMax);
  const passiveTarget = Math.max(0, integer(options.passivePopulation, 0));
  const hostileTarget = Math.max(0, integer(options.hostilePopulation, 0));
  const target = Math.min(maxPopulation, passiveTarget + hostileTarget);
  if (target === 0) return [];
  const passiveCount = Math.min(passiveTarget, Math.round(target * passiveTarget / (passiveTarget + hostileTarget)));
  const radius = Math.max(1, Math.abs(integer(options.radius, 1)));
  const centerX = integer(options.centerX ?? 0, 0);
  const centerZ = integer(options.centerZ ?? 0, 0);
  const clearRadius = clamp(integer(options.spawnClearRadius, 0), 0, radius - 1);
  const usableRange = Math.max(1, radius - clearRadius);
  const occupied = new Set<string>();
  const passiveHerdAnchors: Array<readonly [number, number] | undefined> = [];
  const spawns: DeterministicMobSpawn[] = [];
  const safeSlope = (x: number, z: number): boolean => {
    const center = options.terrainHeight(x, z);
    return Math.abs(options.terrainHeight(x + 1, z) - center) <= 1
      && Math.abs(options.terrainHeight(x - 1, z) - center) <= 1
      && Math.abs(options.terrainHeight(x, z + 1) - center) <= 1
      && Math.abs(options.terrainHeight(x, z - 1) - center) <= 1;
  };

  for (let attempt = 0, maximum = Math.max(96, target * 32);
    attempt < maximum && spawns.length < target; attempt += 1) {
    const slot = spawns.length;
    const herd = Math.floor(slot / PASSIVE_MOB_HERD_SIZE);
    const kind = slot < passiveCount ? passiveKind(herd, options.seed) : hostileKind(slot - passiveCount, options.seed);
    const angle = mobSpawnHash01(attempt, slot, options.seed + 101) * Math.PI * 2;
    const distance = clearRadius + 1
      + Math.sqrt(mobSpawnHash01(slot, attempt, options.seed + 131)) * (usableRange - 1);
    const anchor = slot < passiveCount ? passiveHerdAnchors[herd] : undefined;
    const herdDistance = 1 + mobSpawnHash01(attempt, slot, options.seed + 157) * 2;
    const candidateX = anchor
      ? anchor[0] + Math.round(Math.cos(angle) * herdDistance)
      : centerX + clamp(Math.round(Math.cos(angle) * distance), -radius, radius);
    const candidateZ = anchor
      ? anchor[1] + Math.round(Math.sin(angle) * herdDistance)
      : centerZ + clamp(Math.round(Math.sin(angle) * distance), -radius, radius);
    const distanceFromCenter = Math.max(Math.abs(candidateX - centerX), Math.abs(candidateZ - centerZ));
    if (distanceFromCenter <= clearRadius || distanceFromCenter > radius || !safeSlope(candidateX, candidateZ)) continue;
    const surfaceY = options.terrainHeight(candidateX, candidateZ) + 1;
    const resolved = options.resolveSpawnPosition?.(kind, candidateX, surfaceY, candidateZ, attempt);
    const x = Math.floor(resolved?.[0] ?? candidateX);
    const y = Math.floor(resolved?.[1] ?? surfaceY);
    const z = Math.floor(resolved?.[2] ?? candidateZ);
    if (![x, y, z].every(Number.isFinite)) continue;
    const resolvedDistance = Math.max(Math.abs(x - centerX), Math.abs(z - centerZ));
    const key = `${x},${z}`;
    if (resolvedDistance <= clearRadius || resolvedDistance > radius || occupied.has(key)
      || options.isSpawnable?.(kind, x, y, z) === false) continue;
    spawns.push({
      id: `${kind}-${(options.seed >>> 0).toString(36)}-${slot.toString(36)}`,
      kind,
      x,
      y,
      z,
      yaw: mobSpawnHash01(x, z, options.seed + 211) * Math.PI * 2 - Math.PI,
      behaviorSeed: mobSpawnHashUint(x, z, options.seed + slot * 97 + 401) || 0x6d2b79f5,
    });
    if (slot < passiveCount && !anchor) passiveHerdAnchors[herd] = [x, z];
    occupied.add(key);
  }
  return spawns;
}
