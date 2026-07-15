import assert from "node:assert/strict";
import {
  blockHasCollision,
  blockMaterialColor,
  blockMaterialVariation,
  blockOccludesFaces,
  tryInteractBlock,
} from "../client/game/voxelEngine.ts";
import { blockTextureForFace } from "../client/game/blockTextures.ts";
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

assert.equal(blockTextureForFace(BLOCK.FURNACE, "north"), "furnace_front");
assert.equal(blockTextureForFace(BLOCK.FURNACE, "top"), "furnace_top");
for (const face of ["east", "west", "south", "bottom"] as const) {
  assert.equal(blockTextureForFace(BLOCK.FURNACE, face), "furnace_side");
}

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
