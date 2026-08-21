import { BLOCK, type BlockId, type BlockTarget } from "./types.ts";
import { WORLD_CHUNK_SIZE, chunkBounds } from "./chunks.ts";
import { blockCollisionHeight, blockContainsSolidPoint } from "./blockGeometry.ts";
import {
  SUPERFLAT_BEDROCK_Y,
  SUPERFLAT_DIRT_LAYERS,
  type WorldTerrainDescriptor,
} from "../../shared/worldPreset.ts";

export const blockKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

interface TerrainRegion {
  minX: number;
  maxX: number;
  minY: number;
  minZ: number;
  maxZ: number;
}

export interface TerrainRegionOptions {
  /** Inclusive natural floor. The canonical world begins with bedrock at y=1. */
  minimumY?: number;
  terrain?: WorldTerrainDescriptor;
}

/** Deep enough for tiered ore progression while remaining compact per chunk. */
export const TERRAIN_MIN_Y = 1;
export const MAX_TERRAIN_REGION_COLUMNS = 16_384;

const MIN_TERRAIN_HEIGHT = 57;
const MAX_TERRAIN_HEIGHT = 90;
export const TERRAIN_SEA_LEVEL = 65;
const SPAWN_HEIGHT = 68;
const SPAWN_PLATEAU_RADIUS = 3;
const SPAWN_BLEND_RADIUS = 9;
const TREE_CELL_SIZE = 7;
const TREE_MARGIN = 2;
const ORE_CELL_SIZE = 4;
const CAVE_CELL_SIZE = 10;
const CAVE_TUNNEL_RADIUS = 1.3;
const CAVE_CHAMBER_RADIUS = 2.15;
const CAVE_SAMPLE_SPACING = 0.75;
export const CAVE_SPAWN_SANCTUARY_RADIUS = 10;
export const SAND_SPAWN_SANCTUARY_RADIUS = 10;
const SAND_PATCH_CELL_SIZE = 14;
const SAND_PATCH_CHANCE = 0.38;
const GRAVEL_CELL_SIZE_XZ = 8;
const GRAVEL_CELL_SIZE_Y = 6;
const GRAVEL_POCKET_CHANCE = 0.34;
export const CLAY_SPAWN_SANCTUARY_RADIUS = 10;
const CLAY_PATCH_CELL_SIZE = 18;
const CLAY_PATCH_CHANCE = 0.25;
const CLAY_PATCH_MAX_RADIUS = 3.8;

interface OreVeinConfig {
  block: BlockId;
  minimumY: number;
  maximumY: number;
  chance: number;
  salt: number;
}

interface CaveNode {
  x: number;
  y: number;
  z: number;
}

interface CaveCarveMask {
  region: TerrainRegion;
  minY: number;
  maxY: number;
  depth: number;
  columnCount: number;
  marked: Uint8Array;
  indices: number[];
}

interface OreCellCache {
  minCellX: number;
  minCellY: number;
  minCellZ: number;
  cellCountY: number;
  cellCountZ: number;
  cellsPerOre: number;
  /** 0 = unknown, 1 = inactive, 2 = active. */
  state: Uint8Array;
  anchorX: Uint8Array;
  anchorY: Uint8Array;
  anchorZ: Uint8Array;
}

interface GravelCellCache {
  minCellX: number;
  minCellY: number;
  minCellZ: number;
  cellCountY: number;
  cellCountZ: number;
  /** 0 = unknown, 1 = inactive, 2 = active. */
  state: Uint8Array;
  centerX: Float64Array;
  centerY: Float64Array;
  centerZ: Float64Array;
  radiusX: Float64Array;
  radiusY: Float64Array;
  radiusZ: Float64Array;
}

interface ClayColumnCache {
  minX: number;
  minZ: number;
  depth: number;
  values: Uint8Array;
}

// One compact Manhattan-radius-one deposit may occupy each 4x4x4 cell. The
// cell-local shape strictly caps a vein at seven blocks while global cell
// coordinates keep ore identical no matter which terrain region generated it.
const ORE_VEINS: readonly OreVeinConfig[] = [
  // Rarest/highest-tier deposits go first so overlap resolution always favors
  // the progression-gating ore. Every vein remains capped at seven blocks.
  { block: BLOCK.DIAMOND_ORE, minimumY: 2, maximumY: 10, chance: 0.075, salt: 3_421 },
  { block: BLOCK.GOLD_ORE, minimumY: 2, maximumY: 32, chance: 0.11, salt: 2_863 },
  { block: BLOCK.IRON_ORE, minimumY: 2, maximumY: 56, chance: 0.17, salt: 2_137 },
  { block: BLOCK.COAL_ORE, minimumY: 12, maximumY: 66, chance: 0.43, salt: 1_619 },
];

