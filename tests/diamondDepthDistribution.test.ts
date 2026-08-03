import assert from "node:assert/strict";
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
const first = createTerrainRegion(SEED, -64, 63, -64, 63, { minimumY: TERRAIN_MIN_Y });
const second = createTerrainRegion(SEED, -64, 63, -64, 63, { minimumY: TERRAIN_MIN_Y });
assert.deepEqual([...first], [...second], "the same seed and bounds reproduce the same terrain ordering and blocks");
assert.notDeepEqual(
  [...first],
  [...createTerrainRegion(SEED + 1, -64, 63, -64, 63, { minimumY: TERRAIN_MIN_Y })],
  "changing the seed changes deterministic terrain",
);
const diamondCells = [...first].filter((entry): entry is [string, typeof BLOCK.DIAMOND_ORE] => entry[1] === BLOCK.DIAMOND_ORE);
assert.ok(diamondCells.length >= 150 && diamondCells.length <= 600,
  `bounded 128x128 diamond population: ${diamondCells.length}`);
for (const [key] of diamondCells) {
  const y = Number(key.split(",")[1]);
  assert.ok(y >= DIAMOND_ORE_MIN_Y && y <= DIAMOND_ORE_MAX_Y, `diamond escaped vertical band at ${key}`);
}

// Independently generated 8x8 chunks must merge exactly into a whole region,
// including deposits touching x=7 and z=-8 ownership seams.
const seamWhole = createTerrainRegion(SEED, 0, 15, -16, 23, { minimumY: TERRAIN_MIN_Y });
const seamChunks = new Map<string, (typeof BLOCK)[keyof typeof BLOCK]>();
for (let chunkX = 0; chunkX <= 1; chunkX += 1) {
  for (let chunkZ = -2; chunkZ <= 2; chunkZ += 1) {
    for (const entry of createTerrainChunk(SEED, chunkX, chunkZ)) seamChunks.set(...entry);
  }
}
assert.deepEqual([...seamChunks].sort(), [...seamWhole].sort(), "chunk generation agrees byte-for-byte across seams");
assert.ok([...seamWhole].some(([key, block]) => {
  if (block !== BLOCK.DIAMOND_ORE) return false;
  const [x, , z] = key.split(",").map(Number);
  return x === 7 || z === -8;
}), "the seam fixture includes diamond ore on a chunk edge");

const naturalDiamond = diamondCells.find(([key]) => {
  const [x, , z] = key.split(",").map(Number);
  return x >= 0 && x < 8 && z >= -8 && z < 0;
});
assert.ok(naturalDiamond, "fixture provides a generated diamond in chunk 0:-1");
const [diamondX, diamondY, diamondZ] = naturalDiamond![0].split(",").map(Number);
const mined = materializeTerrainChunk(SEED, 0, -1, [
  { x: diamondX, y: diamondY, z: diamondZ, block: BLOCK.AIR },
]);
assert.equal(mined.has(blockKey(diamondX, diamondY, diamondZ)), false, "a saved mined-air override wins over regenerated diamond");
const replaced = materializeTerrainChunk(SEED, 0, -1, [
  { x: diamondX, y: diamondY, z: diamondZ, block: BLOCK.COBBLESTONE },
]);
assert.equal(replaced.get(blockKey(diamondX, diamondY, diamondZ)), BLOCK.COBBLESTONE,
  "a saved placed-block override wins over regenerated diamond");

const elapsedMs = performance.now() - startedAt;
assert.ok(elapsedMs < 2_000, `bounded distribution/seam/override sweep took ${elapsedMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  benchmark: "diamond depth distribution",
  diamonds: diamondCells.length,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  peakY: [DIAMOND_ORE_PEAK_MIN_Y, DIAMOND_ORE_PEAK_MAX_Y],
}));
console.log("diamond depth distribution tests: ok");
