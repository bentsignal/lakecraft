import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  blockKey,
  createTerrain,
  createTerrainChunk,
  createTerrainRegion,
  MAX_TERRAIN_REGION_COLUMNS,
  TERRAIN_MIN_Y,
  terrainBaseBlock,
  terrainHeight,
  terrainSandDepth,
} from "../client/game/terrain.ts";
import { BLOCK } from "../client/game/types.ts";

const SEED = 7319;

assert.equal(BLOCK.COAL_ORE, 13, "new block IDs must append without changing saved IDs");
assert.equal(BLOCK.IRON_ORE, 14, "new block IDs must append without changing saved IDs");
assert.equal(BLOCK.FURNACE, 15, "new block IDs must append without changing saved IDs");
assert.equal(BLOCK.LADDER, 16, "new block IDs must append without changing saved IDs");
assert.equal(BLOCK.COBBLESTONE, 17, "new block IDs must append without changing saved IDs");
assert.equal(BLOCK.SAND, 18, "new block IDs must append without changing saved IDs");
assert.equal(BLOCK.GLASS, 19, "new block IDs must append without changing saved IDs");
assert.equal(TERRAIN_MIN_Y, -24, "streamed chunks need substantially deeper mineable strata");
assert.equal(createTerrainRegion(SEED, Number.NEGATIVE_INFINITY, 0, 0, 0).size, 0);
assert.throws(() => createTerrainChunk(SEED, Number.POSITIVE_INFINITY, 0), RangeError);
assert.throws(
  () => createTerrainRegion(SEED, 0, MAX_TERRAIN_REGION_COLUMNS, 0, 1),
  /limited/,
  "a mistaken giant window must fail before doing unbounded generation work",
);

// Equal seeds must produce byte-for-byte equivalent insertion order and contents.
const first = createTerrain(SEED, 24);
const repeated = createTerrain(SEED, 24);
assert.deepEqual([...repeated], [...first], "the same seed and radius should reproduce the same world");
assert.notDeepEqual(
  [...createTerrain(SEED + 1, 24)],
  [...first],
  "the seed should continue to affect terrain and trees",
);

// The 7x7 spawn plateau is flat, clear, and has headroom for every seed.
for (const seed of [1, 42, SEED, 999_999]) {
  const terrain = createTerrain(seed, 18);
  for (let x = -3; x <= 3; x += 1) {
    for (let z = -3; z <= 3; z += 1) {
      assert.equal(terrainHeight(x, z, seed), 6, `spawn should be flat at ${x},${z}`);
      assert.equal(terrain.get(blockKey(x, 6, z)), BLOCK.GRASS);
      assert.equal(terrain.has(blockKey(x, 7, z)), false, `spawn headroom should be empty at ${x},${z}`);
    }
  }
  for (const [key, block] of terrain) {
    if (block !== BLOCK.WOOD && block !== BLOCK.LEAVES) continue;
    const [x, , z] = key.split(",").map(Number);
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) > 8, `tree block ${key} intrudes into the spawn clearing`);
  }
}

// Every terrain column has a grass/dirt or bounded sand surface over natural stone strata.
for (let x = -18; x <= 18; x += 1) {
  for (let z = -18; z <= 18; z += 1) {
    const top = terrainHeight(x, z, SEED);
    const sandDepth = terrainSandDepth(x, z, SEED);
    assert.ok(top >= 3 && top <= 11, `height ${top} at ${x},${z} is outside generation bounds`);
    assert.equal(first.get(blockKey(x, top, z)), sandDepth ? BLOCK.SAND : BLOCK.GRASS);
    assert.equal(first.get(blockKey(x, top - 1, z)), sandDepth ? BLOCK.SAND : BLOCK.DIRT);
    assert.equal(first.get(blockKey(x, top - 2, z)), sandDepth === 3 ? BLOCK.SAND : BLOCK.DIRT);
    assert.ok(
      [BLOCK.STONE, BLOCK.GRAVEL, BLOCK.COAL_ORE, BLOCK.IRON_ORE].includes(first.get(blockKey(x, 0, z))!),
      "the foundation may contain deterministic gravel or ore",
    );
  }
}

// Regions generated independently must match the same slice of a whole world,
// including tree canopies whose trunks are on the other side of a seam.
const whole = createTerrainRegion(SEED, -24, 23, -24, 23);
const west = createTerrainRegion(SEED, -24, -1, -24, 23);
const east = createTerrainRegion(SEED, 0, 23, -24, 23);
const merged = new Map([...west, ...east]);
assert.deepEqual(
  [...merged].sort(([left], [right]) => left.localeCompare(right)),
  [...whole].sort(([left], [right]) => left.localeCompare(right)),
  "adjacent generated regions should merge without terrain or tree seams",
);