function hash2(x: number, z: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(z + seed, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b)
    ^ Math.imul(y + seed, 0x27d4eb2d)
    ^ Math.imul(z - seed, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** Smooth deterministic noise sampled from an integer lattice. */
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
  // Squared ridges create occasional stepped high ground without adding a
  // biome system or breaking the globally anchored, chunk-seam-safe height map.
  const ridge = Math.max(0, 1 - Math.abs(ridgeNoise * 2 - 1) - 0.46);
  const ridgeLift = ridge * ridge * 10.5;
  const smallVariation = (valueNoise(x, z, seed + 307, 5) - 0.5) * 1.0;
  return 68.9 + broadHills + rollingGround + ridgeLift + smallVariation;
}

function biomeTerrainHeight(x: number, z: number, seed: number): number {
  const broad = (valueNoise(x, z, seed + 17, 42) - 0.5) * 9;
  const rolling = (valueNoise(x, z, seed + 113, 14) - 0.5) * 4;
  const ridge = Math.max(0, valueNoise(x, z, seed + 241, 30) - 0.58);
  const basin = Math.max(0, 0.46 - valueNoise(x, z, seed + 1_003, 38));
  return 66.5 + broad + rolling + ridge * ridge * 105 - basin * 28;
}

export type TerrainBiome = "plains" | "desert" | "birch_forest" | "taiga" | "jungle" | "savanna" | "dark_forest";

export function treeBlocksForBiome(biome: TerrainBiome): readonly [BlockId, BlockId] {
  return biome === "taiga" ? [BLOCK.SPRUCE_LOG, BLOCK.SPRUCE_LEAVES]
    : biome === "birch_forest" ? [BLOCK.BIRCH_LOG, BLOCK.BIRCH_LEAVES]
      : biome === "jungle" ? [BLOCK.JUNGLE_LOG, BLOCK.JUNGLE_LEAVES]
        : biome === "savanna" ? [BLOCK.ACACIA_LOG, BLOCK.ACACIA_LEAVES]
          : biome === "dark_forest" ? [BLOCK.DARK_OAK_LOG, BLOCK.DARK_OAK_LEAVES]
            : [BLOCK.WOOD, BLOCK.LEAVES];
}

function usesBiomeGeneration(terrain?: WorldTerrainDescriptor): boolean {
  return terrain?.generatorVersion === 3 || terrain?.generatorVersion === 4;
}

export function terrainBiome(
  x: number, z: number, seed: number, terrain?: WorldTerrainDescriptor,
): TerrainBiome {
  if (!usesBiomeGeneration(terrain) || Math.max(Math.abs(x), Math.abs(z)) <= SAND_SPAWN_SANCTUARY_RADIUS) {
    return "plains";
  }
  if (terrain?.generatorVersion === 3) {
    return valueNoise(x, z, seed + 6_019, 72) > 0.58 ? "desert" : "plains";
  }
  const climate = valueNoise(x, z, seed + 6_019, 64);
  const forest = valueNoise(x, z, seed + 6_071, 52);
  if (climate > 0.69) return "desert";
  if (climate > 0.59) return "savanna";
  if (climate < 0.31) return "taiga";
  if (climate < 0.41) return "birch_forest";
  if (forest > 0.63) return "jungle";
  if (forest < 0.37) return "dark_forest";
  return "plains";
}

export function terrainHeight(x: number, z: number, seed: number, terrain?: WorldTerrainDescriptor): number {
  if (terrain?.preset === "superflat") return terrain.superflatGroundY;
  const modern = usesBiomeGeneration(terrain);
  const naturalHeight = modern ? biomeTerrainHeight(x, z, seed) : rawTerrainHeight(x, z, seed);
  const spawnDistance = Math.max(Math.abs(x), Math.abs(z));
  const spawnBlend = Math.max(
    0,
    Math.min(1, (spawnDistance - SPAWN_PLATEAU_RADIUS) / (SPAWN_BLEND_RADIUS - SPAWN_PLATEAU_RADIUS)),
  );
  const height = lerp(SPAWN_HEIGHT, naturalHeight, smoothstep(spawnBlend));
  return Math.max(modern ? MIN_TERRAIN_HEIGHT : 63, Math.min(modern ? MAX_TERRAIN_HEIGHT : 80, Math.round(height)));
}

/**
 * Returns the globally anchored sand depth for a surface column. Patches are
 * clipped out of the spawn sanctuary and never alter the column's height.
 */
export function terrainSandDepth(x: number, z: number, seed: number, terrain?: WorldTerrainDescriptor): 0 | 2 | 3 {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(seed)) return 0;
  const blockX = Math.floor(x);
  const blockZ = Math.floor(z);
  if (Math.max(Math.abs(blockX), Math.abs(blockZ)) <= SAND_SPAWN_SANCTUARY_RADIUS) return 0;
  if (usesBiomeGeneration(terrain)) {
    if (terrainBiome(blockX, blockZ, seed, terrain) === "desert") return 3;
    return terrainHeight(blockX, blockZ, seed, terrain) <= TERRAIN_SEA_LEVEL + 1 ? 2 : 0;
  }
  const ownerCellX = Math.floor(blockX / SAND_PATCH_CELL_SIZE);
  const ownerCellZ = Math.floor(blockZ / SAND_PATCH_CELL_SIZE);
  for (let cellX = ownerCellX - 1; cellX <= ownerCellX + 1; cellX += 1) {
    for (let cellZ = ownerCellZ - 1; cellZ <= ownerCellZ + 1; cellZ += 1) {
      if (hash2(cellX, cellZ, seed + 4_019) >= SAND_PATCH_CHANCE) continue;
      const centerX = cellX * SAND_PATCH_CELL_SIZE
        + Math.floor(hash2(cellX, cellZ, seed + 4_037) * SAND_PATCH_CELL_SIZE);
      const centerZ = cellZ * SAND_PATCH_CELL_SIZE
        + Math.floor(hash2(cellX, cellZ, seed + 4_069) * SAND_PATCH_CELL_SIZE);
      const radius = 2.25 + hash2(cellX, cellZ, seed + 4_091) * 2;
      const dx = blockX + 0.5 - (centerX + 0.5);
      const dz = blockZ + 0.5 - (centerZ + 0.5);
      if (dx * dx + dz * dz <= radius * radius) {
        return hash2(blockX, blockZ, seed + 4_123) < 0.24 ? 3 : 2;
      }
    }
  }
  return 0;
}

/** The natural strata, including surface deposits, before deterministic ore replacement. */
export function terrainBaseBlock(
  x: number, y: number, z: number, seed: number, terrain?: WorldTerrainDescriptor,
): BlockId {
  const top = terrainHeight(x, z, seed, terrain);
  if (y < TERRAIN_MIN_Y) return BLOCK.AIR;
  if (y > top) return usesBiomeGeneration(terrain) && y <= TERRAIN_SEA_LEVEL ? BLOCK.WATER : BLOCK.AIR;
  if (y === TERRAIN_MIN_Y) return BLOCK.BEDROCK;
  const sandDepth = terrainSandDepth(x, z, seed, terrain);
  if (sandDepth > 0 && y > top - sandDepth) return BLOCK.SAND;
  const dirtDepth = Math.min(top - 1, hash2(x, z, seed + 401) > 0.62 ? 3 : 2);
  return y === top ? BLOCK.GRASS : y >= top - dirtDepth ? BLOCK.DIRT : BLOCK.STONE;
}

