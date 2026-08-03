import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  DIAMOND_ORE_MAX_Y,
  DIAMOND_ORE_MIN_Y,
  DIAMOND_ORE_PEAK_MAX_Y,
  DIAMOND_ORE_PEAK_MIN_Y,
  diamondOreVeinChance,
} from "../shared/diamondTerrain.ts";
import { BLOCK } from "../client/game/types.ts";
import {
  blockKey,
  createTerrainChunk,
  createTerrainRegion,
  TERRAIN_MIN_Y,
} from "../client/game/terrain.ts";
import { materializeTerrainChunk } from "../client/game/voxelEngine.ts";

assert.equal(DIAMOND_ORE_MIN_Y, 1);
assert.equal(DIAMOND_ORE_MAX_Y, 20);
const clientTerrainSource = readFileSync(new URL("../client/game/terrain.ts", import.meta.url), "utf8");
const authorityTerrainSource = readFileSync(new URL("../shared/worldTerrainAuthority.ts", import.meta.url), "utf8");
assert.equal((clientTerrainSource.match(
  /diamondOreVeinChance\(generationAnchorY \+ TERRAIN_Y_OFFSET\)/g,
) ?? []).length, 2, "cached and uncached client generation pass post-shift absolute anchor world Y");
assert.equal((authorityTerrainSource.match(
  /diamondOreVeinChance\(generationAnchorY \+ WORLD_TERRAIN_Y_OFFSET\)/g,
) ?? []).length, 1, "shared server authority passes post-shift absolute anchor world Y");
for (const invalidY of [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NaN, 0, 1.5, 21]) {
  assert.equal(diamondOreVeinChance(invalidY), 0, `invalid anchor height ${invalidY} is ineligible`);
}
assert.deepEqual(
  Array.from({ length: 24 }, (_, index) => diamondOreVeinChance(index - 1) > 0 ? index - 1 : null)
    .filter((value) => value !== null),
  Array.from({ length: 20 }, (_, index) => index + 1),
  "every integer y=1..20, and no height outside it, remains eligible",
);
const chances = Array.from({ length: 20 }, (_, index) => diamondOreVeinChance(index + 1));
const peak = Math.max(...chances);
const activationMass = chances.reduce((total, chance) => total + chance, 0);
assert.ok(Math.abs(activationMass - 0.055 * 12) < 0.03,
  `depth redistribution changed the legacy diamond budget: ${activationMass}`);
assert.deepEqual(
  chances.flatMap((chance, index) => chance === peak ? [index + 1] : []),
  Array.from({ length: DIAMOND_ORE_PEAK_MAX_Y - DIAMOND_ORE_PEAK_MIN_Y + 1 }, (_, index) => index + DIAMOND_ORE_PEAK_MIN_Y),
  "the strongest vein activation frequency is y=8..10",
);
assert.ok(chances[0] > 0 && chances[19] > 0 && peak > chances[0] && peak > chances[19]);
for (let y = 2; y <= DIAMOND_ORE_PEAK_MIN_Y; y += 1) {
  assert.ok(diamondOreVeinChance(y) >= diamondOreVeinChance(y - 1), "frequency rises toward the peak");
}
for (let y = DIAMOND_ORE_PEAK_MAX_Y + 1; y <= DIAMOND_ORE_MAX_Y; y += 1) {
  assert.ok(diamondOreVeinChance(y) <= diamondOreVeinChance(y - 1), "frequency falls after the peak");
}

const SEED = 7_319;
const startedAt = performance.now();
const first = createTerrainRegion(SEED, -32, 31, -32, 31, { minimumY: TERRAIN_MIN_Y });
const second = createTerrainRegion(SEED, -32, 31, -32, 31, { minimumY: TERRAIN_MIN_Y });
assert.deepEqual([...first], [...second], "the same seed and bounds reproduce the same terrain ordering and blocks");
assert.notDeepEqual(
  [...first],
  [...createTerrainRegion(SEED + 1, -32, 31, -32, 31, { minimumY: TERRAIN_MIN_Y })],
  "changing the seed changes deterministic terrain",
);

// Measure real post-cave, post-overlap blocks over a broad deterministic sample,
// rather than treating the probability helper as proof of the placed result.
const histogramSeeds = Array.from({ length: 16 }, (_, index) => SEED + index * 7_919);
const histogramCenters = [[0, 0], [4_096, -4_096], [-100_000, 100_000], [1_000_000, -1_000_000]] as const;
const histogram = Array.from({ length: DIAMOND_ORE_MAX_Y + 1 }, () => 0);
let naturalDiamond: { entry: [string, typeof BLOCK.DIAMOND_ORE]; seed: number } | undefined;
for (const [index, seed] of histogramSeeds.entries()) {
  const [centerX, centerZ] = histogramCenters[index % histogramCenters.length];
  const region = createTerrainRegion(seed, centerX - 32, centerX + 31, centerZ - 32, centerZ + 31,
    { minimumY: TERRAIN_MIN_Y });
  for (const entry of region) {
    if (entry[1] !== BLOCK.DIAMOND_ORE) continue;
    naturalDiamond ??= { entry: entry as [string, typeof BLOCK.DIAMOND_ORE], seed };
    const y = Number(entry[0].split(",")[1]);
    assert.ok(y >= DIAMOND_ORE_MIN_Y && y <= DIAMOND_ORE_MAX_Y,
      `actual generated diamond escaped y=1..20 at ${entry[0]}`);
    histogram[y] += 1;
  }
}
const diamondCount = histogram.reduce((total, count) => total + count, 0);
// Captured from the identical 16-seed/four-center fixture at the reviewed
// f66018f translated legacy profile, not inferred from the helper's mass.
const legacyFixtureDiamondCount = 3_384;
assert.ok(diamondCount >= legacyFixtureDiamondCount * 0.85 && diamondCount <= legacyFixtureDiamondCount * 1.15,
  `actual diamond population ${diamondCount} remains within 15% of legacy ${legacyFixtureDiamondCount}`);
