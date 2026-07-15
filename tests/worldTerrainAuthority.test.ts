import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createTerrainChunk } from "../client/game/terrain.ts";
import { BLOCK, type BlockId as EngineBlockId } from "../client/game/types.ts";
import type { BlockType } from "../shared/protocol.ts";
import {
  WORLD_TERRAIN_MIN_Y,
  WORLD_TERRAIN_SEED,
  naturalWorldBlockAt,
} from "../shared/worldTerrainAuthority.ts";

const ENGINE_TO_PROTOCOL: Readonly<Record<EngineBlockId, BlockType>> = {
  [BLOCK.AIR]: "air",
  [BLOCK.GRASS]: "grass",
  [BLOCK.DIRT]: "dirt",
  [BLOCK.STONE]: "stone",
  [BLOCK.WOOD]: "wood",
  [BLOCK.LEAVES]: "leaves",
  [BLOCK.PLANKS]: "planks",
  [BLOCK.CRAFTING_TABLE]: "crafting_table",
  [BLOCK.TORCH]: "torch",
  [BLOCK.CHEST]: "chest",
  [BLOCK.DOOR_CLOSED]: "door_closed",
  [BLOCK.DOOR_OPEN]: "door_open",
  [BLOCK.BED]: "bed",
  [BLOCK.COAL_ORE]: "coal_ore",
  [BLOCK.IRON_ORE]: "iron_ore",
  [BLOCK.FURNACE]: "furnace",
  [BLOCK.LADDER]: "ladder",
  [BLOCK.COBBLESTONE]: "cobblestone",
  [BLOCK.SAND]: "sand",
  [BLOCK.GRAVEL]: "gravel",
  [BLOCK.GLASS]: "glass",
  [BLOCK.GOLD_ORE]: "gold_ore",
  [BLOCK.DIAMOND_ORE]: "diamond_ore",
  [BLOCK.TNT]: "tnt",
  [BLOCK.WOOL]: "wool",
  [BLOCK.SAPLING]: "sapling",
  [BLOCK.STONE_BRICKS]: "stone_bricks",
  [BLOCK.OAK_FENCE]: "oak_fence",
  [BLOCK.OAK_FENCE_GATE_CLOSED]: "oak_fence_gate_closed",
  [BLOCK.OAK_FENCE_GATE_OPEN]: "oak_fence_gate_open",
};

const chunkCache = new Map<string, Map<string, EngineBlockId>>();
function clientBlockAt(x: number, y: number, z: number, seed: number): BlockType {
  const chunkX = Math.floor(x / 8);
  const chunkZ = Math.floor(z / 8);
  const cacheKey = `${seed}:${chunkX}:${chunkZ}`;
  let chunk = chunkCache.get(cacheKey);
  if (!chunk) {
    chunk = createTerrainChunk(seed, chunkX, chunkZ);
    chunkCache.set(cacheKey, chunk);
  }
  return ENGINE_TO_PROTOCOL[chunk.get(`${x},${y},${z}`) ?? BLOCK.AIR];
}

function assertParity(x: number, y: number, z: number, seed = WORLD_TERRAIN_SEED): void {
  assert.equal(
    naturalWorldBlockAt(x, y, z, seed),
    clientBlockAt(x, y, z, seed),
    `terrain authority drift at seed=${seed} ${x},${y},${z}`,
  );
}

assert.equal(WORLD_TERRAIN_MIN_Y, -24);
assert.equal(WORLD_TERRAIN_SEED, 7319);
assert.equal(naturalWorldBlockAt(Number.NaN, 0, 0), "air");
assert.equal(naturalWorldBlockAt(0.5, 0, 0), "air");
assert.equal(naturalWorldBlockAt(0, WORLD_TERRAIN_MIN_Y - 1, 0), "air");
assert.equal(naturalWorldBlockAt(0, 129, 0), "air");