/**
 * Globally anchored underground gravel pockets. The owning 8x6x8 lattice cell
 * bounds every pocket, so separately generated chunks agree at their seams.
 */
export function terrainGravelBlock(x: number, y: number, z: number, seed: number): BlockId | null {
  if (terrainBaseBlock(x, y, z, seed) !== BLOCK.STONE) return null;
  return gravelBlockAtKnownStone(x, y, z, seed);
}

/**
 * Returns a bounded, globally anchored shallow clay lens depth for a column.
 * The surface grass stays intact; clay occupies two blocks around the rim and
 * three near the center. Looking in adjacent owner cells allows one deposit to
 * cross any independently generated terrain/chunk seam without disagreement.
 */
export function terrainClayDepth(x: number, z: number, seed: number): 0 | 2 | 3 {
  if (![x, z, seed].every(Number.isFinite)) return 0;
  const blockX = Math.floor(x);
  const blockZ = Math.floor(z);
  if (Math.max(Math.abs(blockX), Math.abs(blockZ)) <= CLAY_SPAWN_SANCTUARY_RADIUS) return 0;
  const minCellX = Math.floor((blockX + 0.5 - CLAY_PATCH_MAX_RADIUS) / CLAY_PATCH_CELL_SIZE);
  const maxCellX = Math.floor((blockX + 0.5 + CLAY_PATCH_MAX_RADIUS) / CLAY_PATCH_CELL_SIZE);
  const minCellZ = Math.floor((blockZ + 0.5 - CLAY_PATCH_MAX_RADIUS) / CLAY_PATCH_CELL_SIZE);
  const maxCellZ = Math.floor((blockZ + 0.5 + CLAY_PATCH_MAX_RADIUS) / CLAY_PATCH_CELL_SIZE);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      if (hash2(cellX, cellZ, seed + 5_219) >= CLAY_PATCH_CHANCE) continue;
      const centerX = cellX * CLAY_PATCH_CELL_SIZE
        + hash2(cellX, cellZ, seed + 5_231) * CLAY_PATCH_CELL_SIZE;
      const centerZ = cellZ * CLAY_PATCH_CELL_SIZE
        + hash2(cellX, cellZ, seed + 5_253) * CLAY_PATCH_CELL_SIZE;
      const radiusX = 2.35 + hash2(cellX, cellZ, seed + 5_277) * 1.45;
      const radiusZ = 2.35 + hash2(cellX, cellZ, seed + 5_303) * 1.45;
      const dx = (blockX + 0.5 - centerX) / radiusX;
      const dz = (blockZ + 0.5 - centerZ) / radiusZ;
      const distance = dx * dx + dz * dz;
      if (distance <= 1) return distance <= 0.5 ? 3 : 2;
    }
  }
  return 0;
}

/**
 * Rasterize the few active clay ellipses that can touch a generated region.
 * Public single-column probes retain the reference implementation above;
 * bulk generation avoids re-hashing the same owner cell for every column.
 * Iterating owner cells in the same x-then-z order and only writing empty
 * columns preserves the reference function's first-overlapping-lens result.
 */
function createClayColumnCache(region: TerrainRegion, seed: number): ClayColumnCache {
  const depth = region.maxZ - region.minZ + 1;
  const values = new Uint8Array((region.maxX - region.minX + 1) * depth);
  const minCellX = Math.floor((region.minX + 0.5 - CLAY_PATCH_MAX_RADIUS) / CLAY_PATCH_CELL_SIZE);
  const maxCellX = Math.floor((region.maxX + 0.5 + CLAY_PATCH_MAX_RADIUS) / CLAY_PATCH_CELL_SIZE);
  const minCellZ = Math.floor((region.minZ + 0.5 - CLAY_PATCH_MAX_RADIUS) / CLAY_PATCH_CELL_SIZE);
  const maxCellZ = Math.floor((region.maxZ + 0.5 + CLAY_PATCH_MAX_RADIUS) / CLAY_PATCH_CELL_SIZE);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      if (hash2(cellX, cellZ, seed + 5_219) >= CLAY_PATCH_CHANCE) continue;
      const centerX = cellX * CLAY_PATCH_CELL_SIZE
        + hash2(cellX, cellZ, seed + 5_231) * CLAY_PATCH_CELL_SIZE;
      const centerZ = cellZ * CLAY_PATCH_CELL_SIZE
        + hash2(cellX, cellZ, seed + 5_253) * CLAY_PATCH_CELL_SIZE;
      const radiusX = 2.35 + hash2(cellX, cellZ, seed + 5_277) * 1.45;
      const radiusZ = 2.35 + hash2(cellX, cellZ, seed + 5_303) * 1.45;
      const minX = Math.max(region.minX, Math.ceil(centerX - radiusX - 0.5));
      const maxX = Math.min(region.maxX, Math.floor(centerX + radiusX - 0.5));
      const minZ = Math.max(region.minZ, Math.ceil(centerZ - radiusZ - 0.5));
      const maxZ = Math.min(region.maxZ, Math.floor(centerZ + radiusZ - 0.5));
      for (let blockX = minX; blockX <= maxX; blockX += 1) {
        const dx = (blockX + 0.5 - centerX) / radiusX;
        const dxSquared = dx * dx;
        const columnOffset = (blockX - region.minX) * depth - region.minZ;
        for (let blockZ = minZ; blockZ <= maxZ; blockZ += 1) {
          const index = columnOffset + blockZ;
          if (values[index] !== 0
            || Math.max(Math.abs(blockX), Math.abs(blockZ)) <= CLAY_SPAWN_SANCTUARY_RADIUS) continue;
          const dz = (blockZ + 0.5 - centerZ) / radiusZ;
          const distance = dxSquared + dz * dz;
          if (distance <= 1) values[index] = distance <= 0.5 ? 3 : 2;
        }
      }
    }
  }
  return { minX: region.minX, minZ: region.minZ, depth, values };
}

