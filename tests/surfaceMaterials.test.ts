import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  SAND_SPAWN_SANCTUARY_RADIUS,
  blockKey,
  createTerrain,
  createTerrainRegion,
  terrainBaseBlock,
  terrainHeight,
  terrainSandDepth,
} from "../client/game/terrain.ts";
import { BLOCK } from "../client/game/types.ts";

const SEED = 7319;

assert.equal(BLOCK.COBBLESTONE, 17);
assert.equal(BLOCK.SAND, 18);
assert.equal(BLOCK.GLASS, 19);

for (const seed of [1, 42, SEED, 999_999]) {
  for (let x = -SAND_SPAWN_SANCTUARY_RADIUS; x <= SAND_SPAWN_SANCTUARY_RADIUS; x += 1) {
    for (let z = -SAND_SPAWN_SANCTUARY_RADIUS; z <= SAND_SPAWN_SANCTUARY_RADIUS; z += 1) {
      assert.equal(terrainSandDepth(x, z, seed), 0, `sand intruded into spawn sanctuary at ${x},${z}`);
    }
  }
}
assert.equal(terrainSandDepth(Number.NaN, 0, SEED), 0);
assert.equal(terrainSandDepth(0, Number.POSITIVE_INFINITY, SEED), 0);

const first = createTerrain(SEED, 40);
const repeated = createTerrain(SEED, 40);
assert.deepEqual([...repeated], [...first], "sand generation must be deterministic for equal seed and bounds");

let eligibleColumns = 0;
let sandColumns = 0;
let deepSandColumns = 0;
for (let x = -40; x <= 40; x += 1) {
  for (let z = -40; z <= 40; z += 1) {
    const distance = Math.max(Math.abs(x), Math.abs(z));
    const depth = terrainSandDepth(x, z, SEED);
    const top = terrainHeight(x, z, SEED);
    if (distance > SAND_SPAWN_SANCTUARY_RADIUS) eligibleColumns += 1;
    if (depth === 0) {
      assert.equal(terrainBaseBlock(x, top, z, SEED), BLOCK.GRASS);
      continue;
    }
    sandColumns += 1;
    if (depth === 3) deepSandColumns += 1;
    assert.ok(distance > SAND_SPAWN_SANCTUARY_RADIUS);
    assert.ok(depth === 2 || depth === 3, `sand depth ${depth} is not modest and bounded`);
    assert.equal(first.get(blockKey(x, top, z)), BLOCK.SAND);
    assert.equal(terrainBaseBlock(x, top + 1, z, SEED), BLOCK.AIR, "surface deposits must not change terrain height");
    for (let offset = 0; offset < depth; offset += 1) {
      assert.equal(terrainBaseBlock(x, top - offset, z, SEED), BLOCK.SAND);
      assert.equal(first.get(blockKey(x, top - offset, z)), BLOCK.SAND);
    }
    assert.notEqual(terrainBaseBlock(x, top - depth, z, SEED), BLOCK.SAND);
    assert.notEqual(first.get(blockKey(x, top + 1, z)), BLOCK.WOOD, "trees must not root on sand");
  }
}
const density = sandColumns / eligibleColumns;
assert.ok(sandColumns >= 250, `expected useful surface sand, received ${sandColumns} columns`);
assert.ok(density >= 0.03 && density <= 0.12, `sand density ${(density * 100).toFixed(2)}% escaped the 3–12% budget`);
assert.ok(deepSandColumns > 0 && deepSandColumns < sandColumns / 2, "three-deep deposits should be present but less common");

// Generate four quadrants independently. Global patch anchors, cave carving,
// and tree clipping must reproduce the exact whole-region map at both seams.
const whole = createTerrainRegion(SEED, -32, 31, -32, 31);
const quadrants = [
  createTerrainRegion(SEED, -32, -1, -32, -1),
  createTerrainRegion(SEED, 0, 31, -32, -1),
  createTerrainRegion(SEED, -32, -1, 0, 31),
  createTerrainRegion(SEED, 0, 31, 0, 31),
];
const merged = new Map(quadrants.flatMap((region) => [...region]));
assert.deepEqual(
  [...merged].sort(([left], [right]) => left.localeCompare(right)),
  [...whole].sort(([left], [right]) => left.localeCompare(right)),
  "independent surface regions must merge without sand seams",
);

const startedAt = performance.now();
const benchmark = createTerrain(SEED, 40);
const generationMs = performance.now() - startedAt;
assert.equal(benchmark.size, first.size);
assert.ok(generationMs < 250, `sand-aware radius-40 generation took ${generationMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  benchmark: "globally anchored sand deposits",
  generationMs: Number(generationMs.toFixed(2)),
  sandColumns,
  eligibleColumns,
  density: Number(density.toFixed(4)),
}));
console.log("lakecraft surface material tests: ok");
