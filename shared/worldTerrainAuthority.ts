import type { BlockType } from "./protocol.ts";

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

interface OreVeinConfig {
  block: Extract<BlockType, "coal_ore" | "iron_ore" | "gold_ore" | "diamond_ore">;
  minimumY: number;
  maximumY: number;
  chance: number;
  salt: number;
}

const ORE_VEINS: readonly OreVeinConfig[] = [
  { block: "diamond_ore", minimumY: WORLD_TERRAIN_MIN_Y + 1, maximumY: -12, chance: 0.055, salt: 3_421 },
  { block: "gold_ore", minimumY: WORLD_TERRAIN_MIN_Y + 1, maximumY: -4, chance: 0.11, salt: 2_863 },
  { block: "iron_ore", minimumY: WORLD_TERRAIN_MIN_Y + 1, maximumY: 4, chance: 0.17, salt: 2_137 },
  { block: "coal_ore", minimumY: WORLD_TERRAIN_MIN_Y + 1, maximumY: 6, chance: 0.43, salt: 1_619 },
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

function strataBlockAt(x: number, y: number, z: number, seed: number): BlockType {
  const top = terrainHeight(x, z, seed);
  if (y < WORLD_TERRAIN_MIN_Y || y > top) return "air";
  const sandDepth = terrainSandDepth(x, z, seed);
  if (sandDepth > 0 && y > top - sandDepth) return "sand";
  const dirtDepth = Math.min(top - 1, hash2(x, z, seed + 401) > 0.62 ? 3 : 2);
  if (y === top) return "grass";
  if (y >= top - dirtDepth) return "dirt";
  for (const config of ORE_VEINS) {
    if (blockInOreVein(x, y, z, seed, config)) return config.block;
  }
  return "stone";
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
  const carvable = block === "stone" || block === "coal_ore" || block === "iron_ore"
    || block === "gold_ore" || block === "diamond_ore";
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