function cachedClayDepth(cache: ClayColumnCache, x: number, z: number): 0 | 2 | 3 {
  return cache.values[(x - cache.minX) * cache.depth + z - cache.minZ] as 0 | 2 | 3;
}

/** Clay replaces only unresolved dirt/stone strata, never sand, gravel, or ore. */
export function terrainClayBlock(x: number, y: number, z: number, seed: number): BlockId | null {
  if (![x, y, z, seed].every(Number.isFinite)
    || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return null;
  const top = terrainHeight(x, z, seed);
  const depth = terrainClayDepth(x, z, seed);
  if (depth === 0 || y >= top || y < top - depth) return null;
  const base = terrainBaseBlock(x, y, z, seed);
  if (base !== BLOCK.DIRT && base !== BLOCK.STONE) return null;
  if (base === BLOCK.STONE
    && (gravelBlockAtKnownStone(x, y, z, seed) || oreBlockAtKnownStone(x, y, z, seed))) return null;
  return BLOCK.CLAY;
}

/** Hot-path gravel probe for callers that already derived the natural stratum. */
function gravelBlockAtKnownStone(
  x: number,
  y: number,
  z: number,
  seed: number,
  cache?: GravelCellCache,
): BlockId | null {
  const cellX = Math.floor(x / GRAVEL_CELL_SIZE_XZ);
  const cellY = Math.floor(y / GRAVEL_CELL_SIZE_Y);
  const cellZ = Math.floor(z / GRAVEL_CELL_SIZE_XZ);
  let centerX: number;
  let centerY: number;
  let centerZ: number;
  let radiusX: number;
  let radiusY: number;
  let radiusZ: number;
  if (cache) {
    const index = ((cellX - cache.minCellX) * cache.cellCountY + cellY - cache.minCellY)
      * cache.cellCountZ + cellZ - cache.minCellZ;
    let state = cache.state[index];
    if (state === 0) {
      state = hash3(cellX, cellY, cellZ, seed + 4_789) >= GRAVEL_POCKET_CHANCE ? 1 : 2;
      cache.state[index] = state;
      if (state === 2) {
        cache.centerX[index] = 1.5 + hash3(cellX, cellY, cellZ, seed + 4_811) * (GRAVEL_CELL_SIZE_XZ - 3);
        cache.centerY[index] = 1 + hash3(cellX, cellY, cellZ, seed + 4_837) * (GRAVEL_CELL_SIZE_Y - 2);
        cache.centerZ[index] = 1.5 + hash3(cellX, cellY, cellZ, seed + 4_853) * (GRAVEL_CELL_SIZE_XZ - 3);
        cache.radiusX[index] = 1.35 + hash3(cellX, cellY, cellZ, seed + 4_879) * 0.9;
        cache.radiusY[index] = 0.8 + hash3(cellX, cellY, cellZ, seed + 4_903) * 0.65;
        cache.radiusZ[index] = 1.35 + hash3(cellX, cellY, cellZ, seed + 4_927) * 0.9;
      }
    }
    if (state === 1) return null;
    centerX = cache.centerX[index];
    centerY = cache.centerY[index];
    centerZ = cache.centerZ[index];
    radiusX = cache.radiusX[index];
    radiusY = cache.radiusY[index];
    radiusZ = cache.radiusZ[index];
  } else {
    if (hash3(cellX, cellY, cellZ, seed + 4_789) >= GRAVEL_POCKET_CHANCE) return null;
    centerX = 1.5 + hash3(cellX, cellY, cellZ, seed + 4_811) * (GRAVEL_CELL_SIZE_XZ - 3);
    centerY = 1 + hash3(cellX, cellY, cellZ, seed + 4_837) * (GRAVEL_CELL_SIZE_Y - 2);
    centerZ = 1.5 + hash3(cellX, cellY, cellZ, seed + 4_853) * (GRAVEL_CELL_SIZE_XZ - 3);
    radiusX = 1.35 + hash3(cellX, cellY, cellZ, seed + 4_879) * 0.9;
    radiusY = 0.8 + hash3(cellX, cellY, cellZ, seed + 4_903) * 0.65;
    radiusZ = 1.35 + hash3(cellX, cellY, cellZ, seed + 4_927) * 0.9;
  }
  const localX = x - cellX * GRAVEL_CELL_SIZE_XZ;
  const localY = y - cellY * GRAVEL_CELL_SIZE_Y;
  const localZ = z - cellZ * GRAVEL_CELL_SIZE_XZ;
  const distance = ((localX + 0.5 - centerX) / radiusX) ** 2
    + ((localY + 0.5 - centerY) / radiusY) ** 2
    + ((localZ + 0.5 - centerZ) / radiusZ) ** 2;
  return distance <= 1 ? BLOCK.GRAVEL : null;
}

function blockInOreVein(
  x: number,
  y: number,
  z: number,
  seed: number,
  config: OreVeinConfig,
  configIndex = -1,
  cache?: OreCellCache,
): boolean {
  if (y < config.minimumY || y > config.maximumY) return false;
  const cellX = Math.floor(x / ORE_CELL_SIZE);
  const cellY = Math.floor(y / ORE_CELL_SIZE);
  const cellZ = Math.floor(z / ORE_CELL_SIZE);
  let anchorX: number;
  let anchorY: number;
  let anchorZ: number;
  if (cache && configIndex >= 0) {
    const localCell = ((cellX - cache.minCellX) * cache.cellCountY + cellY - cache.minCellY)
      * cache.cellCountZ + cellZ - cache.minCellZ;
    const index = configIndex * cache.cellsPerOre + localCell;
    let state = cache.state[index];
    if (state === 0) {
      state = hash3(cellX, cellY, cellZ, seed + config.salt) >= config.chance ? 1 : 2;
      cache.state[index] = state;
      if (state === 2) {
        cache.anchorX[index] = Math.floor(hash3(cellX, cellY, cellZ, seed + config.salt + 11) * ORE_CELL_SIZE);
        cache.anchorY[index] = Math.floor(hash3(cellX, cellY, cellZ, seed + config.salt + 23) * ORE_CELL_SIZE);
        cache.anchorZ[index] = Math.floor(hash3(cellX, cellY, cellZ, seed + config.salt + 37) * ORE_CELL_SIZE);
      }
    }
    if (state === 1) return false;
    anchorX = cache.anchorX[index];
    anchorY = cache.anchorY[index];
    anchorZ = cache.anchorZ[index];
  } else {
    if (hash3(cellX, cellY, cellZ, seed + config.salt) >= config.chance) return false;
    anchorX = Math.floor(hash3(cellX, cellY, cellZ, seed + config.salt + 11) * ORE_CELL_SIZE);
    anchorY = Math.floor(hash3(cellX, cellY, cellZ, seed + config.salt + 23) * ORE_CELL_SIZE);
    anchorZ = Math.floor(hash3(cellX, cellY, cellZ, seed + config.salt + 37) * ORE_CELL_SIZE);
  }
  const localX = x - cellX * ORE_CELL_SIZE;
  const localY = y - cellY * ORE_CELL_SIZE;
  const localZ = z - cellZ * ORE_CELL_SIZE;
  return Math.abs(localX - anchorX) + Math.abs(localY - anchorY) + Math.abs(localZ - anchorZ) <= 1;
}

/** Higher-tier ores win rare overlaps; all deposits replace natural stone only. */
function oreBlockAtKnownStone(
  x: number,
  y: number,
  z: number,
  seed: number,
  cache?: OreCellCache,
): BlockId | null {
  for (let index = 0; index < ORE_VEINS.length; index += 1) {
    const config = ORE_VEINS[index];
    if (blockInOreVein(x, y, z, seed, config, index, cache)) return config.block;
  }
  return null;
}

export function terrainOreBlock(x: number, y: number, z: number, seed: number): BlockId | null {
  return terrainBaseBlock(x, y, z, seed) === BLOCK.STONE
    ? oreBlockAtKnownStone(x, y, z, seed)
    : null;
}

function isInside(region: TerrainRegion, x: number, z: number): boolean {
  return x >= region.minX && x <= region.maxX && z >= region.minZ && z <= region.maxZ;
}

function createOreCellCache(region: TerrainRegion): OreCellCache {
  const minCellX = Math.floor(region.minX / ORE_CELL_SIZE);
  const maxCellX = Math.floor(region.maxX / ORE_CELL_SIZE);
  const minCellY = Math.floor(region.minY / ORE_CELL_SIZE);
  const maxCellY = Math.floor(MAX_TERRAIN_HEIGHT / ORE_CELL_SIZE);
  const minCellZ = Math.floor(region.minZ / ORE_CELL_SIZE);
  const maxCellZ = Math.floor(region.maxZ / ORE_CELL_SIZE);
  const cellCountY = maxCellY - minCellY + 1;
  const cellCountZ = maxCellZ - minCellZ + 1;
  const cellsPerOre = (maxCellX - minCellX + 1) * cellCountY * cellCountZ;
  const totalCells = cellsPerOre * ORE_VEINS.length;
  return {
    minCellX,
    minCellY,
    minCellZ,
    cellCountY,
    cellCountZ,
    cellsPerOre,
    state: new Uint8Array(totalCells),
    anchorX: new Uint8Array(totalCells),
    anchorY: new Uint8Array(totalCells),
    anchorZ: new Uint8Array(totalCells),
  };
}

function createGravelCellCache(region: TerrainRegion): GravelCellCache {
  const minCellX = Math.floor(region.minX / GRAVEL_CELL_SIZE_XZ);
  const maxCellX = Math.floor(region.maxX / GRAVEL_CELL_SIZE_XZ);
  const minCellY = Math.floor(region.minY / GRAVEL_CELL_SIZE_Y);
  const maxCellY = Math.floor(MAX_TERRAIN_HEIGHT / GRAVEL_CELL_SIZE_Y);
  const minCellZ = Math.floor(region.minZ / GRAVEL_CELL_SIZE_XZ);
  const maxCellZ = Math.floor(region.maxZ / GRAVEL_CELL_SIZE_XZ);
  const cellCountY = maxCellY - minCellY + 1;
  const cellCountZ = maxCellZ - minCellZ + 1;
  const totalCells = (maxCellX - minCellX + 1) * cellCountY * cellCountZ;
  return {
    minCellX,
    minCellY,
    minCellZ,
    cellCountY,
    cellCountZ,
    state: new Uint8Array(totalCells),
    centerX: new Float64Array(totalCells),
    centerY: new Float64Array(totalCells),
    centerZ: new Float64Array(totalCells),
    radiusX: new Float64Array(totalCells),
    radiusY: new Float64Array(totalCells),
    radiusZ: new Float64Array(totalCells),
  };
}

function addGround(
  blocks: Map<string, BlockId>, region: TerrainRegion, seed: number, terrain?: WorldTerrainDescriptor,
): void {
  const oreCells = createOreCellCache(region);
  const gravelCells = createGravelCellCache(region);
  const clayColumns = createClayColumnCache(region, seed);
  for (let x = region.minX; x <= region.maxX; x += 1) {
    const xPrefix = `${x},`;
    for (let z = region.minZ; z <= region.maxZ; z += 1) {
      const zSuffix = `,${z}`;
      const top = terrainHeight(x, z, seed, terrain);
      const sandDepth = terrainSandDepth(x, z, seed, terrain);
      const clayDepth = cachedClayDepth(clayColumns, x, z);
      const dirtDepth = Math.min(top - 1, hash2(x, z, seed + 401) > 0.62 ? 3 : 2);
      const surface = usesBiomeGeneration(terrain) ? Math.max(top, TERRAIN_SEA_LEVEL) : top;
      for (let y = region.minY; y <= surface; y += 1) {
        const base = y > top
          ? BLOCK.WATER
          : y === TERRAIN_MIN_Y
          ? BLOCK.BEDROCK
          : sandDepth > 0 && y > top - sandDepth
          ? BLOCK.SAND
          : y === top
            ? BLOCK.GRASS
            : y >= top - dirtDepth
              ? BLOCK.DIRT
              : BLOCK.STONE;
        const resolvedStrata = base === BLOCK.STONE
          ? gravelBlockAtKnownStone(x, y, z, seed, gravelCells)
            ?? oreBlockAtKnownStone(x, y, z, seed, oreCells)
            ?? base
          : base;
        const block = clayDepth > 0
          && y < top
          && y >= top - clayDepth
          && (resolvedStrata === BLOCK.DIRT || resolvedStrata === BLOCK.STONE)
          ? BLOCK.CLAY
          : resolvedStrata;
        blocks.set(`${xPrefix}${y}${zSuffix}`, block);
      }
    }
  }
}

function addSuperflatGround(
  blocks: Map<string, BlockId>,
  region: TerrainRegion,
  groundY: number,
): void {
  for (let x = region.minX; x <= region.maxX; x += 1) {
    for (let z = region.minZ; z <= region.maxZ; z += 1) {
      for (let y = Math.max(region.minY, SUPERFLAT_BEDROCK_Y); y <= groundY; y += 1) {
        const block = y === SUPERFLAT_BEDROCK_Y
          ? BLOCK.BEDROCK
          : y === groundY
            ? BLOCK.GRASS
            : y >= groundY - SUPERFLAT_DIRT_LAYERS
              ? BLOCK.DIRT
              : BLOCK.STONE;
        blocks.set(`${x},${y},${z}`, block);
      }
    }
  }
}

function caveNode(cellX: number, cellZ: number, seed: number): CaveNode {
  return {
    // Nodes stay two blocks inside their owning cell. This bounds how far a
    // chamber can reach while leaving the connecting segments free to cross it.
    x: cellX * CAVE_CELL_SIZE + 2 + hash3(cellX, 0, cellZ, seed + 3_011) * 6,
    y: 5.45 + hash3(cellX, 1, cellZ, seed + 3_037) * 3.9,
    z: cellZ * CAVE_CELL_SIZE + 2 + hash3(cellX, 2, cellZ, seed + 3_071) * 6,
  };
}

function canCarveCaveBlock(block: BlockId | undefined): boolean {
  return block === BLOCK.STONE
    || block === BLOCK.CLAY
    || block === BLOCK.COAL_ORE
    || block === BLOCK.IRON_ORE
    || block === BLOCK.GOLD_ORE
    || block === BLOCK.DIAMOND_ORE;
}

/**
 * Cave tunnel samples overlap heavily. Keep their union in a region-bounded
 * numeric mask so each surviving terrain key is built and probed only once.
 */
function createCaveCarveMask(region: TerrainRegion): CaveCarveMask {
  const width = region.maxX - region.minX + 1;
  const depth = region.maxZ - region.minZ + 1;
  const minY = region.minY + 1;
  const maxY = MAX_TERRAIN_HEIGHT;
  const columnCount = width * depth;
  return {
    region,
    minY,
    maxY,
    depth,
    columnCount,
    marked: new Uint8Array(columnCount * Math.max(0, maxY - minY + 1)),
    indices: [],
  };
}

function markCaveBlock(mask: CaveCarveMask, x: number, y: number, z: number): void {
  const column = (x - mask.region.minX) * mask.depth + z - mask.region.minZ;
  const index = (y - mask.minY) * mask.columnCount + column;
  if (mask.marked[index] !== 0) return;
  mask.marked[index] = 1;
  mask.indices.push(index);
}

function applyCaveCarveMask(blocks: Map<string, BlockId>, mask: CaveCarveMask): void {
  for (const index of mask.indices) {
    const yOffset = Math.floor(index / mask.columnCount);
    const column = index - yOffset * mask.columnCount;
    const xOffset = Math.floor(column / mask.depth);
    const zOffset = column - xOffset * mask.depth;
    const key = blockKey(
      mask.region.minX + xOffset,
      mask.minY + yOffset,
      mask.region.minZ + zOffset,
    );
    if (canCarveCaveBlock(blocks.get(key))) blocks.delete(key);
  }
}

function carveCaveSphere(
  mask: CaveCarveMask,
  center: CaveNode,
  radius: number,
): void {
  const { region } = mask;
  const radiusSquared = radius * radius;
  const minX = Math.max(region.minX, Math.floor(center.x - radius));
  const maxX = Math.min(region.maxX, Math.floor(center.x + radius));
  const minY = Math.max(mask.minY, Math.floor(center.y - radius));
  const maxY = Math.min(mask.maxY, Math.floor(center.y + radius));
  const minZ = Math.max(region.minZ, Math.floor(center.z - radius));
  const maxZ = Math.min(region.maxZ, Math.floor(center.z + radius));
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      // The square sanctuary is slightly stronger than the requested circular
      // radius: every underground spawn block within ten on either axis stays solid.
      if (Math.max(Math.abs(x), Math.abs(z)) <= CAVE_SPAWN_SANCTUARY_RADIUS) continue;
      for (let y = minY; y <= maxY; y += 1) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;
        const dz = z + 0.5 - center.z;
        if (dx * dx + dy * dy + dz * dz > radiusSquared) continue;
        markCaveBlock(mask, x, y, z);
      }
    }
  }
}

