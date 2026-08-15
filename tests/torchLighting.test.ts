import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  BLOCK,
  MAX_ACTIVE_TORCH_LIGHTS,
  TORCH_MESH_VERTEX_COUNT,
  appendTorchMesh,
  blockHasCollision,
  blockOccludesFaces,
  isTorchBlock,
  selectNearestTorchLights,
  torchPlacementBlock,
} from "../client/game/index.ts";

const lights = [
  { x: 8, y: 1, z: 0 },
  { x: 2, y: 1, z: 0 },
  { x: -2, y: 1, z: 0 },
  { x: 4, y: 1, z: 0 },
  { x: 80, y: 1, z: 0 },
];
assert.deepEqual(selectNearestTorchLights(lights, [0, 1, 0], 3, 11), [
  { x: -2, y: 1, z: 0 },
  { x: 2, y: 1, z: 0 },
  { x: 4, y: 1, z: 0 },
]);
assert.equal(selectNearestTorchLights(lights, [0, 1, 0], 99, 11).length, 4);
assert.equal(selectNearestTorchLights(lights, [0, 1, 0], 99).length, 5,
  "visible torches are not disabled merely because the camera is outside their illumination radius");
assert.equal(selectNearestTorchLights(lights, [0, 1, 0], 0, 11).length, 0);
assert.ok(selectNearestTorchLights(lights, [0, 1, 0], 99, 11).length <= MAX_ACTIVE_TORCH_LIGHTS);

assert.equal(blockOccludesFaces(BLOCK.TORCH), false);
assert.equal(blockHasCollision(BLOCK.TORCH), false);
for (const wallTorch of [BLOCK.TORCH_WALL_EAST, BLOCK.TORCH_WALL_NORTH,
  BLOCK.TORCH_WALL_SOUTH, BLOCK.TORCH_WALL_WEST]) {
  assert.equal(isTorchBlock(wallTorch), true);
  assert.equal(blockHasCollision(wallTorch), false);
  assert.equal(blockOccludesFaces(wallTorch), false);
}
assert.equal(blockOccludesFaces(BLOCK.STONE), true);
assert.equal(blockHasCollision(BLOCK.STONE), true);
const support = { x: 2, y: 4, z: 5, block: BLOCK.STONE };
assert.equal(torchPlacementBlock({ block: support, place: { x: 3, y: 4, z: 5 }, distance: 2 }), BLOCK.TORCH_WALL_EAST);
assert.equal(torchPlacementBlock({ block: support, place: { x: 1, y: 4, z: 5 }, distance: 2 }), BLOCK.TORCH_WALL_WEST);
assert.equal(torchPlacementBlock({ block: support, place: { x: 2, y: 4, z: 6 }, distance: 2 }), BLOCK.TORCH_WALL_SOUTH);
assert.equal(torchPlacementBlock({ block: support, place: { x: 2, y: 4, z: 4 }, distance: 2 }), BLOCK.TORCH_WALL_NORTH);
assert.equal(torchPlacementBlock({ block: support, place: { x: 2, y: 5, z: 5 }, distance: 2 }), BLOCK.TORCH);

const vertices: number[] = [];
appendTorchMesh(vertices, 3, 4, 5);
assert.equal(vertices.length / 6, TORCH_MESH_VERTEX_COUNT);
for (let index = 0; index < vertices.length; index += 6) {
  assert.ok(vertices[index] >= 3.38 && vertices[index] <= 3.62);
  assert.ok(vertices[index + 1] >= 4 && vertices[index + 1] <= 4.88);
  assert.ok(vertices[index + 2] >= 5.38 && vertices[index + 2] <= 5.62);
}

const manyLights = Array.from({ length: 10_000 }, (_, index) => ({
  x: index % 101 - 50,
  y: index % 7,
  z: Math.floor(index / 101) - 50,
}));
const startedAt = performance.now();
for (let iteration = 0; iteration < 50; iteration += 1) {
  selectNearestTorchLights(manyLights, [iteration / 10, 3, 0], MAX_ACTIVE_TORCH_LIGHTS, 11);
}
const elapsedMs = performance.now() - startedAt;
assert.ok(elapsedMs < 150, `bounded torch selection took ${elapsedMs.toFixed(1)}ms`);

console.log(JSON.stringify({ benchmark: "bounded nearest torch selection", candidates: manyLights.length, iterations: 50, elapsedMs: Number(elapsedMs.toFixed(2)) }));
console.log("lakecraft torch lighting tests: ok");
