import { BLOCK, type BlockId, type BlockTarget } from "./types.ts";

export const blockKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

interface TerrainRegion {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const MIN_TERRAIN_HEIGHT = 3;
const MAX_TERRAIN_HEIGHT = 11;
const SPAWN_HEIGHT = 6;
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

interface OreVeinConfig {
  block: BlockId;
  maximumY: number;
  chance: number;
  salt: number;
}

interface CaveNode {
  x: number;
  y: number;
  z: number;
}

// One compact Manhattan-radius-one deposit may occupy each 4x4x4 cell. The
// cell-local shape strictly caps a vein at seven blocks while global cell
// coordinates keep ore identical no matter which terrain region generated it.
const ORE_VEINS: readonly OreVeinConfig[] = [
  { block: BLOCK.IRON_ORE, maximumY: 4, chance: 0.17, salt: 2_137 },
  { block: BLOCK.COAL_ORE, maximumY: 6, chance: 0.43, salt: 1_619 },
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
  const broadHills = (valueNoise(x, z, seed + 17, 30) - 0.5) * 6.2;
  const rollingGround = (valueNoise(x, z, seed + 113, 12) - 0.5) * 3.2;
  const smallVariation = (valueNoise(x, z, seed + 307, 5) - 0.5) * 1.2;
  return 6.2 + broadHills + rollingGround + smallVariation;
}

export function terrainHeight(x: number, z: number, seed: number): number {
  const naturalHeight = rawTerrainHeight(x, z, seed);
  const spawnDistance = Math.max(Math.abs(x), Math.abs(z));
  const spawnBlend = Math.max(
    0,
    Math.min(1, (spawnDistance - SPAWN_PLATEAU_RADIUS) / (SPAWN_BLEND_RADIUS - SPAWN_PLATEAU_RADIUS)),
  );
  const height = lerp(SPAWN_HEIGHT, naturalHeight, smoothstep(spawnBlend));
  return Math.max(MIN_TERRAIN_HEIGHT, Math.min(MAX_TERRAIN_HEIGHT, Math.round(height)));
}

/** The natural strata before deterministic ore replacement. */
export function terrainBaseBlock(x: number, y: number, z: number, seed: number): BlockId {
  const top = terrainHeight(x, z, seed);
  if (y < 0 || y > top) return BLOCK.AIR;
  const dirtDepth = Math.min(top - 1, hash2(x, z, seed + 401) > 0.62 ? 3 : 2);
  return y === top ? BLOCK.GRASS : y >= top - dirtDepth ? BLOCK.DIRT : BLOCK.STONE;
}

function blockInOreVein(x: number, y: number, z: number, seed: number, config: OreVeinConfig): boolean {
  if (y < 0 || y > config.maximumY) return false;
  const cellX = Math.floor(x / ORE_CELL_SIZE);
  const cellY = Math.floor(y / ORE_CELL_SIZE);
  const cellZ = Math.floor(z / ORE_CELL_SIZE);
  if (hash3(cellX, cellY, cellZ, seed + config.salt) >= config.chance) return false;

  const localX = x - cellX * ORE_CELL_SIZE;
  const localY = y - cellY * ORE_CELL_SIZE;
  const localZ = z - cellZ * ORE_CELL_SIZE;
  const anchorX = Math.floor(hash3(cellX, cellY, cellZ, seed + config.salt + 11) * ORE_CELL_SIZE);
  const anchorY = Math.floor(hash3(cellX, cellY, cellZ, seed + config.salt + 23) * ORE_CELL_SIZE);
  const anchorZ = Math.floor(hash3(cellX, cellY, cellZ, seed + config.salt + 37) * ORE_CELL_SIZE);
  return Math.abs(localX - anchorX) + Math.abs(localY - anchorY) + Math.abs(localZ - anchorZ) <= 1;
}

/** Iron wins rare overlaps; both ores can replace natural stone only. */
function oreBlockAtKnownStone(x: number, y: number, z: number, seed: number): BlockId | null {
  for (const config of ORE_VEINS) {
    if (blockInOreVein(x, y, z, seed, config)) return config.block;
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

function addGround(blocks: Map<string, BlockId>, region: TerrainRegion, seed: number): void {
  for (let x = region.minX; x <= region.maxX; x += 1) {
    for (let z = region.minZ; z <= region.maxZ; z += 1) {
      const top = terrainHeight(x, z, seed);
      const dirtDepth = Math.min(top - 1, hash2(x, z, seed + 401) > 0.62 ? 3 : 2);
      for (let y = 0; y <= top; y += 1) {
        const base = y === top ? BLOCK.GRASS : y >= top - dirtDepth ? BLOCK.DIRT : BLOCK.STONE;
        const block = base === BLOCK.STONE ? oreBlockAtKnownStone(x, y, z, seed) ?? base : base;
        blocks.set(blockKey(x, y, z), block);
      }
    }
  }
}

function caveNode(cellX: number, cellZ: number, seed: number): CaveNode {
  return {
    // Nodes stay two blocks inside their owning cell. This bounds how far a
    // chamber can reach while leaving the connecting segments free to cross it.
    x: cellX * CAVE_CELL_SIZE + 2 + hash3(cellX, 0, cellZ, seed + 3_011) * 6,
    y: 1.45 + hash3(cellX, 1, cellZ, seed + 3_037) * 3.9,
    z: cellZ * CAVE_CELL_SIZE + 2 + hash3(cellX, 2, cellZ, seed + 3_071) * 6,
  };
}

function canCarveCaveBlock(block: BlockId | undefined): boolean {
  return block === BLOCK.STONE || block === BLOCK.COAL_ORE || block === BLOCK.IRON_ORE;
}

function carveCaveSphere(
  blocks: Map<string, BlockId>,
  region: TerrainRegion,
  center: CaveNode,
  radius: number,
): void {
  const radiusSquared = radius * radius;
  const minX = Math.max(region.minX, Math.floor(center.x - radius));
  const maxX = Math.min(region.maxX, Math.floor(center.x + radius));
  const minY = Math.max(1, Math.floor(center.y - radius));
  const maxY = Math.floor(center.y + radius);
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
        const key = blockKey(x, y, z);
        if (canCarveCaveBlock(blocks.get(key))) blocks.delete(key);
      }
    }
  }
}