function carveCaveTunnel(
  mask: CaveCarveMask,
  start: CaveNode,
  end: CaveNode,
): void {
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const steps = Math.max(1, Math.ceil(length / CAVE_SAMPLE_SPACING));
  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    carveCaveSphere(mask, {
      x: lerp(start.x, end.x, amount),
      y: lerp(start.y, end.y, amount),
      z: lerp(start.z, end.z, amount),
    }, CAVE_TUNNEL_RADIUS);
  }
}

function carveCaves(blocks: Map<string, BlockId>, region: TerrainRegion, seed: number): void {
  const carveMask = createCaveCarveMask(region);
  // Include one cell beyond each clipped region. It contains every chamber or
  // forward connection whose bounded radius can touch this region, ensuring an
  // independently generated half sees the same cross-boundary tunnel as a whole.
  const minCellX = Math.floor(region.minX / CAVE_CELL_SIZE) - 1;
  const maxCellX = Math.floor(region.maxX / CAVE_CELL_SIZE) + 1;
  const minCellZ = Math.floor(region.minZ / CAVE_CELL_SIZE) - 1;
  const maxCellZ = Math.floor(region.maxZ / CAVE_CELL_SIZE) + 1;
  // Globally anchored cave bands fill the deep stone while preserving the
  // bedrock layer and the shallow surface cap.
  for (let layer = 0; layer <= 7; layer += 1) {
    const layerOffset = layer * 8;
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        const shallowNode = caveNode(cellX, cellZ, seed + layer * 7_919);
        const node = { ...shallowNode, y: shallowNode.y + layerOffset };
        if (hash3(cellX, layer * 11 + 3, cellZ, seed + 3_101) < 0.32) {
          carveCaveSphere(carveMask, node, CAVE_CHAMBER_RADIUS);
        }
        if (hash3(cellX, layer * 11 + 4, cellZ, seed + 3_127) < 0.58) {
          const east = caveNode(cellX + 1, cellZ, seed + layer * 7_919);
          carveCaveTunnel(carveMask, node, { ...east, y: east.y + layerOffset });
        }
        if (hash3(cellX, layer * 11 + 5, cellZ, seed + 3_173) < 0.58) {
          const south = caveNode(cellX, cellZ + 1, seed + layer * 7_919);
          carveCaveTunnel(carveMask, node, { ...south, y: south.y + layerOffset });
        }
      }
    }
  }
  applyCaveCarveMask(blocks, carveMask);
}

