import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { BLOCK } from "../client/game/types.ts";
import {
  CLAY_SPAWN_SANCTUARY_RADIUS,
  TERRAIN_MIN_Y,
  blockKey,
  createTerrainChunk,
  createTerrainRegion,
  terrainBaseBlock,
  terrainClayBlock as clientClayBlock,
  terrainClayDepth,
  terrainGravelBlock,
  terrainHeight,
  terrainOreBlock,
} from "../client/game/terrain.ts";
import {
  WORLD_TERRAIN_SEED,
  naturalWorldBlockAt,
  terrainClayBlock as authoritativeClayBlock,
  terrainClayDepth as authoritativeClayDepth,
} from "../shared/worldTerrainAuthority.ts";

const SEED = WORLD_TERRAIN_SEED;

for (const seed of [1, 42, SEED, 999_999]) {
  for (let x = -CLAY_SPAWN_SANCTUARY_RADIUS; x <= CLAY_SPAWN_SANCTUARY_RADIUS; x += 1) {
    for (let z = -CLAY_SPAWN_SANCTUARY_RADIUS; z <= CLAY_SPAWN_SANCTUARY_RADIUS; z += 1) {
      assert.equal(terrainClayDepth(x, z, seed), 0, `clay intruded into spawn sanctuary at ${x},${z}`);
      assert.equal(authoritativeClayDepth(x, z, seed), 0);
    }
  }
}
assert.equal(terrainClayDepth(Number.NaN, 0, SEED), 0);
assert.equal(terrainClayDepth(0, Number.POSITIVE_INFINITY, SEED), 0);
assert.equal(clientClayBlock(0.5, 0, 0, SEED), null);
assert.equal(authoritativeClayBlock(0, 0.5, 0, SEED), null);

let eligibleColumns = 0;
let clayColumns = 0;
let twoDeepColumns = 0;
let threeDeepColumns = 0;
let candidateClayBlocks = 0;
let survivingClayBlocks = 0;
let caveCarvedClayBlocks = 0;
let dirtReplacements = 0;
let stoneReplacements = 0;
for (let x = -80; x <= 80; x += 1) {
  for (let z = -80; z <= 80; z += 1) {
    if (Math.max(Math.abs(x), Math.abs(z)) > CLAY_SPAWN_SANCTUARY_RADIUS) eligibleColumns += 1;
    const depth = terrainClayDepth(x, z, SEED);
    assert.equal(authoritativeClayDepth(x, z, SEED), depth, `clay footprint drift at ${x},${z}`);
    if (depth === 0) continue;
    clayColumns += 1;
    if (depth === 2) twoDeepColumns += 1;
    else threeDeepColumns += 1;
    const top = terrainHeight(x, z, SEED);
    assert.notEqual(clientClayBlock(x, top, z, SEED), BLOCK.CLAY, "clay must not replace surface grass");
    assert.equal(clientClayBlock(x, top - depth - 1, z, SEED), null, "clay lens exceeded its bounded depth");
    for (let y = top - depth; y < top; y += 1) {
      const client = clientClayBlock(x, y, z, SEED);
      const authoritative = authoritativeClayBlock(x, y, z, SEED);
      assert.equal(client === BLOCK.CLAY, authoritative === "clay", `clay authority drift at ${x},${y},${z}`);
      if (client !== BLOCK.CLAY) continue;
      candidateClayBlocks += 1;
      assert.ok(y > TERRAIN_MIN_Y, "shallow clay must never alter the world foundation");
      const base = terrainBaseBlock(x, y, z, SEED);
      assert.ok(base === BLOCK.DIRT || base === BLOCK.STONE, "clay replaced an ineligible natural stratum");
      assert.equal(terrainGravelBlock(x, y, z, SEED), null, "clay must not replace gravel");
      assert.equal(terrainOreBlock(x, y, z, SEED), null, "clay must not replace ore");
      if (base === BLOCK.DIRT) dirtReplacements += 1;
      else stoneReplacements += 1;
      const natural = naturalWorldBlockAt(x, y, z, SEED);
      assert.ok(natural === "clay" || natural === "air", `unexpected post-cave clay result ${natural}`);
      if (natural === "clay") survivingClayBlocks += 1;
      else caveCarvedClayBlocks += 1;
    }
  }
}

