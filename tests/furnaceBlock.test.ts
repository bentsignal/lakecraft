import assert from "node:assert/strict";
import {
  FURNACE_MESH_VERTEX_COUNT,
  appendFurnaceMesh,
  blockHasCollision,
  blockMaterialColor,
  blockMaterialVariation,
  blockOccludesFaces,
  tryInteractBlock,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockTarget } from "../client/game/types.ts";

assert.equal(BLOCK.FURNACE, 15);
assert.equal(blockOccludesFaces(BLOCK.FURNACE), true, "a furnace is an opaque cube");
assert.equal(blockHasCollision(BLOCK.FURNACE), true, "players cannot walk through a furnace");
assert.notDeepEqual(blockMaterialColor(BLOCK.COAL_ORE), blockMaterialColor(BLOCK.STONE));
assert.notDeepEqual(blockMaterialColor(BLOCK.IRON_ORE), blockMaterialColor(BLOCK.STONE));
assert.notDeepEqual(blockMaterialColor(BLOCK.COAL_ORE), blockMaterialColor(BLOCK.IRON_ORE));
assert.notEqual(
  blockMaterialVariation(0, 0, 0),
  blockMaterialVariation(1, 0, 0),
  "neighboring ore blocks receive subtle deterministic material variation",
);

const mesh: number[] = [];
appendFurnaceMesh(mesh, 4, 5, 6);
assert.equal(mesh.length / 6, FURNACE_MESH_VERTEX_COUNT);
let darkFrontVertices = 0;
let stoneBodyVertices = 0;
for (let offset = 0; offset < mesh.length; offset += 6) {
  const z = mesh[offset + 2];
  const red = mesh[offset + 3];
  const green = mesh[offset + 4];
  const blue = mesh[offset + 5];
  if (z < 6 && red < 0.08 && green < 0.08 && blue < 0.08) darkFrontVertices += 1;
  if (red > 0.2 && green > 0.2 && blue > 0.2) stoneBodyVertices += 1;
}
assert.ok(darkFrontVertices > 0, "the furnace should have a recognizable dark front opening");
assert.ok(stoneBodyVertices > 0, "the furnace should retain a contrasting stone body");

const target: BlockTarget = {
  block: { x: 4, y: 5, z: 6, block: BLOCK.FURNACE },
  place: { x: 4, y: 5, z: 5 },
  distance: 2,
};
let calls = 0;
assert.equal(tryInteractBlock(target, (received) => {
  calls += 1;
  assert.equal(received, target);
  return true;
}), true, "furnaces dispatch the generic interaction callback");
assert.equal(calls, 1);
assert.equal(tryInteractBlock(target, () => false), false, "unhandled furnace use preserves placement behavior");

console.log("lakecraft furnace block tests: ok");