// Chunk-native terrain is deterministic at far positive and negative global
// coordinates, and arbitrary chunk splits reproduce the same deep region.
for (const [chunkX, chunkZ] of [[15_432, -9_876], [-15_432, 9_876], [-1, -1], [0, 0]]) {
  const chunk = createTerrainChunk(SEED, chunkX, chunkZ);
  assert.deepEqual([...createTerrainChunk(SEED, chunkX, chunkZ)], [...chunk]);
  assert.ok(chunk.size >= 8 * 8 * 20, `deep chunk ${chunkX},${chunkZ} is unexpectedly shallow`);
  const minX = chunkX * 8;
  const minZ = chunkZ * 8;
  for (let x = minX; x < minX + 8; x += 1) {
    for (let z = minZ; z < minZ + 8; z += 1) {
      assert.notEqual(chunk.get(blockKey(x, TERRAIN_MIN_Y, z)), undefined, "deep floor must be solid");
    }
  }
}

const farChunkX = -12_345;
const farChunkZ = 23_456;
const farWhole = createTerrainRegion(
  SEED,
  farChunkX * 8,
  farChunkX * 8 + 15,
  farChunkZ * 8,
  farChunkZ * 8 + 15,
  { minimumY: TERRAIN_MIN_Y },
);
const farParts = [
  createTerrainChunk(SEED, farChunkX, farChunkZ),
  createTerrainChunk(SEED, farChunkX + 1, farChunkZ),
  createTerrainChunk(SEED, farChunkX, farChunkZ + 1),
  createTerrainChunk(SEED, farChunkX + 1, farChunkZ + 1),
];
assert.deepEqual(
  [...new Map(farParts.flatMap((part) => [...part]))].sort(([left], [right]) => left.localeCompare(right)),
  [...farWhole].sort(([left], [right]) => left.localeCompare(right)),
  "far-coordinate chunks must merge without terrain, cave, ore, or tree seams",
);
const farDeepOre = [...farWhole].filter(([key, block]) => (
  Number(key.split(",")[1]) < 0 && (block === BLOCK.COAL_ORE || block === BLOCK.IRON_ORE)
));
assert.ok(farDeepOre.some(([, block]) => block === BLOCK.COAL_ORE), "deep strata need mineable coal");
assert.ok(farDeepOre.some(([, block]) => block === BLOCK.IRON_ORE), "deep strata need mineable iron");

const oreBlocks = [...first].filter(([, block]) => block === BLOCK.COAL_ORE || block === BLOCK.IRON_ORE);
const coalBlocks = oreBlocks.filter(([, block]) => block === BLOCK.COAL_ORE);
const ironBlocks = oreBlocks.filter(([, block]) => block === BLOCK.IRON_ORE);
const naturalStoneCount = [...first].filter(([, block]) => (
  block === BLOCK.STONE || block === BLOCK.GRAVEL || block === BLOCK.COAL_ORE || block === BLOCK.IRON_ORE
)).length;
assert.ok(coalBlocks.length >= 100, `expected useful coal deposits, received ${coalBlocks.length}`);
assert.ok(ironBlocks.length >= 20, `expected useful iron deposits, received ${ironBlocks.length}`);
assert.ok(coalBlocks.length < naturalStoneCount * 0.08, "coal density must stay safely below 8% of stone strata");
assert.ok(ironBlocks.length < naturalStoneCount * 0.04, "iron must remain rarer than coal and below 4%");
assert.ok(ironBlocks.length < coalBlocks.length, "iron should be rarer than coal");
for (const [key, block] of oreBlocks) {
  const [x, y, z] = key.split(",").map(Number);
  assert.equal(terrainBaseBlock(x, y, z, SEED), BLOCK.STONE, `${key} replaced a non-stone block`);
  assert.ok(y <= (block === BLOCK.IRON_ORE ? 4 : 6), `${key} exceeded its ore depth bound`);
}

const treeBlocks = [...first.values()].filter((block) => block === BLOCK.WOOD || block === BLOCK.LEAVES);
assert.ok(treeBlocks.filter((block) => block === BLOCK.WOOD).length >= 20, "expected deterministic tree trunks");
assert.ok(treeBlocks.filter((block) => block === BLOCK.LEAVES).length >= 100, "expected deterministic tree crowns");

const startedAt = performance.now();
const benchmarkTerrain = createTerrain(SEED, 40);
const generationMs = performance.now() - startedAt;
assert.ok(benchmarkTerrain.size > 40_000, "benchmark world should contain a meaningful number of blocks");
assert.ok(generationMs < 250, `radius-40 terrain generation took ${generationMs.toFixed(1)}ms (budget: 250ms)`);

console.log(JSON.stringify({
  benchmark: "deterministic radius-40 terrain generation",
  generationMs: Number(generationMs.toFixed(2)),
  blockCount: benchmarkTerrain.size,
  treeBlockCount: [...benchmarkTerrain.values()].filter((block) => block === BLOCK.WOOD || block === BLOCK.LEAVES).length,
  coalBlockCount: [...benchmarkTerrain.values()].filter((block) => block === BLOCK.COAL_ORE).length,
  ironBlockCount: [...benchmarkTerrain.values()].filter((block) => block === BLOCK.IRON_ORE).length,
  sandBlockCount: [...benchmarkTerrain.values()].filter((block) => block === BLOCK.SAND).length,
  gravelBlockCount: [...benchmarkTerrain.values()].filter((block) => block === BLOCK.GRAVEL).length,
}));
console.log("lakecraft terrain tests: ok");
