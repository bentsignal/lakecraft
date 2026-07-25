import type { BlockType } from "./protocol.ts";
import * as BS from "./bundleStrings.ts";

export const WORLD_TERRAIN_SEED = 7319;
export const WORLD_TERRAIN_MIN_Y = -24;

const MIN_TERRAIN_HEIGHT = 3;
const MAX_TERRAIN_HEIGHT = 11;
const SPAWN_HEIGHT = 6;
const SPAWN_PLATEAU_RADIUS = 3;
const SPAWN_BLEND_RADIUS = 9;
const ORE_CELL_SIZE = 4;
const SAND_SPAWN_SANCTUARY_RADIUS = 10;
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
  block: Extract<BlockType, "coal_ore" | "iron_ore" | "gold_ore" | "diamond_ore">;
  minimumY: number;
  maximumY: number;
  chance: number;
  salt: number;
}

const ORE_VEINS: readonly OreVeinConfig[] = [
  { block: BS.diamondOre, minimumY: WORLD_TERRAIN_MIN_Y + 1, maximumY: -12, chance: 0.055, salt: 3_421 },
  { block: BS.goldOre, minimumY: WORLD_TERRAIN_MIN_Y + 1, maximumY: -4, chance: 0.11, salt: 2_863 },
  { block: BS.ironOre, minimumY: WORLD_TERRAIN_MIN_Y + 1, maximumY: 4, chance: 0.17, salt: 2_137 },
  { block: BS.coalOre, minimumY: WORLD_TERRAIN_MIN_Y + 1, maximumY: 6, chance: 0.43, salt: 1_619 },
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
  return 5.9 + broadHills + rollingGround + ridgeLift + smallVariation;
}

function terrainHeight(x: number, z: number, seed: number): number {
  const naturalHeight = rawTerrainHeight(x, z, seed);
  const spawnDistance = Math.max(Math.abs(x), Math.abs(z));
  const spawnBlend = Math.max(
    0,
    Math.min(1, (spawnDistance - SPAWN_PLATEAU_RADIUS) / (SPAWN_BLEND_RADIUS - SPAWN_PLATEAU_RADIUS)),
  );
  const height = lerp(SPAWN_HEIGHT, naturalHeight, smoothstep(spawnBlend));
  return Math.max(MIN_TERRAIN_HEIGHT, Math.min(MAX_TERRAIN_HEIGHT, Math.round(height)));
}

function terrainSandDepth(x: number, z: number, seed: number): 0 | 2 | 3 {
  if (Math.max(Math.abs(x), Math.abs(z)) <= SAND_SPAWN_SANCTUARY_RADIUS) return 0;
  const ownerCellX = Math.floor(x / SAND_PATCH_CELL_SIZE);
  const ownerCellZ = Math.floor(z / SAND_PATCH_CELL_SIZE);
  for (let cellX = ownerCellX - 1; cellX <= ownerCellX + 1; cellX += 1) {
    for (let cellZ = ownerCellZ - 1; cellZ <= ownerCellZ + 1; cellZ += 1) {
      if (hash2(cellX, cellZ, seed + 4_019) >= SAND_PATCH_CHANCE) continue;
      const centerX = cellX * SAND_PATCH_CELL_SIZE
        + Math.floor(hash2(cellX, cellZ, seed + 4_037) * SAND_PATCH_CELL_SIZE);
      const centerZ = cellZ * SAND_PATCH_CELL_SIZE
        + Math.floor(hash2(cellX, cellZ, seed + 4_069) * SAND_PATCH_CELL_SIZE);
      const radius = 2.25 + hash2(cellX, cellZ, seed + 4_091) * 2;
      const dx = x + 0.5 - (centerX + 0.5);
      const dz = z + 0.5 - (centerZ + 0.5);
      if (dx * dx + dz * dz <= radius * radius) {
        return hash2(x, z, seed + 4_123) < 0.24 ? 3 : 2;
      }
    }
  }
  return 0;
}

