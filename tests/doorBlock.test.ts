import assert from "node:assert/strict";
import {
  DOOR_MESH_VERTEX_COUNT,
  appendDoorMesh,
  blockFaceIsOccluded,
  blockHasCollision,
  blockOccludesFaces,
  createDoorToggleEdit,
  createDoorToggleEdits,
  doorHingeAt,
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
assert.equal(blockOccludesFaces(BLOCK.DOOR_CLOSED), false,
  "a thin closed door never removes the floor or wall face behind it");
assert.equal(blockFaceIsOccluded(BLOCK.STONE, BLOCK.SPRUCE_DOOR_CLOSED_NORTH), false,
  "expanded closed doors retain the supporting block's visible face");
assert.equal(blockHasCollision(BLOCK.DOOR_OPEN), false);
assert.equal(blockOccludesFaces(BLOCK.DOOR_OPEN), false);
assert.equal(toggledDoorBlock(BLOCK.DOOR_CLOSED), BLOCK.DOOR_OPEN);
assert.equal(toggledDoorBlock(BLOCK.DOOR_OPEN), BLOCK.DOOR_CLOSED);
assert.equal(toggledDoorBlock(BLOCK.WOOD), null);
assert.equal(doorPlacementBlock(BLOCK.DOOR_OPEN), BLOCK.DOOR_CLOSED);
assert.equal(doorPlacementBlock(BLOCK.DOOR_CLOSED), BLOCK.DOOR_CLOSED);
assert.equal(doorPlacementBlock(BLOCK.STONE), BLOCK.STONE);
assert.equal(doorPlacementBlock(BLOCK.SPRUCE_DOOR_OPEN_WEST, 0), BLOCK.SPRUCE_DOOR_CLOSED_NORTH);
assert.equal(doorPlacementBlock(BLOCK.BIRCH_DOOR_CLOSED_NORTH, Math.PI / 2), BLOCK.BIRCH_DOOR_CLOSED_EAST);

const target: BlockTarget = {
  block: { x: 3, y: 4, z: 5, block: BLOCK.DOOR_CLOSED },
  place: { x: 3, y: 4, z: 6 },
  distance: 2,
};
assert.deepEqual(createDoorToggleEdit(target), { x: 3, y: 4, z: 5, block: BLOCK.DOOR_OPEN });
assert.equal(createDoorToggleEdit({ ...target, block: { ...target.block, block: BLOCK.STONE } }), null);

const doubleTarget: BlockTarget = {
  block: { x: 4, y: 8, z: 9, block: BLOCK.SPRUCE_DOOR_CLOSED_NORTH },
  place: { x: 4, y: 8, z: 10 }, distance: 2,
};
const doubleLookup = (x: number, y: number, z: number) =>
  (x === 4 || x === 5) && y === 8 && z === 9 ? BLOCK.SPRUCE_DOOR_CLOSED_NORTH : BLOCK.AIR;
assert.equal(doorHingeAt(doubleTarget.block.block, 4, 8, 9, doubleLookup), "left");
assert.equal(doorHingeAt(BLOCK.SPRUCE_DOOR_CLOSED_NORTH, 5, 8, 9, doubleLookup), "right");
assert.deepEqual(createDoorToggleEdits(doubleTarget, doubleLookup), [
  { x: 4, y: 8, z: 9, block: BLOCK.SPRUCE_DOOR_OPEN_NORTH },
  { x: 5, y: 8, z: 9, block: BLOCK.SPRUCE_DOOR_OPEN_NORTH },
], "either half of a matching pair opens both leaves down the middle");

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
