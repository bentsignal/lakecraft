import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { NATURAL_BLOCK_STATE_TYPES } from "../shared/expandedBuildingCatalog.ts";
import { BLOCK_TYPES } from "../shared/protocol.ts";
import { WORLD_CHUNK_BLOCK_TYPES } from "../shared/worldChunks.ts";
import { isWorldTerrainDescriptor } from "../shared/worldPreset.ts";
import { blockContainsSolidPoint } from "../client/game/blockGeometry.ts";
import { blockTextureForFace } from "../client/game/blockTextures.ts";
import { skyOccluderClass } from "../client/game/skyExposure.ts";
import {
  TERRAIN_SEA_LEVEL,
  blockKey,
  createTerrainRegion,
  raycastVoxels,
  terrainBiome,
  terrainHeight,
} from "../client/game/terrain.ts";
import { BLOCK } from "../client/game/types.ts";
import { WATER_EXIT_SPEED, blockFaceIsOccluded, blockHasCollision, waterVerticalVelocity } from "../client/game/voxelEngine.ts";

const SEED = 7_319;
const V2 = { preset: "default", superflatGroundY: 20, generatorVersion: 2 } as const;
const V3 = { preset: "default", superflatGroundY: 20, generatorVersion: 3 } as const;

assert.deepEqual(
  [...createTerrainRegion(SEED, -12, 12, -12, 12, { terrain: V2 })],
  [...createTerrainRegion(SEED, -12, 12, -12, 12)],
  "legacy version-2 worlds retain the exact shipped base terrain",
);
assert.equal(isWorldTerrainDescriptor(V2), true);
assert.equal(isWorldTerrainDescriptor(V3), true);
assert.equal(isWorldTerrainDescriptor({ ...V3, generatorVersion: 4 }), false);
assert.deepEqual(BLOCK_TYPES.slice(-NATURAL_BLOCK_STATE_TYPES.length), NATURAL_BLOCK_STATE_TYPES);
assert.deepEqual(WORLD_CHUNK_BLOCK_TYPES.slice(-NATURAL_BLOCK_STATE_TYPES.length), NATURAL_BLOCK_STATE_TYPES);
assert.deepEqual(NATURAL_BLOCK_STATE_TYPES.map((state) => BLOCK[state.toUpperCase() as keyof typeof BLOCK]),
  [753, 754, 755, 756, 757, 758, 759, 760, 761, 762, 763, 764, 765, 766, 767, 768],
  "natural and derived-fluid IDs append without renumbering any shipped state");

const startedAt = performance.now();
const whole = createTerrainRegion(SEED, -64, 63, -64, 63, { terrain: V3 });
const generationMs = performance.now() - startedAt;
const west = createTerrainRegion(SEED, -64, -1, -64, 63, { terrain: V3 });
const east = createTerrainRegion(SEED, 0, 63, -64, 63, { terrain: V3 });
assert.deepEqual([...new Map([...west, ...east])].sort(), [...whole].sort(),
  "biomes, lakes, plants, cacti, and trees remain seamless across chunk-style splits");
assert.deepEqual(
  [...createTerrainRegion(SEED, -64, 63, -64, 63, { terrain: V3 })], [...whole],
  "the biome generator is byte-for-byte deterministic",
);

let minimum = Infinity; let maximum = -Infinity; let desertColumns = 0;
for (let x = -64; x <= 63; x += 1) for (let z = -64; z <= 63; z += 1) {
  const height = terrainHeight(x, z, SEED, V3);
  minimum = Math.min(minimum, height); maximum = Math.max(maximum, height);
  desertColumns += +(terrainBiome(x, z, SEED, V3) === "desert");
}
assert.equal(terrainHeight(0, 0, SEED, V3), 68, "new worlds keep the safe spawn plateau");
assert.ok(minimum <= 62 && maximum >= 84, `expected lakes and mountains, received ${minimum}..${maximum}`);
assert.ok(desertColumns > 2_000, `expected a broad desert, received ${desertColumns} columns`);

const counts = new Map<number, number>();
for (const block of whole.values()) counts.set(block, (counts.get(block) ?? 0) + 1);
assert.ok((counts.get(BLOCK.WATER) ?? 0) >= 100, "lowland basins fill with a visible water surface");
assert.ok((counts.get(BLOCK.CACTUS) ?? 0) >= 40, "deserts contain sparse multi-block cacti");
assert.ok((counts.get(BLOCK.SHORT_GRASS) ?? 0) >= 300, "plains contain short grass");
assert.ok((counts.get(BLOCK.DANDELION) ?? 0) >= 30, "plains contain dandelions");
assert.ok((counts.get(BLOCK.POPPY) ?? 0) >= 30, "plains contain poppies");
for (const [key, block] of whole) {
  if (block !== BLOCK.WATER) continue;
  const [x, y, z] = key.split(",").map(Number);
  assert.ok(y <= TERRAIN_SEA_LEVEL && y > terrainHeight(x, z, SEED, V3));
}

assert.equal(blockHasCollision(BLOCK.WATER), false);
assert.equal(blockHasCollision(BLOCK.SHORT_GRASS), false);
assert.equal(blockHasCollision(BLOCK.CACTUS), true);
assert.equal(blockContainsSolidPoint(BLOCK.WATER, 65, 65.5), false);
assert.equal(skyOccluderClass(BLOCK.WATER), 0);
assert.equal(blockFaceIsOccluded(BLOCK.WATER, BLOCK.WATER), true);
assert.equal(blockTextureForFace(BLOCK.WATER, "top"), "water");
assert.equal(blockTextureForFace(BLOCK.CACTUS, "north"), "cactus");
assert.ok(waterVerticalVelocity(0, true, false, 0.05) > 0, "jumping swims upward");
let exitVelocity = 0; let exitHeight = 0;
for (let frame = 0; frame < 30 && exitHeight < 1.1; frame += 1) {
  const inSurfaceWater = exitHeight < .86;
  exitVelocity = inSurfaceWater
    ? waterVerticalVelocity(exitVelocity, true, false, 1 / 60, true)
    : exitVelocity - 32 / 60;
  exitHeight += exitVelocity / 60;
}
assert.ok(exitHeight >= 1, `surface jump clears a one-block shore (${exitHeight.toFixed(3)})`);
assert.equal(WATER_EXIT_SPEED, 6.5);
assert.ok(waterVerticalVelocity(0, false, true, 0.05) < 0, "sneaking swims downward");
const throughWater = raycastVoxels([0.5, 65.5, 0.5], [1, 0, 0], (x) =>
  x === 1 ? BLOCK.WATER : x === 2 ? BLOCK.STONE : BLOCK.AIR, 4);
assert.equal(throughWater?.block.x, 2, "interaction rays pass through water to solid blocks");

assert.ok(generationMs < 3_000, `128x128 biome generation took ${generationMs.toFixed(1)}ms`);
console.log(JSON.stringify({ generationMs, minimum, maximum, desertColumns, counts: Object.fromEntries(counts) }));
console.log("lakecraft biome terrain tests: ok");
