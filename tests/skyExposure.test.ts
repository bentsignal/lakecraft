import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { chunkWindow } from "../client/game/chunks.ts";
import { sampleDayNight, type DayNightState } from "../client/game/dayNight.ts";
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

for (const red of [0, 0.123456, 0.57, 1]) {
  for (let exposure = 0; exposure <= SKY_EXPOSURE_LEVELS; exposure += 1) {
    const retained = new Float32Array([packSkyExposureShade(red, exposure)])[0];
    const unpacked = unpackSkyExposureShade(retained);
    assert.equal(unpacked.exposureLevel, exposure);
    assert.ok(Math.abs(unpacked.faceShade - red) < 0.000002, "Float32 color packing preserves authored tint");
  }
}

function skyLitColorChannel(
  channel: number,
  surfaceIntensity: number,
  exposureLevel: number,
  torchIntensity = 0,
  lightingEnabled = true,
): number {
  return lightingEnabled ? channel * (skyLitIntensity(surfaceIntensity, exposureLevel) + torchIntensity) : channel;
}

function surfaceLighting(state: Readonly<DayNightState>): readonly [number, number, number] {
  return [
    0.16 + state.ambientR * state.ambientIntensity * 0.75
      + state.directionalR * state.directionalIntensity * 0.30,
    0.16 + state.ambientG * state.ambientIntensity * 0.75
      + state.directionalG * state.directionalIntensity * 0.30,
    0.16 + state.ambientB * state.ambientIntensity * 0.75
      + state.directionalB * state.directionalIntensity * 0.30,
  ];
}

const cycle = { cycleLengthMs: 1_000, epochMs: 10_000, epochPhase: 0 };
const midnightSurface = surfaceLighting(sampleDayNight(10_000, cycle));
const noonSurface = surfaceLighting(sampleDayNight(10_500, cycle));
const white = [1, 1, 1] as const;
const roofedAtMidnight = white.map((channel, index) =>
  skyLitColorChannel(channel, midnightSurface[index], 0));
const roofedAtNoon = white.map((channel, index) =>
  skyLitColorChannel(channel, noonSurface[index], 0));
assert.deepEqual(roofedAtMidnight, [CAVE_LIGHT_FLOOR, CAVE_LIGHT_FLOOR, CAVE_LIGHT_FLOOR]);
assert.deepEqual(roofedAtNoon, roofedAtMidnight,
  "fully roofed colored vertices remain on the same cave floor from midnight through noon");

const doorTint = [0.57, 0.34, 0.14] as const;
const roofedDoor = doorTint.map((channel, index) =>
  skyLitColorChannel(channel, noonSurface[index], 0));
for (let index = 0; index < doorTint.length; index += 1) {
  assert.ok(Math.abs(roofedDoor[index] - doorTint[index] * CAVE_LIGHT_FLOOR) < 1e-12,
    "cave lighting scales rather than discards authored special-mesh tint");
}
const surfaceAtMidnight = doorTint.map((channel, index) =>
  skyLitColorChannel(channel, midnightSurface[index], 3));
const surfaceAtNoon = doorTint.map((channel, index) =>
  skyLitColorChannel(channel, noonSurface[index], 3));
assert.ok(surfaceAtNoon[0] > surfaceAtMidnight[0] * 3,
  "fully exposed colored meshes preserve the existing day/night response");
for (let exposure = 1; exposure < SKY_EXPOSURE_LEVELS; exposure += 1) {
  const entrance = skyLitColorChannel(doorTint[0], noonSurface[0], exposure);
  assert.ok(entrance > roofedDoor[0] && entrance < surfaceAtNoon[0],
    "entrance exposure levels stay between the cave floor and surface light");
}
const torchContribution = [0.18, 0.08, 0.02] as const;
const torchLitMidnight = doorTint.map((channel, index) =>
  skyLitColorChannel(channel, midnightSurface[index], 0, torchContribution[index]));
const torchLitNoon = doorTint.map((channel, index) =>
  skyLitColorChannel(channel, noonSurface[index], 0, torchContribution[index]));
assert.deepEqual(torchLitNoon, torchLitMidnight,
  "torch contribution remains exposure-independent inside fully roofed caves");
assert.ok(torchLitNoon.every((channel, index) => channel > roofedDoor[index]));
assert.deepEqual(
  doorTint.map((channel, index) => skyLitColorChannel(channel, noonSurface[index], 0, 1, false)),
  doorTint,
  "lighting-disabled first-person colors bypass both packed daylight and torch math",
);

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