function addLavaSprings(
  blocks: Map<string, BlockId>, region: TerrainRegion, seed: number, terrain?: WorldTerrainDescriptor,
): void {
  if (!usesBiomeGeneration(terrain)) return;
  for (let x = region.minX; x <= region.maxX; x += 1) for (let z = region.minZ; z <= region.maxZ; z += 1) {
    for (let y = Math.max(1, region.minY); y <= 8; y += 1) {
      const cell = blockKey(x, y, z);
      if (blocks.has(cell) || !blocks.has(blockKey(x, y - 1, z)) || hash3(x, y, z, seed + 8_113) >= 0.035) continue;
      blocks.set(cell, BLOCK.LAVA);
    }
  }
}

function isTreeSite(x: number, z: number, seed: number, terrain?: WorldTerrainDescriptor): boolean {
  // Keep the shared spawn visually clear and safe from leaf/trunk collision.
  if (Math.max(Math.abs(x), Math.abs(z)) <= SPAWN_BLEND_RADIUS + TREE_MARGIN) return false;
  if (terrainSandDepth(x, z, seed, terrain) > 0) return false;

  const biome = terrainBiome(x, z, seed, terrain);
  if (biome === "desert") return false;
  // Low-frequency forest noise creates recognizable groves and open meadows.
  const forestDensity = valueNoise(x, z, seed + 977, 24);
  const densityFloor = terrain?.generatorVersion !== 4 ? 0.38
    : biome === "jungle" ? 0.12
      : biome === "dark_forest" ? 0.18
        : biome === "taiga" || biome === "birch_forest" ? 0.27
          : biome === "savanna" ? 0.55 : 0.43;
  if (forestDensity < densityFloor) return false;

  const ground = terrainHeight(x, z, seed, terrain);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (Math.abs(terrainHeight(x + dx, z + dz, seed, terrain) - ground) > 1) return false;
    }
  }
  return true;
}

