import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { chunkWindow } from "../client/game/chunks.ts";
import { blockKey, createTerrainChunk, TERRAIN_MIN_Y } from "../client/game/terrain.ts";
import {
  CAVE_LIGHT_FLOOR,
  SKY_EXPOSURE_LEVELS,
  SKY_EXPOSURE_SPILL_RADIUS,
  blockStopsSky,
  packSkyExposureShade,
  refreshEditedSkyColumns,
  removeChunkSkyOccluders,
  skyExposureDirtyChunkKeysForEdits,
  skyExposureLevel,
  skyLitIntensity,
  unpackSkyExposureShade,
  writeChunkSkyOccluders,
  type SkyOccluderColumns,
} from "../client/game/skyExposure.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";

const roof = new Map<string, BlockId>();
for (let x = 0; x < 8; x += 1) {
  for (let z = 0; z < 8; z += 1) roof.set(blockKey(x, 5, z), BLOCK.STONE);
}
const columns: SkyOccluderColumns = new Map();
writeChunkSkyOccluders(columns, 0, 0, roof);
assert.equal(columns.size, 64, "one streamed chunk caches exactly one top per column");
assert.equal(skyExposureLevel(columns, 3, 0, 3), 0, "a fully roofed interior is dark");
assert.equal(skyExposureLevel(columns, 3, 6, 3), 3, "the surface above the roof sees full sky");

const readRoof = (x: number, y: number, z: number) => roof.get(blockKey(x, y, z)) ?? BLOCK.AIR;
roof.delete(blockKey(0, 5, 3));
assert.equal(
  refreshEditedSkyColumns(columns, [{ x: 0, z: 3 }, { x: 0, z: 3 }], readRoof),
  1,
  "duplicate block edits refresh their shared column once",
);
assert.equal(columns.get("0,3"), TERRAIN_MIN_Y - 1, "removing the roof refreshes the cached top");
assert.equal(skyExposureLevel(columns, 0, 0, 3), 3, "an open shaft receives daylight");
assert.equal(skyExposureLevel(columns, 1, 0, 3), 2, "the first entrance column has bounded spill");
assert.equal(skyExposureLevel(columns, 2, 0, 3), 1, "the second entrance column has weaker spill");
assert.equal(skyExposureLevel(columns, 3, 0, 3), 0, "the third roofed column is outside the spill radius");

roof.set(blockKey(0, 5, 3), BLOCK.STONE);
refreshEditedSkyColumns(columns, [{ x: 0, z: 3 }], readRoof);
assert.equal(columns.get("0,3"), 5, "replacing the roof closes the shaft deterministically");
assert.equal(skyExposureLevel(columns, 0, 0, 3), 0);

assert.equal(SKY_EXPOSURE_LEVELS, 3);
assert.equal(SKY_EXPOSURE_SPILL_RADIUS, 2);
assert.equal(skyLitIntensity(1.0, 0), CAVE_LIGHT_FLOOR);
assert.equal(skyLitIntensity(0.24, 0), CAVE_LIGHT_FLOOR,
  "a fully roofed cave does not brighten when surface daylight increases");
assert.equal(skyLitIntensity(1.0, 3), 1);
assert.equal(skyLitIntensity(0.24, 3), 0.24);
assert.ok(skyLitIntensity(1.0, 2) > skyLitIntensity(1.0, 1), "entrance levels transition monotonically");
assert.ok(CAVE_LIGHT_FLOOR < 0.08, "the fixed cave floor remains substantially dark");

for (const faceShade of [0.52, 0.68, 0.73, 0.79, 0.88, 1]) {
  for (let exposure = 0; exposure <= SKY_EXPOSURE_LEVELS; exposure += 1) {
    const unpacked = unpackSkyExposureShade(packSkyExposureShade(faceShade, exposure));
    assert.ok(Math.abs(unpacked.faceShade - faceShade) < 1e-12);
    assert.equal(unpacked.exposureLevel, exposure);
    assert.equal(unpacked.emissive, false);
  }
}
assert.deepEqual(unpackSkyExposureShade(0.73), { faceShade: 0.73, exposureLevel: 3, emissive: false },
  "unmarked first-person texture shades retain full exposure");
const emissiveShade = unpackSkyExposureShade(packSkyExposureShade(0.73, 0, true));
assert.ok(Math.abs(emissiveShade.faceShade - 0.73) < 1e-12);
assert.equal(emissiveShade.exposureLevel, 0);
assert.equal(emissiveShade.emissive, true, "the furnace-front emissive bit is independent of sky exposure");

for (const opaque of [BLOCK.STONE, BLOCK.FURNACE, BLOCK.CHEST, BLOCK.LEAVES]) {
  assert.equal(blockStopsSky(opaque), true);
}
for (const transmitting of [
  BLOCK.AIR, BLOCK.TORCH, BLOCK.GLASS, BLOCK.LADDER, BLOCK.DOOR_OPEN,
  BLOCK.SAPLING, BLOCK.OAK_FENCE, BLOCK.OAK_FENCE_GATE_CLOSED, BLOCK.STONE_BRICK_SLAB,
]) {
  assert.equal(blockStopsSky(transmitting), false);
}

assert.deepEqual(skyExposureDirtyChunkKeysForEdits([{ x: 3, z: 3 }]), ["0,0"]);
assert.deepEqual(
  skyExposureDirtyChunkKeysForEdits([{ x: 7, z: 7 }, { x: 7, z: 7 }]).sort(),
  ["0,0", "0,1", "1,0", "1,1"],
  "a seam edit invalidates only the four chunks touched by the two-column fringe",
);
assert.deepEqual(
  skyExposureDirtyChunkKeysForEdits([{ x: -8, z: 2 }]).sort(),
  ["-1,0", "-2,0"],
  "negative-coordinate seam invalidation stays globally anchored",
);

const benchmarkStartedAt = performance.now();
let exposureChecksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  exposureChecksum += skyExposureLevel(columns, index & 7, index % 7, (index >>> 3) & 7);
}
const benchmarkMs = performance.now() - benchmarkStartedAt;
assert.ok(exposureChecksum >= 0);
assert.ok(benchmarkMs < 250, `100k cached exposure probes took ${benchmarkMs.toFixed(1)}ms`);

const streamedChunks = chunkWindow(0, 0).map(({ x, z }) => ({
  x,
  z,
  blocks: createTerrainChunk(7_319, x, z),
}));
const streamingColumns: SkyOccluderColumns = new Map();
const cacheStartedAt = performance.now();
for (const chunk of streamedChunks) {
  writeChunkSkyOccluders(streamingColumns, chunk.x, chunk.z, chunk.blocks);
}
const cacheMs = performance.now() - cacheStartedAt;
assert.equal(streamingColumns.size, streamedChunks.length * 64);
assert.ok(cacheMs < 120, `49-chunk exposure cache build took ${cacheMs.toFixed(1)}ms`);
console.log(JSON.stringify({
  benchmark: "bounded cached sky exposure",
  probes: 100_000,
  elapsedMs: Number(benchmarkMs.toFixed(2)),
  cachedColumns: columns.size,
  streamingColumns: streamingColumns.size,
  streamingCacheMs: Number(cacheMs.toFixed(2)),
}));

removeChunkSkyOccluders(columns, 0, 0);
assert.equal(columns.size, 0, "unloading a chunk releases exactly its cached columns");
console.log("lakecraft cheap sky-exposure tests: ok");
