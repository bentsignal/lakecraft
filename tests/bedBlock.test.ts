import assert from "node:assert/strict";
import {
  BED_MESH_VERTEX_COUNT,
  BED_FOOT_MESH_VERTEX_COUNT,
  BED_HEAD_MESH_VERTEX_COUNT,
  appendBedMesh,
  blockHasCollision,
  blockOccludesFaces,
  tryInteractBlock,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockTarget } from "../client/game/types.ts";

assert.equal(BLOCK.BED, 12);
assert.equal(blockHasCollision(BLOCK.BED), true);
assert.equal(blockOccludesFaces(BLOCK.BED), false, "a partial bed cannot hide the supporting block or neighboring terrain");

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

for (const direction of ["north", "south", "east", "west"] as const) {
  const foot: number[] = [];
  const head: number[] = [];
  appendBedMesh(foot, 0, 0, 0, "foot", direction);
  appendBedMesh(head, 0, 0, 0, "head", direction);
  assert.equal(foot.length / 6, BED_FOOT_MESH_VERTEX_COUNT);
  assert.equal(head.length / 6, BED_HEAD_MESH_VERTEX_COUNT);
  assert.equal(foot.some((_, index) => index % 6 === 3 && foot[index] > 0.8 && foot[index + 1] > 0.8), true,
    "the one paired mesh includes the head pillow");
  assert.equal(head.length, 0, "the head cell emits no duplicate body or center faces");
  const lengthAxis = direction === "east" || direction === "west" ? 0 : 2;
  const widthAxis = lengthAxis === 0 ? 2 : 0;
  const seam = direction === "east" || direction === "south" ? 1 : 0;
  const positions = foot.filter((_, index) => index % 6 === lengthAxis);
  assert.equal(positions.some((value) => Math.abs(value - seam) < 1e-9), false,
    `${direction} paired geometry has no face or vertex plane at its cell seam`);
  const widths = foot.filter((_, index) => index % 6 === widthAxis);
  assert.ok(Math.max(...widths) - Math.min(...widths) <= 0.84 + 1e-9,
    `${direction} bed frame stays visibly narrower than a full block`);
}

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
