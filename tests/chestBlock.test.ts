import assert from "node:assert/strict";
import {
  CHEST_MESH_VERTEX_COUNT,
  appendChestMesh,
  blockHasCollision,
  blockOccludesFaces,
  tryInteractBlock,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockTarget } from "../client/game/types.ts";

assert.equal(BLOCK.CHEST, 9);
assert.equal(blockOccludesFaces(BLOCK.CHEST), true);
assert.equal(blockHasCollision(BLOCK.CHEST), true);

const mesh: number[] = [];
appendChestMesh(mesh, 10, 20, 30);
assert.equal(mesh.length / 6, CHEST_MESH_VERTEX_COUNT);
const xs: number[] = [];
const ys: number[] = [];
const zs: number[] = [];
let goldVertices = 0;
for (let offset = 0; offset < mesh.length; offset += 6) {
  xs.push(mesh[offset]);
  ys.push(mesh[offset + 1]);
  zs.push(mesh[offset + 2]);
  if (mesh[offset + 3] > 0.58 && mesh[offset + 4] > 0.35) goldVertices += 1;
}
assert.equal(Math.min(...xs), 10.02);
assert.equal(Math.max(...xs), 10.98);
assert.equal(Math.min(...ys), 20);
assert.equal(Math.max(...ys), 20.92);
assert.equal(Math.min(...zs), 29.99);
assert.equal(Math.max(...zs), 30.98);
assert.ok(goldVertices > 0, "the chest mesh should include a contrasting gold latch");

const chestTarget: BlockTarget = {
  block: { x: 1, y: 2, z: 3, block: BLOCK.CHEST },
  place: { x: 1, y: 2, z: 4 },
  distance: 2.5,
};
let calls = 0;
assert.equal(tryInteractBlock(chestTarget, (received) => {
  calls += 1;
  assert.equal(received, chestTarget);
  return true;
}), true);
assert.equal(calls, 1);
assert.equal(tryInteractBlock(chestTarget, () => false), false, "unhandled interactions preserve placement");
assert.equal(tryInteractBlock(chestTarget), false);

const stoneTarget: BlockTarget = {
  ...chestTarget,
  block: { ...chestTarget.block, block: BLOCK.STONE },
};
assert.equal(tryInteractBlock(stoneTarget, () => {
  calls += 1;
  return true;
}), false);
assert.equal(calls, 1, "non-chest targets must not dispatch the chest callback");

console.log("lakecraft chest block tests: ok");