const namedSamples = [
  [-64, -8, -64, "gold_ore", "negative gold"],
  [-64, -19, -60, "iron_ore", "negative iron"],
  [-63, -12, -64, "coal_ore", "negative coal"],
  [-62, -12, -62, "diamond_ore", "negative diamond"],
  [-57, -23, -57, "air", "negative deep cave"],
  [-64, 7, -53, "sand", "negative beach"],
  [-64, -2, -37, "gravel", "negative gravel pocket"],
  [-59, 9, -33, "wood", "negative tree trunk"],
  [-61, 10, -34, "leaves", "negative tree canopy"],
  [8, -13, 14, "air", "positive chunk-boundary cave"],
  [14, -15, 12, "diamond_ore", "positive chunk-boundary diamond"],
  [13, 9, 13, "wood", "positive chunk-boundary trunk"],
  [11, 10, 12, "leaves", "positive chunk-boundary canopy"],
  [1_000, -21, -1_997, "air", "far mixed-sign cave"],
  [1_001, -3, -1_998, "gravel", "far mixed-sign gravel"],
  [-997, 5, 2_000, "sand", "far mixed-sign beach"],
  [-996, -15, 2_003, "diamond_ore", "far mixed-sign diamond"],
  [65_536, -5, -65_536, "air", "large exact-boundary cave"],
  [65_536, -12, -65_536, "iron_ore", "large exact-boundary iron"],
  [-65_541, 9, 65_529, "sand", "large negative-boundary beach"],
  [-65_543, 11, 65_530, "wood", "large negative-boundary trunk"],
] as const;
const namedKinds = new Set<BlockType>();
for (const [x, y, z, expected, label] of namedSamples) {
  assert.equal(clientBlockAt(x, y, z, WORLD_TERRAIN_SEED), expected, `${label} client anchor drifted`);
  assertParity(x, y, z);
  namedKinds.add(expected);
}
for (const expected of [
  "air", "sand", "gravel", "coal_ore", "iron_ore", "gold_ore", "diamond_ore", "wood", "leaves",
] as const) assert.equal(namedKinds.has(expected), true, `missing explicit ${expected} authority anchor`);

const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.match(serverSource,
  /import \{ naturalWorldBlockAt \} from "\.\.\/shared\/worldTerrainAuthority\.ts"/,
  "Lakebed imports the same pure natural terrain authority used by this parity suite");
assert.ok((serverSource.match(/naturalWorldBlockAt\(/g) ?? []).length >= 12,
  "all first-touch world, combat, fall, growth, and spawn fallbacks remain rooted in shared authority");
assert.doesNotMatch(serverSource, /function\s+(?:rawTerrainHeight|terrainHeight|terrainSandDepth|caveCarvesBlock)\s*\(/,
  "the server must not grow a third terrain generator that can drift from client/shared output");

let randomState = 0x51f15e;
function random(): number {
  randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
  return randomState / 4_294_967_296;
}

const chunkCoordinates: Array<[number, number]> = [
  [0, 0], [-1, 0], [0, -1], [1, 1], [-8, -8], [8, 8],
  [12_345, -23_456], [-62_500, 62_499], [124_999, -124_999],
];
for (let index = 0; index < 31; index += 1) {
  chunkCoordinates.push([
    Math.floor(random() * 249_999) - 124_999,
    Math.floor(random() * 249_999) - 124_999,
  ]);
}

let comparisons = 0;
const startedAt = performance.now();
// Fully cover a feature-rich positive seam chunk and a far mixed-sign chunk.
// These exact windows guard every air/present key, not only named anchors.
for (const [chunkX, chunkZ] of [[1, 1], [125, -250]] as const) {
  for (let x = chunkX * 8; x < chunkX * 8 + 8; x += 1) {
    for (let z = chunkZ * 8; z < chunkZ * 8 + 8; z += 1) {
      for (let y = WORLD_TERRAIN_MIN_Y - 2; y <= 24; y += 1) {
        assertParity(x, y, z);
        comparisons += 1;
      }
    }
  }
}
for (const seed of [WORLD_TERRAIN_SEED, 1, 987_654_321]) {
  for (const [chunkX, chunkZ] of chunkCoordinates) {
    for (let sample = 0; sample < 65; sample += 1) {
      const x = chunkX * 8 + Math.floor(random() * 8);
      const y = WORLD_TERRAIN_MIN_Y - 2 + Math.floor(random() * 54);
      const z = chunkZ * 8 + Math.floor(random() * 8);
      assertParity(x, y, z, seed);
      comparisons += 1;
    }
  }
}

// Exercise both sides of negative, positive, near, and far chunk seams.
for (const boundary of [-1_000_000, -65_536, -8, 0, 8, 65_536, 1_000_000]) {
  for (const offset of [-1, 0, 1]) {
    for (let y = WORLD_TERRAIN_MIN_Y; y <= 24; y += 3) {
      assertParity(boundary + offset, y, 17);
      assertParity(17, y, boundary + offset);
      comparisons += 2;
    }
  }
}
const elapsedMs = performance.now() - startedAt;
assert.ok(comparisons >= 15_000, `expected thousands of parity comparisons, received ${comparisons}`);
assert.ok(elapsedMs < 2_500, `single-cell terrain parity sweep took ${elapsedMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  benchmark: "shared natural terrain authority parity",
  comparisons,
  cachedChunks: chunkCache.size,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  namedSamples: namedSamples.length,
}));
console.log("lakecraft shared natural terrain authority tests: ok");