assert.ok(histogram.slice(1).every((count) => count > 0),
  `every actual y=1..20 layer retains a nonzero tail: ${histogram.slice(1)}`);
assert.ok(histogram[DIAMOND_ORE_MIN_Y] >= 40 && histogram[DIAMOND_ORE_MAX_Y] >= 20,
  `actual generated diamonds retain both y=1/y=20 tails: ${histogram[1]}/${histogram[20]}`);
const rankedLayers = Array.from({ length: 20 }, (_, index) => index + 1)
  .sort((left, right) => histogram[right] - histogram[left] || left - right);
assert.deepEqual(rankedLayers.slice(0, 3).sort((left, right) => left - right), [8, 9, 10],
  `the three strongest actual generated layers must be y=8..10: ${rankedLayers.slice(0, 5)}`);
const maximumOutsidePeak = Math.max(...histogram.filter((_count, y) => y < 8 || y > 10));
for (let y = 8; y <= 10; y += 1) {
  assert.ok(histogram[y] > maximumOutsidePeak,
    `actual peak layer y=${y} (${histogram[y]}) must beat every shoulder/tail (${maximumOutsidePeak})`);
}
const peakBandMean = (histogram[8] + histogram[9] + histogram[10]) / 3;
assert.ok(peakBandMean >= maximumOutsidePeak * 1.5,
  `actual y=8..10 mean ${peakBandMean.toFixed(1)} must decisively exceed outside max ${maximumOutsidePeak}`);

// Independently generated 8x8 chunks must merge exactly into a whole region,
// including real diamonds touching internal chunk seam coordinates.
const seamWhole = createTerrainRegion(1, -16, 15, -16, 15, { minimumY: TERRAIN_MIN_Y });
const seamChunks = new Map<string, (typeof BLOCK)[keyof typeof BLOCK]>();
for (let chunkX = -2; chunkX <= 1; chunkX += 1) {
  for (let chunkZ = -2; chunkZ <= 1; chunkZ += 1) {
    for (const entry of createTerrainChunk(1, chunkX, chunkZ)) seamChunks.set(...entry);
  }
}
assert.deepEqual([...seamChunks].sort(), [...seamWhole].sort(), "chunk generation agrees byte-for-byte across seams");
assert.ok([...seamWhole].some(([key, block]) => {
  if (block !== BLOCK.DIAMOND_ORE) return false;
  const [x, , z] = key.split(",").map(Number);
  return [-8, 0, 8].includes(x) || [-8, 0, 8].includes(z);
}), "the region-vs-chunks fixture must contain actual diamond on an internal chunk seam");

assert.ok(naturalDiamond, "broad actual histogram fixture provides a natural diamond for journal precedence");
const [diamondX, diamondY, diamondZ] = naturalDiamond!.entry[0].split(",").map(Number);
const diamondChunkX = Math.floor(diamondX / 8);
const diamondChunkZ = Math.floor(diamondZ / 8);
const diamondSeed = naturalDiamond!.seed;
const mined = materializeTerrainChunk(diamondSeed, diamondChunkX, diamondChunkZ, [
  { x: diamondX, y: diamondY, z: diamondZ, block: BLOCK.AIR },
  { x: diamondX, y: TERRAIN_MIN_Y, z: diamondZ, block: BLOCK.AIR },
]);
assert.equal(mined.has(blockKey(diamondX, diamondY, diamondZ)), false, "a saved mined-air override wins over regenerated diamond");
assert.equal(mined.get(blockKey(diamondX, TERRAIN_MIN_Y, diamondZ)), BLOCK.BEDROCK,
  "the canonical y=0 bedrock foundation wins over a mined-air journal override");
const replaced = materializeTerrainChunk(diamondSeed, diamondChunkX, diamondChunkZ, [
  { x: diamondX, y: diamondY, z: diamondZ, block: BLOCK.COBBLESTONE },
  { x: diamondX, y: TERRAIN_MIN_Y, z: diamondZ, block: BLOCK.COBBLESTONE },
]);
assert.equal(replaced.get(blockKey(diamondX, diamondY, diamondZ)), BLOCK.COBBLESTONE,
  "a saved placed-block override wins over regenerated diamond");
assert.equal(replaced.get(blockKey(diamondX, TERRAIN_MIN_Y, diamondZ)), BLOCK.BEDROCK,
  "the canonical y=0 bedrock foundation wins over a placed-block journal override");

const elapsedMs = performance.now() - startedAt;
assert.ok(elapsedMs < 3_000, `bounded actual distribution/seam/override sweep took ${elapsedMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  benchmark: "diamond depth distribution",
  diamonds: diamondCount,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  histogram: histogram.slice(1),
  peakY: [DIAMOND_ORE_PEAK_MIN_Y, DIAMOND_ORE_PEAK_MAX_Y],
}));
console.log("diamond depth distribution tests: ok");