function carveCaveTunnel(
  blocks: Map<string, BlockId>,
  region: TerrainRegion,
  start: CaveNode,
  end: CaveNode,
): void {
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const steps = Math.max(1, Math.ceil(length / CAVE_SAMPLE_SPACING));
  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    carveCaveSphere(blocks, region, {
      x: lerp(start.x, end.x, amount),
      y: lerp(start.y, end.y, amount),
      z: lerp(start.z, end.z, amount),
    }, CAVE_TUNNEL_RADIUS);
  }
}

function carveCaves(blocks: Map<string, BlockId>, region: TerrainRegion, seed: number): void {
  // Include one cell beyond each clipped region. It contains every chamber or
  // forward connection whose bounded radius can touch this region, ensuring an
  // independently generated half sees the same cross-boundary tunnel as a whole.
  const minCellX = Math.floor(region.minX / CAVE_CELL_SIZE) - 1;
  const maxCellX = Math.floor(region.maxX / CAVE_CELL_SIZE) + 1;
  const minCellZ = Math.floor(region.minZ / CAVE_CELL_SIZE) - 1;
  const maxCellZ = Math.floor(region.maxZ / CAVE_CELL_SIZE) + 1;
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      const node = caveNode(cellX, cellZ, seed);
      if (hash3(cellX, 3, cellZ, seed + 3_101) < 0.32) {
        carveCaveSphere(blocks, region, node, CAVE_CHAMBER_RADIUS);
      }
      if (hash3(cellX, 4, cellZ, seed + 3_127) < 0.58) {
        carveCaveTunnel(blocks, region, node, caveNode(cellX + 1, cellZ, seed));
      }
      if (hash3(cellX, 5, cellZ, seed + 3_173) < 0.58) {
        carveCaveTunnel(blocks, region, node, caveNode(cellX, cellZ + 1, seed));
      }
    }
  }
}

function isTreeSite(x: number, z: number, seed: number): boolean {
  // Keep the shared spawn visually clear and safe from leaf/trunk collision.
  if (Math.max(Math.abs(x), Math.abs(z)) <= SPAWN_BLEND_RADIUS + TREE_MARGIN) return false;

  // Low-frequency forest noise creates recognizable groves and open meadows.
  const forestDensity = valueNoise(x, z, seed + 977, 24);
  if (forestDensity < 0.38) return false;

  const ground = terrainHeight(x, z, seed);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (Math.abs(terrainHeight(x + dx, z + dz, seed) - ground) > 1) return false;
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
): void {
  const ground = terrainHeight(x, z, seed);
  const trunkHeight = hash2(x, z, seed + 613) > 0.62 ? 5 : 4;
  for (let dy = 1; dy <= trunkHeight; dy += 1) {
    if (isInside(region, x, z)) blocks.set(blockKey(x, ground + dy, z), BLOCK.WOOD);
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
        if (!blocks.has(key)) blocks.set(key, BLOCK.LEAVES);
      }
    }
  }
  if (isInside(region, x, z)) blocks.set(blockKey(x, crownY + 2, z), BLOCK.LEAVES);
}

function addTrees(blocks: Map<string, BlockId>, region: TerrainRegion, seed: number): void {
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
      if (isTreeSite(x, z, seed)) addTree(blocks, region, x, z, seed);
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
): Map<string, BlockId> {
  const region = {
    minX: Math.ceil(Math.min(minX, maxX)),
    maxX: Math.floor(Math.max(minX, maxX)),
    minZ: Math.ceil(Math.min(minZ, maxZ)),
    maxZ: Math.floor(Math.max(minZ, maxZ)),
  };
  const blocks = new Map<string, BlockId>();
  addGround(blocks, region, seed);
  carveCaves(blocks, region, seed);
  addTrees(blocks, region, seed);
  return blocks;
}

export function createTerrain(seed = 7319, radius = 20): Map<string, BlockId> {
  const wholeRadius = Math.max(0, Math.floor(radius));
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
  // A fine fixed step is deterministic and plenty fast at Minecraft-scale reach.
  for (let distance = 0.025; distance <= reach; distance += 0.025) {
    const x = Math.floor(origin[0] + direction[0] * distance);
    const y = Math.floor(origin[1] + direction[1] * distance);
    const z = Math.floor(origin[2] + direction[2] * distance);
    if (x === previousX && y === previousY && z === previousZ) continue;
    if (getBlock(x, y, z) !== BLOCK.AIR) {
      return {
        block: { x, y, z, block: getBlock(x, y, z) },
        place: { x: previousX, y: previousY, z: previousZ },
        distance,
      };
    }
    previousX = x;
    previousY = y;
    previousZ = z;
  }
  return null;
}
