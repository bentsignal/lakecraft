import assert from "node:assert/strict";
import {
  DOOR_MESH_VERTEX_COUNT,
  appendDoorMesh,
  blockHasCollision,
  blockOccludesFaces,
  createDoorToggleEdit,
  doorPlacementBlock,
  isDoorBlock,
  toggledDoorBlock,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockTarget } from "../client/game/types.ts";

assert.equal(BLOCK.DOOR_CLOSED, 10);
assert.equal(BLOCK.DOOR_OPEN, 11);
assert.equal(isDoorBlock(BLOCK.DOOR_CLOSED), true);
assert.equal(isDoorBlock(BLOCK.DOOR_OPEN), true);
assert.equal(isDoorBlock(BLOCK.WOOD), false);
assert.equal(blockHasCollision(BLOCK.DOOR_CLOSED), true);
assert.equal(blockOccludesFaces(BLOCK.DOOR_CLOSED), true);
assert.equal(blockHasCollision(BLOCK.DOOR_OPEN), false);
assert.equal(blockOccludesFaces(BLOCK.DOOR_OPEN), false);
assert.equal(toggledDoorBlock(BLOCK.DOOR_CLOSED), BLOCK.DOOR_OPEN);
assert.equal(toggledDoorBlock(BLOCK.DOOR_OPEN), BLOCK.DOOR_CLOSED);
assert.equal(toggledDoorBlock(BLOCK.WOOD), null);
assert.equal(doorPlacementBlock(BLOCK.DOOR_OPEN), BLOCK.DOOR_CLOSED);
assert.equal(doorPlacementBlock(BLOCK.DOOR_CLOSED), BLOCK.DOOR_CLOSED);
assert.equal(doorPlacementBlock(BLOCK.STONE), BLOCK.STONE);

const target: BlockTarget = {
  block: { x: 3, y: 4, z: 5, block: BLOCK.DOOR_CLOSED },
  place: { x: 3, y: 4, z: 6 },
  distance: 2,
};
assert.deepEqual(createDoorToggleEdit(target), { x: 3, y: 4, z: 5, block: BLOCK.DOOR_OPEN });
assert.equal(createDoorToggleEdit({ ...target, block: { ...target.block, block: BLOCK.STONE } }), null);

function bounds(mesh: number[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let offset = 0; offset < mesh.length; offset += 6) {
    xs.push(mesh[offset]); ys.push(mesh[offset + 1]); zs.push(mesh[offset + 2]);
  }
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  };
}

const closed: number[] = [];
const open: number[] = [];
appendDoorMesh(closed, 10, 20, 30, false);
appendDoorMesh(open, 10, 20, 30, true);
assert.equal(closed.length / 6, DOOR_MESH_VERTEX_COUNT);
assert.equal(open.length / 6, DOOR_MESH_VERTEX_COUNT);
const closedBounds = bounds(closed);
const openBounds = bounds(open);
assert.ok(Math.abs(closedBounds.maxY - closedBounds.minY - 1.9) < 1e-9);
assert.ok(Math.abs(openBounds.maxY - openBounds.minY - 1.9) < 1e-9);
assert.ok(closedBounds.maxX - closedBounds.minX > 0.9);
assert.ok(closedBounds.maxZ - closedBounds.minZ < 0.2);
assert.ok(openBounds.maxX - openBounds.minX < 0.2);
assert.ok(openBounds.maxZ - openBounds.minZ > 0.9);

console.log("lakecraft door block tests: ok");