function blockInOreVein(x: number, y: number, z: number, seed: number, config: OreVeinConfig): boolean {
  if (y < config.minimumY || y > config.maximumY) return false;
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

/** Matches the client terrain's globally anchored, bounded underground pockets. */
export function terrainGravelBlock(x: number, y: number, z: number, seed: number): Extract<BlockType, "gravel"> | null {
  const top = terrainHeight(x, z, seed);
  if (y < WORLD_TERRAIN_MIN_Y || y > top) return null;
  const sandDepth = terrainSandDepth(x, z, seed);
  if (sandDepth > 0 && y > top - sandDepth) return null;
  const dirtDepth = Math.min(top - 1, hash2(x, z, seed + 401) > 0.62 ? 3 : 2);
  if (y === top || y >= top - dirtDepth) return null;
  const cellX = Math.floor(x / GRAVEL_CELL_SIZE_XZ);
  const cellY = Math.floor(y / GRAVEL_CELL_SIZE_Y);
  const cellZ = Math.floor(z / GRAVEL_CELL_SIZE_XZ);
  if (hash3(cellX, cellY, cellZ, seed + 4_789) >= GRAVEL_POCKET_CHANCE) return null;
  const localX = x - cellX * GRAVEL_CELL_SIZE_XZ;
  const localY = y - cellY * GRAVEL_CELL_SIZE_Y;
  const localZ = z - cellZ * GRAVEL_CELL_SIZE_XZ;
  const centerX = 1.5 + hash3(cellX, cellY, cellZ, seed + 4_811) * (GRAVEL_CELL_SIZE_XZ - 3);
  const centerY = 1 + hash3(cellX, cellY, cellZ, seed + 4_837) * (GRAVEL_CELL_SIZE_Y - 2);
  const centerZ = 1.5 + hash3(cellX, cellY, cellZ, seed + 4_853) * (GRAVEL_CELL_SIZE_XZ - 3);
  const radiusX = 1.35 + hash3(cellX, cellY, cellZ, seed + 4_879) * 0.9;
  const radiusY = 0.8 + hash3(cellX, cellY, cellZ, seed + 4_903) * 0.65;
  const radiusZ = 1.35 + hash3(cellX, cellY, cellZ, seed + 4_927) * 0.9;
  const distance = ((localX + 0.5 - centerX) / radiusX) ** 2
    + ((localY + 0.5 - centerY) / radiusY) ** 2
    + ((localZ + 0.5 - centerZ) / radiusZ) ** 2;
  return distance <= 1 ? "gravel" : null;
}

/** Globally anchored shallow clay lenses, bounded to two or three blocks deep. */
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

function clayBlockAtResolvedStrata(
  x: number,
  y: number,
  z: number,
  seed: number,
  resolved: BlockType,
): BlockType {
  if (resolved !== "dirt" && resolved !== "stone") return resolved;
  const top = terrainHeight(x, z, seed);
  const depth = terrainClayDepth(x, z, seed);
  return depth > 0 && y < top && y >= top - depth ? "clay" : resolved;
}

function strataBlockAt(x: number, y: number, z: number, seed: number): BlockType {
  const top = terrainHeight(x, z, seed);
  if (y < WORLD_TERRAIN_MIN_Y || y > top) return "air";
  const sandDepth = terrainSandDepth(x, z, seed);
  if (sandDepth > 0 && y > top - sandDepth) return "sand";
  const dirtDepth = Math.min(top - 1, hash2(x, z, seed + 401) > 0.62 ? 3 : 2);
  if (y === top) return "grass";
  if (y >= top - dirtDepth) return clayBlockAtResolvedStrata(x, y, z, seed, "dirt");
  const gravel = terrainGravelBlock(x, y, z, seed);
  if (gravel) return gravel;
  for (const config of ORE_VEINS) {
    if (blockInOreVein(x, y, z, seed, config)) return config.block;
  }
  return clayBlockAtResolvedStrata(x, y, z, seed, "stone");
}

/** Clay at one untouched coordinate, after gravel/ore precedence but before caves. */
export function terrainClayBlock(
  x: number,
  y: number,
  z: number,
  seed: number,
): Extract<BlockType, "clay"> | null {
  if (![x, y, z, seed].every(Number.isFinite)
    || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return null;
  return strataBlockAt(x, y, z, seed) === "clay" ? "clay" : null;
}

const CAVE_CELL_SIZE = 10;
const CAVE_TUNNEL_RADIUS = 1.3;
const CAVE_CHAMBER_RADIUS = 2.15;
const CAVE_SAMPLE_SPACING = 0.75;
const CAVE_SPAWN_SANCTUARY_RADIUS = 10;

interface CaveNode {
  x: number;
  y: number;
  z: number;
}

function caveNode(cellX: number, cellZ: number, seed: number): CaveNode {
  return {
    x: cellX * CAVE_CELL_SIZE + 2 + hash3(cellX, 0, cellZ, seed + 3_011) * 6,
    y: 1.45 + hash3(cellX, 1, cellZ, seed + 3_037) * 3.9,
    z: cellZ * CAVE_CELL_SIZE + 2 + hash3(cellX, 2, cellZ, seed + 3_071) * 6,
  };
}

function caveSphereContainsBlock(x: number, y: number, z: number, center: CaveNode, radius: number): boolean {
  if (y < WORLD_TERRAIN_MIN_Y + 1 || y > Math.floor(center.y + radius)) return false;
  const dx = x + 0.5 - center.x;
  const dy = y + 0.5 - center.y;
  const dz = z + 0.5 - center.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

function caveTunnelContainsBlock(x: number, y: number, z: number, start: CaveNode, end: CaveNode): boolean {
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const steps = Math.max(1, Math.ceil(length / CAVE_SAMPLE_SPACING));
  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    if (caveSphereContainsBlock(x, y, z, {
      x: lerp(start.x, end.x, amount),
      y: lerp(start.y, end.y, amount),
      z: lerp(start.z, end.z, amount),
    }, CAVE_TUNNEL_RADIUS)) return true;
  }
  return false;
}

function caveCarvesBlock(x: number, y: number, z: number, seed: number): boolean {
  if (Math.max(Math.abs(x), Math.abs(z)) <= CAVE_SPAWN_SANCTUARY_RADIUS) return false;
  const ownerCellX = Math.floor(x / CAVE_CELL_SIZE);
  const ownerCellZ = Math.floor(z / CAVE_CELL_SIZE);
  const minimumLayer = Math.floor(WORLD_TERRAIN_MIN_Y / 8);
  for (let layer = minimumLayer; layer <= 0; layer += 1) {
    const layerOffset = layer * 8;
    for (let cellX = ownerCellX - 1; cellX <= ownerCellX + 1; cellX += 1) {
      for (let cellZ = ownerCellZ - 1; cellZ <= ownerCellZ + 1; cellZ += 1) {
        const shallowNode = caveNode(cellX, cellZ, seed + layer * 7_919);
        const node = { ...shallowNode, y: shallowNode.y + layerOffset };
        if (hash3(cellX, layer * 11 + 3, cellZ, seed + 3_101) < 0.32
          && caveSphereContainsBlock(x, y, z, node, CAVE_CHAMBER_RADIUS)) return true;
        if (hash3(cellX, layer * 11 + 4, cellZ, seed + 3_127) < 0.58) {
          const east = caveNode(cellX + 1, cellZ, seed + layer * 7_919);
          if (caveTunnelContainsBlock(x, y, z, node, { ...east, y: east.y + layerOffset })) return true;
        }
        if (hash3(cellX, layer * 11 + 5, cellZ, seed + 3_173) < 0.58) {
          const south = caveNode(cellX, cellZ + 1, seed + layer * 7_919);
          if (caveTunnelContainsBlock(x, y, z, node, { ...south, y: south.y + layerOffset })) return true;
        }
      }
    }
  }
  return false;
}

function groundAfterCaves(x: number, y: number, z: number, seed: number): BlockType {
  const block = strataBlockAt(x, y, z, seed);
  const carvable = block === "stone" || block === BS.coalOre || block === BS.ironOre
    || block === BS.goldOre || block === BS.diamondOre || block === "clay";
  return carvable && caveCarvesBlock(x, y, z, seed) ? "air" : block;
}

const TREE_CELL_SIZE = 7;
const TREE_MARGIN = 2;

interface TreeSite {
  x: number;
  z: number;
  ground: number;
  trunkHeight: number;
}

function isTreeSite(x: number, z: number, seed: number): boolean {
  if (Math.max(Math.abs(x), Math.abs(z)) <= SPAWN_BLEND_RADIUS + TREE_MARGIN) return false;
  if (terrainSandDepth(x, z, seed) > 0) return false;
  if (valueNoise(x, z, seed + 977, 24) < 0.38) return false;
  const ground = terrainHeight(x, z, seed);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (Math.abs(terrainHeight(x + dx, z + dz, seed) - ground) > 1) return false;
    }
  }
  return true;
}