function addTree(
  blocks: Map<string, BlockId>,
  region: TerrainRegion,
  x: number,
  z: number,
  seed: number,
  terrain?: WorldTerrainDescriptor,
): void {
  const ground = terrainHeight(x, z, seed, terrain);
  const biome = terrainBiome(x, z, seed, terrain);
  const [log, leaves] = treeBlocksForBiome(biome);
  const trunkHeight = biome === "jungle" ? 6 + +(hash2(x, z, seed + 613) > 0.5)
    : hash2(x, z, seed + 613) > 0.62 ? 5 : 4;
  for (let dy = 1; dy <= trunkHeight; dy += 1) {
    if (isInside(region, x, z)) blocks.set(blockKey(x, ground + dy, z), log);
  }

  const crownY = ground + trunkHeight;
  for (let dy = -2; dy <= 1; dy += 1) {
    const radius = dy >= 1 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (!isInside(region, x + dx, z + dz)) continue;
        // Trim layer corners for a compact, blocky Minecraft-style crown.
        if (radius === 2 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
        if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
        const key = blockKey(x + dx, crownY + dy, z + dz);
        if (!blocks.has(key)) blocks.set(key, leaves);
      }
    }
  }
  if (isInside(region, x, z)) blocks.set(blockKey(x, crownY + 2, z), leaves);
}

function addTrees(
  blocks: Map<string, BlockId>, region: TerrainRegion, seed: number, terrain?: WorldTerrainDescriptor,
): void {
  // Evaluate neighboring tree cells too, then clip writes to this region. This makes
  // independently generated adjacent regions agree on tree canopies at their seam.
  const minCellX = Math.floor((region.minX - TREE_MARGIN) / TREE_CELL_SIZE);
  const maxCellX = Math.floor((region.maxX + TREE_MARGIN) / TREE_CELL_SIZE);
  const minCellZ = Math.floor((region.minZ - TREE_MARGIN) / TREE_CELL_SIZE);
  const maxCellZ = Math.floor((region.maxZ + TREE_MARGIN) / TREE_CELL_SIZE);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      if (hash2(cellX, cellZ, seed + 503) < 0.24) continue;
      const x = cellX * TREE_CELL_SIZE + Math.floor(hash2(cellX, cellZ, seed + 521) * TREE_CELL_SIZE);
      const z = cellZ * TREE_CELL_SIZE + Math.floor(hash2(cellX, cellZ, seed + 547) * TREE_CELL_SIZE);
      if (isTreeSite(x, z, seed, terrain)) addTree(blocks, region, x, z, seed, terrain);
    }
  }
}

