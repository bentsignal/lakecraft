/**
 * Dependency-free copy of the client's deterministic surface height authority.
 * Keep the sampled parity test in `tests/world.test.ts` green whenever terrain
 * generation changes; the standalone Railway image cannot import Lakebed code.
 */

export const WORLD_TERRAIN_SEED = 7319;
export const PLAYER_GRAVITY = 22;
export const PLAYER_JUMP_SPEED = 8.25;
export const CREATIVE_FLIGHT_SPEED = 7;
export const CREATIVE_FLIGHT_SPRINT_SPEED = CREATIVE_FLIGHT_SPEED * 1.6;
export const MAX_PLAYER_Y = 192;
export const MAX_PLAYER_XZ = 1_000_000;

const MIN_TERRAIN_HEIGHT = 63;
const MAX_TERRAIN_HEIGHT = 80;
const SPAWN_HEIGHT = 68;
const SPAWN_PLATEAU_RADIUS = 3;
const SPAWN_BLEND_RADIUS = 9;
const PLAYER_HALF_WIDTH = 0.29;
export const PLAYER_FEET_CLEARANCE = 1.02;

function hash2(x: number, z: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(z + seed, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function valueNoise(x: number, z: number, seed: number, cellSize: number): number {
  const cellX = Math.floor(x / cellSize);
  const cellZ = Math.floor(z / cellSize);
  const localX = smoothstep(x / cellSize - cellX);
  const localZ = smoothstep(z / cellSize - cellZ);
  const north = lerp(hash2(cellX, cellZ, seed), hash2(cellX + 1, cellZ, seed), localX);
  const south = lerp(hash2(cellX, cellZ + 1, seed), hash2(cellX + 1, cellZ + 1, seed), localX);
  return lerp(north, south, localZ);
}

function rawTerrainHeight(x: number, z: number, seed: number): number {
  const broadHills = (valueNoise(x, z, seed + 17, 34) - 0.5) * 5.8;
  const rollingGround = (valueNoise(x, z, seed + 113, 13) - 0.5) * 3.0;
  const ridgeNoise = valueNoise(x, z, seed + 241, 22);
  const ridge = Math.max(0, 1 - Math.abs(ridgeNoise * 2 - 1) - 0.46);
  const ridgeLift = ridge * ridge * 10.5;
  const smallVariation = (valueNoise(x, z, seed + 307, 5) - 0.5) * 1.0;
  return 68.9 + broadHills + rollingGround + ridgeLift + smallVariation;
}

/** Exact surface height used by the browser terrain generator. */
export function terrainHeight(x: number, z: number, seed = WORLD_TERRAIN_SEED): number {
  const naturalHeight = rawTerrainHeight(x, z, seed);
  const spawnDistance = Math.max(Math.abs(x), Math.abs(z));
  const spawnBlend = Math.max(
    0,
    Math.min(1, (spawnDistance - SPAWN_PLATEAU_RADIUS) / (SPAWN_BLEND_RADIUS - SPAWN_PLATEAU_RADIUS)),
  );
  const height = lerp(SPAWN_HEIGHT, naturalHeight, smoothstep(spawnBlend));
  return Math.max(MIN_TERRAIN_HEIGHT, Math.min(MAX_TERRAIN_HEIGHT, Math.round(height)));
}

/**
 * Highest deterministic surface touched by the player's 0.58-block footprint.
 * Using the same footprint as the browser prevents the server from walking
 * through a step while the client is blocked against it.
 */
export function terrainFeetY(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return SPAWN_HEIGHT + PLAYER_FEET_CLEARANCE;
  const minX = Math.floor(x - PLAYER_HALF_WIDTH);
  const maxX = Math.floor(x + PLAYER_HALF_WIDTH);
  const minZ = Math.floor(z - PLAYER_HALF_WIDTH);
  const maxZ = Math.floor(z + PLAYER_HALF_WIDTH);
  let highest = MIN_TERRAIN_HEIGHT;
  for (let blockX = minX; blockX <= maxX; blockX += 1) {
    for (let blockZ = minZ; blockZ <= maxZ; blockZ += 1) {
      highest = Math.max(highest, terrainHeight(blockX, blockZ));
    }
  }
  return highest + PLAYER_FEET_CLEARANCE;
}
