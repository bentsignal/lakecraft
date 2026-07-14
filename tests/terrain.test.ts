import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { blockKey, createTerrain, createTerrainRegion, terrainHeight } from "../client/game/terrain.ts";
import { BLOCK } from "../client/game/types.ts";

const SEED = 7319;

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

// Every terrain column has a grass cap, dirt subsoil, and stone foundation.
for (let x = -18; x <= 18; x += 1) {
  for (let z = -18; z <= 18; z += 1) {
    const top = terrainHeight(x, z, SEED);
    assert.ok(top >= 3 && top <= 11, `height ${top} at ${x},${z} is outside generation bounds`);
    assert.equal(first.get(blockKey(x, top, z)), BLOCK.GRASS);
    assert.equal(first.get(blockKey(x, top - 1, z)), BLOCK.DIRT);
    assert.equal(first.get(blockKey(x, top - 2, z)), BLOCK.DIRT);
    assert.equal(first.get(blockKey(x, 0, z)), BLOCK.STONE);
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
}));
console.log("lakecraft terrain tests: ok");