function addBiomePlants(
  blocks: Map<string, BlockId>, region: TerrainRegion, seed: number, terrain?: WorldTerrainDescriptor,
): void {
  if (!usesBiomeGeneration(terrain)) return;
  for (let x = region.minX; x <= region.maxX; x += 1) for (let z = region.minZ; z <= region.maxZ; z += 1) {
    const top = terrainHeight(x, z, seed, terrain);
    if (top < TERRAIN_SEA_LEVEL || blocks.has(blockKey(x, top + 1, z))) continue;
    const chance = hash2(x, z, seed + 7_019);
    if (terrainBiome(x, z, seed, terrain) === "desert") {
      if (chance > 0.035 || hash2(x, z, seed + 7_043) > 0.18) continue;
      const height = 2 + +(hash2(x, z, seed + 7_067) > 0.55);
      for (let y = 1; y <= height; y += 1) blocks.set(blockKey(x, top + y, z), BLOCK.CACTUS);
    } else if (chance < 0.12) {
      blocks.set(blockKey(x, top + 1, z), chance < 0.012 ? BLOCK.POPPY
        : chance < 0.024 ? BLOCK.DANDELION : BLOCK.SHORT_GRASS);
    }
  }
}

/**
 * Generates an inclusive rectangular region. Regions can be generated separately
 * and merged, which is the path toward streaming terrain chunks later.
 */
export function createTerrainRegion(
  seed: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  options: TerrainRegionOptions = {},
): Map<string, BlockId> {
  if (![seed, minX, maxX, minZ, maxZ].every(Number.isFinite)) return new Map();
  const columnCount = (Math.floor(Math.max(minX, maxX)) - Math.ceil(Math.min(minX, maxX)) + 1)
    * (Math.floor(Math.max(minZ, maxZ)) - Math.ceil(Math.min(minZ, maxZ)) + 1);
  if (columnCount > MAX_TERRAIN_REGION_COLUMNS) {
    throw new RangeError(`Terrain regions are limited to ${MAX_TERRAIN_REGION_COLUMNS} columns.`);
  }
  const requestedMinimumY = Number.isFinite(options.minimumY) ? Math.floor(options.minimumY!) : 0;
  const region = {
    minX: Math.ceil(Math.min(minX, maxX)),
    maxX: Math.floor(Math.max(minX, maxX)),
    minY: Math.max(TERRAIN_MIN_Y, Math.min(0, requestedMinimumY)),
    minZ: Math.ceil(Math.min(minZ, maxZ)),
    maxZ: Math.floor(Math.max(minZ, maxZ)),
  };
  const blocks = new Map<string, BlockId>();
  if (options.terrain?.preset === "superflat") {
    addSuperflatGround(blocks, region, options.terrain.superflatGroundY);
    return blocks;
  }
  addGround(blocks, region, seed, options.terrain);
  carveCaves(blocks, region, seed);
  addLavaSprings(blocks, region, seed, options.terrain);
  addTrees(blocks, region, seed, options.terrain);
  addBiomePlants(blocks, region, seed, options.terrain);
  return blocks;
}

/**
 * Generates exactly one deep globally anchored chunk. Adjacent calls merge
 * byte-for-byte with a single region generated over the same bounds.
 */
export function createTerrainChunk(
  seed: number,
  chunkX: number,
  chunkZ: number,
  size = WORLD_CHUNK_SIZE,
  terrain?: WorldTerrainDescriptor,
): Map<string, BlockId> {
  const bounds = chunkBounds(chunkX, chunkZ, size);
  return createTerrainRegion(seed, bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, {
    minimumY: TERRAIN_MIN_Y,
    terrain,
  });
}

export function createTerrain(seed = 7319, radius = 20): Map<string, BlockId> {
  const wholeRadius = Number.isFinite(radius) ? Math.max(0, Math.min(40, Math.floor(radius))) : 20;
  return createTerrainRegion(seed, -wholeRadius, wholeRadius, -wholeRadius, wholeRadius);
}

export function raycastVoxels(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  getBlock: (x: number, y: number, z: number) => BlockId,
  reach = 6,
): BlockTarget | null {
  let previousX = Math.floor(origin[0]);
  let previousY = Math.floor(origin[1]);
  let previousZ = Math.floor(origin[2]);
  const originX = previousX;
  const originY = previousY;
  const originZ = previousZ;
  let currentX = Number.NaN;
  let currentY = Number.NaN;
  let currentZ = Number.NaN;
  let currentBlock = BLOCK.AIR as BlockId;
  // A fine fixed step is deterministic and plenty fast at Minecraft-scale reach.
  for (let distance = 0.025; distance <= reach; distance += 0.025) {
    const pointX = origin[0] + direction[0] * distance;
    const pointY = origin[1] + direction[1] * distance;
    const pointZ = origin[2] + direction[2] * distance;
    const x = Math.floor(pointX);
    const y = Math.floor(pointY);
    const z = Math.floor(pointZ);
    const enteredVoxel = x !== currentX || y !== currentY || z !== currentZ;
    if (enteredVoxel) {
      currentX = x;
      currentY = y;
      currentZ = z;
      currentBlock = getBlock(x, y, z);
    }
    // Preserve the established rule that a ray never targets the voxel that
    // contains its origin (for example an eye inside leaves or an open door).
    if (x === originX && y === originY && z === originZ) continue;
    if (currentBlock !== BLOCK.AIR && blockContainsSolidPoint(currentBlock, y, pointY, pointX, pointZ, x, z)) {
      // A descending ray may enter the empty upper half and later meet the slab
      // top without changing voxel coordinates. Its placement neighbor is the
      // cell above, not the already-occupied slab cell.
      const place = !enteredVoxel && blockCollisionHeight(currentBlock) < 1
        ? { x, y: y + 1, z }
        : { x: previousX, y: previousY, z: previousZ };
      return {
        block: { x, y, z, block: currentBlock },
        place,
        hit: { x: pointX, y: pointY, z: pointZ },
        distance,
      };
    }
    if (enteredVoxel) {
      previousX = x;
      previousY = y;
      previousZ = z;
    }
  }
  return null;
}
