import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  CAVE_SPAWN_SANCTUARY_RADIUS,
  blockKey,
  createTerrainRegion,
  terrainBaseBlock,
  terrainHeight,
} from "../client/game/terrain.ts";
import { BLOCK } from "../client/game/types.ts";

const SEED = 7319;
const MIN = -32;
const MAX = 31;
const startedAt = performance.now();
const caves = createTerrainRegion(SEED, MIN, MAX, MIN, MAX);
const generationMs = performance.now() - startedAt;
assert.deepEqual([...createTerrainRegion(SEED, MIN, MAX, MIN, MAX)], [...caves]);

let naturalStone = 0;
let carvedStone = 0;
for (let x = MIN; x <= MAX; x += 1) {
  for (let z = MIN; z <= MAX; z += 1) {
    const top = terrainHeight(x, z, SEED);
    for (let y = 0; y <= top; y += 1) {
      const natural = terrainBaseBlock(x, y, z, SEED);
      const present = caves.get(blockKey(x, y, z));
      if (natural === BLOCK.STONE) {
        naturalStone += 1;
        if (present === undefined) carvedStone += 1;
      } else {
        assert.notEqual(present, undefined, `cave removed protected ${natural} at ${x},${y},${z}`);
      }
      if (y === 0) assert.notEqual(present, undefined, `cave breached the y=0 foundation at ${x},${z}`);
      if (Math.max(Math.abs(x), Math.abs(z)) <= CAVE_SPAWN_SANCTUARY_RADIUS) {
        assert.notEqual(present, undefined, `spawn sanctuary was carved at ${x},${y},${z}`);
      }
    }
  }
}
assert.ok(carvedStone > naturalStone * 0.04, `caves are too sparse: ${carvedStone}/${naturalStone}`);
assert.ok(carvedStone < naturalStone * 0.24, `caves removed too much terrain: ${carvedStone}/${naturalStone}`);

let exposedOre = 0;
for (const [key, block] of caves) {
  if (block !== BLOCK.COAL_ORE && block !== BLOCK.IRON_ORE) continue;
  const [x, y, z] = key.split(",").map(Number);
  const exposedToCarvedStone = [
    [x + 1, y, z], [x - 1, y, z], [x, y + 1, z],
    [x, y - 1, z], [x, y, z + 1], [x, y, z - 1],
  ].some(([nx, ny, nz]) => (
    terrainBaseBlock(nx, ny, nz, SEED) === BLOCK.STONE
    && !caves.has(blockKey(nx, ny, nz))
  ));
  if (exposedToCarvedStone) exposedOre += 1;
}
assert.ok(exposedOre >= 10, `expected cave walls to expose useful ore, received ${exposedOre}`);

// An arbitrary split cuts through the global cave graph rather than aligning to
// its ten-block cells. Independently carved halves must still equal the whole.
const west = createTerrainRegion(SEED, MIN, -3, MIN, MAX);
const east = createTerrainRegion(SEED, -2, MAX, MIN, MAX);
const merged = new Map([...west, ...east]);
assert.deepEqual(
  [...merged].sort(([left], [right]) => left.localeCompare(right)),
  [...caves].sort(([left], [right]) => left.localeCompare(right)),
  "cross-boundary cave tunnels must merge byte-for-byte",
);
let seamTunnelPairs = 0;
for (let y = 1; y <= 6; y += 1) {
  for (let z = MIN; z <= MAX; z += 1) {
    if (
      terrainBaseBlock(-3, y, z, SEED) === BLOCK.STONE
      && terrainBaseBlock(-2, y, z, SEED) === BLOCK.STONE
      && !caves.has(blockKey(-3, y, z))
      && !caves.has(blockKey(-2, y, z))
    ) seamTunnelPairs += 1;
  }
}
assert.ok(seamTunnelPairs > 0, "the seam test should exercise a tunnel crossing both halves");
assert.ok(generationMs < 250, `radius-32 cave terrain took ${generationMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  benchmark: "deterministic radius-32 cave terrain",
  generationMs: Number(generationMs.toFixed(2)),
  naturalStone,
  carvedStone,
  carvedPercent: Number((carvedStone / naturalStone * 100).toFixed(2)),
  exposedOre,
  seamTunnelPairs,
}));
console.log("lakecraft cave tests: ok");
