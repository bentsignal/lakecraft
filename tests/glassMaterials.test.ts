import assert from "node:assert/strict";
import { raycastVoxels } from "../client/game/terrain.ts";
import {
  GLASS_MESH_VERTEX_COUNT,
  appendGlassMesh,
  blockHasCollision,
  blockMaterialColor,
  blockOccludesFaces,
} from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";

assert.equal(BLOCK.COBBLESTONE, 17, "new persisted IDs append after ladder");
assert.equal(BLOCK.SAND, 18);
assert.equal(BLOCK.GLASS, 19);
assert.notDeepEqual(blockMaterialColor(BLOCK.COBBLESTONE), blockMaterialColor(BLOCK.STONE));
assert.notDeepEqual(blockMaterialColor(BLOCK.SAND), blockMaterialColor(BLOCK.DIRT));
assert.notDeepEqual(blockMaterialColor(BLOCK.GLASS), blockMaterialColor(BLOCK.SAND));
assert.equal(blockHasCollision(BLOCK.COBBLESTONE), true);
assert.equal(blockHasCollision(BLOCK.SAND), true);
assert.equal(blockHasCollision(BLOCK.GLASS), true, "glass retains a full collision cell");
assert.equal(blockOccludesFaces(BLOCK.COBBLESTONE), true);
assert.equal(blockOccludesFaces(BLOCK.SAND), true);
assert.equal(blockOccludesFaces(BLOCK.GLASS), false, "glass must not cull neighboring cube faces");

const mesh: number[] = [];
appendGlassMesh(mesh, 4, 5, 6);
assert.equal(mesh.length / 6, GLASS_MESH_VERTEX_COUNT);
assert.ok(GLASS_MESH_VERTEX_COUNT <= 36, "fixed frame/pane geometry stays no larger than one cube mesh");
let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
let frameVertices = 0;
let paneVertices = 0;
for (let offset = 0; offset < mesh.length; offset += 6) {
  const x = mesh[offset];
  const y = mesh[offset + 1];
  const z = mesh[offset + 2];
  const red = mesh[offset + 3];
  minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  if (red < 0.5) frameVertices += 1;
  else paneVertices += 1;
}
assert.deepEqual([minZ, maxZ], [6.5, 6.5], "glass is a fixed north-facing pane");
assert.ok(minX > 4 && maxX < 5 && maxX - minX > 0.9);
assert.ok(minY > 5 && maxY < 6 && maxY - minY > 0.9);
assert.equal(frameVertices, 24, "four six-vertex frame bars are batched into the chunk mesh");
assert.equal(paneVertices, 6, "one six-vertex center pane is batched with its frame");

const hit = raycastVoxels(
  [4.5, 5.5, 5.5],
  [0, 0, 1],
  (x, y, z) => x === 4 && y === 5 && z === 6 ? BLOCK.GLASS : BLOCK.AIR,
  3,
);
assert.equal(hit?.block.block, BLOCK.GLASS, "non-occluding glass remains raycastable");
assert.deepEqual(hit?.place, { x: 4, y: 5, z: 5 });

console.log("lakecraft glass and surface render tests: ok");
