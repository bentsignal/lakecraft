import assert from "node:assert/strict";
import {
  BED_MESH_VERTEX_COUNT,
  appendBedMesh,
  blockHasCollision,
  blockOccludesFaces,
  tryInteractBlock,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockTarget } from "../client/game/types.ts";

assert.equal(BLOCK.BED, 12);
assert.equal(blockHasCollision(BLOCK.BED), true);
assert.equal(blockOccludesFaces(BLOCK.BED), true);

const mesh: number[] = [];
appendBedMesh(mesh, 0, 0, 0);
assert.equal(mesh.length / 6, BED_MESH_VERTEX_COUNT);
let maxY = -Infinity;
let redVertices = 0;
let whiteVertices = 0;
for (let offset = 0; offset < mesh.length; offset += 6) {
  maxY = Math.max(maxY, mesh[offset + 1]);
  const red = mesh[offset + 3];
  const green = mesh[offset + 4];
  const blue = mesh[offset + 5];
  if (red > green * 3) redVertices += 1;
  if (red > 0.45 && green > 0.45 && blue > 0.4) whiteVertices += 1;
}
assert.equal(maxY, 0.55);
assert.ok(redVertices > 0, "bed should have a red blanket");
assert.ok(whiteVertices > 0, "bed should have a white pillow");

const bedTarget: BlockTarget = {
  block: { x: 1, y: 2, z: 3, block: BLOCK.BED },
  place: { x: 1, y: 3, z: 3 },
  distance: 2,
};
let calls = 0;
assert.equal(tryInteractBlock(bedTarget, () => { calls += 1; return true; }), true);
assert.equal(calls, 1);
assert.equal(tryInteractBlock(bedTarget, () => false), false);

console.log("lakecraft bed block tests: ok");
