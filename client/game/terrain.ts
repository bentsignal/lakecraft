import { BLOCK, type BlockId, type BlockTarget } from "./types.ts";

export const blockKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

function hash2(x: number, z: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(z + seed, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

export function terrainHeight(x: number, z: number, seed: number): number {
  const broad = Math.sin((x + seed * 0.013) * 0.22) * 1.15;
  const rolling = Math.cos((z - seed * 0.021) * 0.19) * 0.95;
  const detail = (hash2(x, z, seed) - 0.5) * 1.7;
  return Math.max(3, Math.min(9, Math.floor(5.5 + broad + rolling + detail)));
}

export function createTerrain(seed = 7319, radius = 20): Map<string, BlockId> {
  const blocks = new Map<string, BlockId>();
  for (let x = -radius; x <= radius; x += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      const top = terrainHeight(x, z, seed);
      for (let y = 0; y <= top; y += 1) {
        const block = y === top ? BLOCK.GRASS : y >= top - 2 ? BLOCK.DIRT : BLOCK.STONE;
        blocks.set(blockKey(x, y, z), block);
      }
    }
  }

  // Trees are generated in a second pass so their leaves do not affect terrain height.
  for (let x = -radius + 3; x <= radius - 3; x += 1) {
    for (let z = -radius + 3; z <= radius - 3; z += 1) {
      if (Math.abs(x) < 3 && Math.abs(z) < 3) continue;
      if (hash2(x * 7, z * 7, seed + 91) < 0.978) continue;
      const ground = terrainHeight(x, z, seed);
      const trunkHeight = hash2(x, z, seed + 211) > 0.5 ? 4 : 3;
      for (let y = 1; y <= trunkHeight; y += 1) {
        blocks.set(blockKey(x, ground + y, z), BLOCK.WOOD);
      }
      const crownY = ground + trunkHeight;
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dz = -2; dz <= 2; dz += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > 3) continue;
            const key = blockKey(x + dx, crownY + dy, z + dz);
            if (!blocks.has(key)) blocks.set(key, BLOCK.LEAVES);
          }
        }
      }
      blocks.set(blockKey(x, crownY + 2, z), BLOCK.LEAVES);
    }
  }
  return blocks;
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
