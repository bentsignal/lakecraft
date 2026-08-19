import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { takeFluidQueueBatch } from "../client/game/fluids.ts";
import { appendFluidBlockMesh } from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const ocean = new Map<string, BlockId>();
for (let x = 0; x < 64; x += 1) for (let z = 0; z < 64; z += 1) {
  ocean.set(key(x, 64, z), BLOCK.WATER);
}
const getBlock = (x: number, y: number, z: number) => ocean.get(key(x, y, z)) ?? BLOCK.AIR;

const meshStartedAt = performance.now();
let vertices = 0;
for (let x = 0; x < 64; x += 1) for (let z = 0; z < 64; z += 1) {
  const output: number[] = [];
  appendFluidBlockMesh(output, x, 64, z, BLOCK.WATER, getBlock, 1, 15);
  vertices += output.length / 6;
}
const meshMs = performance.now() - meshStartedAt;
assert.ok(vertices >= 64 * 64 * 6, "every ocean cell retains its visible top surface");
assert.ok(meshMs < 1_000, `64x64 ocean meshing exceeded the 1s regression ceiling (${meshMs.toFixed(1)}ms)`);

const queue = new Set(Array.from({ length: 100_000 }, (_value, index) => `q${index}`));
const queueStartedAt = performance.now();
for (let tick = 0; tick < 100; tick += 1) takeFluidQueueBatch(queue, 24);
const queueMs = performance.now() - queueStartedAt;
assert.equal(queue.size, 97_600);
assert.ok(queueMs < 250, `bounded fluid dequeue regressed (${queueMs.toFixed(1)}ms)`);

console.log(JSON.stringify({ meshMs, queueMs, vertices }));
console.log("fluid performance benchmark passed");
