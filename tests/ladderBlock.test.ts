import assert from "node:assert/strict";
import { raycastVoxels } from "../client/game/terrain.ts";
import {
  LADDER_MESH_VERTEX_COUNT,
  appendLadderMesh,
  blockHasCollision,
  blockMaterialColor,
  blockOccludesFaces,
} from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";

assert.equal(BLOCK.LADDER, 16, "ladder appends a stable persisted block ID");
assert.equal(blockHasCollision(BLOCK.LADDER), false, "players may occupy a ladder cell");
assert.equal(blockOccludesFaces(BLOCK.LADDER), false, "ladder does not hide neighboring cube faces");
assert.notDeepEqual(blockMaterialColor(BLOCK.LADDER), blockMaterialColor(BLOCK.PLANKS));

const mesh: number[] = [];
appendLadderMesh(mesh, 4, 5, 6);
assert.equal(mesh.length / 6, LADDER_MESH_VERTEX_COUNT);

let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
let lightWoodVertices = 0;
let darkWoodVertices = 0;
for (let offset = 0; offset < mesh.length; offset += 6) {
  minX = Math.min(minX, mesh[offset]);
  maxX = Math.max(maxX, mesh[offset]);
  minY = Math.min(minY, mesh[offset + 1]);
  maxY = Math.max(maxY, mesh[offset + 1]);
  minZ = Math.min(minZ, mesh[offset + 2]);
  maxZ = Math.max(maxZ, mesh[offset + 2]);
  const red = mesh[offset + 3];
  if (red > 0.48) lightWoodVertices += 1;
  else darkWoodVertices += 1;
}
assert.ok(minX >= 4 && maxX <= 5 && maxX - minX > 0.6, "rungs span most of the block width");
assert.ok(minY >= 5 && maxY <= 6 && maxY - minY > 0.9, "rails span almost the full block height");
assert.ok(minZ > 6.7 && maxZ < 7, "fixed north-facing ladder stays thin against the south side of its cell");
assert.ok(lightWoodVertices > 0 && darkWoodVertices > 0, "contrasting rungs and rails make the ladder recognizable");

const target = raycastVoxels(
  [4.5, 5.5, 5.5],
  [0, 0, 1],
  (x, y, z) => x === 4 && y === 5 && z === 6 ? BLOCK.LADDER : BLOCK.AIR,
  3,
);
assert.equal(target?.block.block, BLOCK.LADDER, "non-solid ladders remain raycastable and targetable");
assert.deepEqual(target?.place, { x: 4, y: 5, z: 5 });

console.log("lakecraft ladder block tests: ok");