function affectingTreeSites(x: number, z: number, seed: number): TreeSite[] {
  const sites: TreeSite[] = [];
  const minCellX = Math.floor((x - TREE_MARGIN) / TREE_CELL_SIZE);
  const maxCellX = Math.floor((x + TREE_MARGIN) / TREE_CELL_SIZE);
  const minCellZ = Math.floor((z - TREE_MARGIN) / TREE_CELL_SIZE);
  const maxCellZ = Math.floor((z + TREE_MARGIN) / TREE_CELL_SIZE);
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      if (hash2(cellX, cellZ, seed + 503) < 0.24) continue;
      const treeX = cellX * TREE_CELL_SIZE + Math.floor(hash2(cellX, cellZ, seed + 521) * TREE_CELL_SIZE);
      const treeZ = cellZ * TREE_CELL_SIZE + Math.floor(hash2(cellX, cellZ, seed + 547) * TREE_CELL_SIZE);
      if (!isTreeSite(treeX, treeZ, seed)) continue;
      sites.push({
        x: treeX,
        z: treeZ,
        ground: terrainHeight(treeX, treeZ, seed),
        trunkHeight: hash2(treeX, treeZ, seed + 613) > 0.62 ? 5 : 4,
      });
    }
  }
  return sites;
}

function treeCanopyContains(site: TreeSite, x: number, y: number, z: number): boolean {
  const crownY = site.ground + site.trunkHeight;
  if (x === site.x && z === site.z && y === crownY + 2) return true;
  const dy = y - crownY;
  if (dy < -2 || dy > 1) return false;
  const radius = dy >= 1 ? 1 : 2;
  const dx = x - site.x;
  const dz = z - site.z;
  if (Math.abs(dx) > radius || Math.abs(dz) > radius) return false;
  if (radius === 2 && Math.abs(dx) === radius && Math.abs(dz) === radius) return false;
  if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) return false;
  return true;
}

/**
 * Returns the untouched shared-world block at one integer coordinate. This is
 * intentionally independent of browser and Lakebed runtimes so server
 * mutations can validate first-touch natural blocks without trusting clients.
 */
export function naturalWorldBlockAt(
  x: number,
  y: number,
  z: number,
  seed = WORLD_TERRAIN_SEED,
): BlockType {
  if (![x, y, z, seed].every(Number.isFinite)
    || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return "air";
  if (y < WORLD_TERRAIN_MIN_Y || y > 128) return "air";
  const terrainBlock = groundAfterCaves(x, y, z, seed);
  const sites = affectingTreeSites(x, z, seed);
  for (const site of sites) {
    if (x === site.x && z === site.z && y > site.ground && y <= site.ground + site.trunkHeight) return "wood";
  }
  if (terrainBlock !== "air") return terrainBlock;
  return sites.some((site) => treeCanopyContains(site, x, y, z)) ? "leaves" : "air";
}