const density = clayColumns / eligibleColumns;
assert.equal(clayColumns, 605, "the deterministic clay footprint golden changed");
assert.equal(twoDeepColumns, 311);
assert.equal(threeDeepColumns, 294);
assert.equal(candidateClayBlocks, 1_463);
assert.equal(survivingClayBlocks, 1_463);
assert.equal(caveCarvedClayBlocks, 0, "shallow clay remains above the shifted cave ceiling");
assert.equal(dirtReplacements, 1_293);
assert.equal(stoneReplacements, 170);
assert.ok(density >= 0.015 && density <= 0.035,
  `clay column density ${(density * 100).toFixed(2)}% escaped its rare 1.5–3.5% budget`);
assert.equal(clientClayBlock(-76, 68, -17, SEED), BLOCK.CLAY);
assert.equal(authoritativeClayBlock(-76, 68, -17, SEED), "clay");
assert.equal(naturalWorldBlockAt(-76, 68, -17, SEED), "clay", "known visible clay authority anchor drifted");

// These two 2x2 chunk windows contain clay crossing x=16 and z=32. Each
// independently generated chunk quartet must reproduce its whole region.
function assertMergedChunks(
  whole: Map<string, number>,
  chunkCoordinates: ReadonlyArray<readonly [number, number]>,
): void {
  const independentlyGenerated = new Map(chunkCoordinates.flatMap(
    ([chunkX, chunkZ]) => [...createTerrainChunk(SEED, chunkX, chunkZ)],
  ));
  assert.deepEqual(
    [...independentlyGenerated].sort(([left], [right]) => left.localeCompare(right)),
    [...whole].sort(([left], [right]) => left.localeCompare(right)),
    "clay-bearing chunks must merge byte-for-byte without terrain seams",
  );
}
const xSeamWhole = createTerrainRegion(SEED, 8, 23, -40, -25, { minimumY: TERRAIN_MIN_Y });
assertMergedChunks(xSeamWhole, [[1, -5], [2, -5], [1, -4], [2, -4]]);
const zSeamWhole = createTerrainRegion(SEED, -24, -9, 24, 39, { minimumY: TERRAIN_MIN_Y });
assertMergedChunks(zSeamWhole, [[-3, 3], [-2, 3], [-3, 4], [-2, 4]]);
let xSeamPairs = 0;
let zSeamPairs = 0;
for (const [key, block] of xSeamWhole) {
  if (block !== BLOCK.CLAY) continue;
  const [x, y, z] = key.split(",").map(Number);
  if (x === 15 && xSeamWhole.get(blockKey(16, y, z)) === BLOCK.CLAY) xSeamPairs += 1;
}
for (const [key, block] of zSeamWhole) {
  if (block !== BLOCK.CLAY) continue;
  const [x, y, z] = key.split(",").map(Number);
  if (z === 31 && zSeamWhole.get(blockKey(x, y, 32)) === BLOCK.CLAY) zSeamPairs += 1;
}
assert.ok(xSeamPairs > 0, "fixture must exercise a clay lens crossing an x chunk seam");
assert.ok(zSeamPairs > 0, "fixture must exercise a clay lens crossing a z chunk seam");

const startedAt = performance.now();
const benchmark = createTerrainRegion(SEED, -40, 40, -40, 40);
const generationMs = performance.now() - startedAt;
assert.ok(benchmark.size > 50_000);
assert.ok(generationMs < 350, `clay-aware radius-40 generation took ${generationMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  benchmark: "globally anchored shallow clay deposits",
  generationMs: Number(generationMs.toFixed(2)),
  clayColumns,
  eligibleColumns,
  density: Number(density.toFixed(6)),
  candidateClayBlocks,
  survivingClayBlocks,
  caveCarvedClayBlocks,
  dirtReplacements,
  stoneReplacements,
  xSeamPairs,
  zSeamPairs,
}));
console.log("lakecraft deterministic clay terrain tests: ok");
