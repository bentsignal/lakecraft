import assert from "node:assert/strict";
import { ITEMS } from "../shared/game.ts";
import { BLOCK_TYPES } from "../shared/protocol.ts";
import { REALTIME_BLOCK_ID_MAX, decodeRealtimeChunkEdits, encodeRealtimeChunkEdits } from "../shared/realtimeWorldChunks.ts";
import { gameBlockForWorldBlock, resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";
import {
  STAIR_MESH_VERTEX_COUNT,
  appendSlabMesh,
  appendStairMesh,
  stairPlacementBlock,
} from "../client/game/voxelEngine.ts";
import {
  blockCollisionHeightAt,
  blockContainsSolidPoint,
  blockSupportsPlayerFeet,
  playerIntersectsBlockCollisionShape,
  planPlayerHalfStep,
} from "../client/game/blockGeometry.ts";
import { readFileSync } from "node:fs";
import { BLOCK, isSlabBlock, isStairBlock, stairFacingForBlock } from "../client/game/types.ts";
import { createEmptyInventory } from "../shared/game.ts";

const slabs = [BLOCK.STONE_BRICK_SLAB, BLOCK.OAK_SLAB, BLOCK.COBBLESTONE_SLAB, BLOCK.BRICK_SLAB] as const;
for (const slab of slabs) {
  assert.equal(isSlabBlock(slab), true);
  assert.equal(blockCollisionHeightAt(slab), 0.5);
  assert.equal(blockContainsSolidPoint(slab, 4, 4.49), true);
  assert.equal(blockContainsSolidPoint(slab, 4, 4.51), false);
  const vertices: number[] = [];
  appendSlabMesh(vertices, 0, 0, 0, slab);
  assert.equal(vertices.length / 6, 36);
}

for (const stair of [BLOCK.OAK_STAIRS_EAST, BLOCK.COBBLESTONE_STAIRS_NORTH,
  BLOCK.STONE_BRICK_STAIRS_SOUTH, BLOCK.BRICK_STAIRS_WEST] as const) {
  assert.equal(isStairBlock(stair), true);
  const vertices: number[] = [];
  appendStairMesh(vertices, 0, 0, 0, stair);
  assert.equal(vertices.length / 6, STAIR_MESH_VERTEX_COUNT);
}

assert.equal(stairFacingForBlock(BLOCK.OAK_STAIRS_EAST), "east");
assert.equal(stairFacingForBlock(BLOCK.OAK_STAIRS_NORTH), "north");
assert.equal(blockCollisionHeightAt(BLOCK.OAK_STAIRS_EAST, 0.25, 0.5), 0.5);
assert.equal(blockCollisionHeightAt(BLOCK.OAK_STAIRS_EAST, 0.75, 0.5), 1);
assert.equal(blockSupportsPlayerFeet(BLOCK.OAK_STAIRS_EAST, 10, 10.5, 0.25, 0.5), true);
assert.equal(blockSupportsPlayerFeet(BLOCK.OAK_STAIRS_EAST, 10, 11, 0.75, 0.5), true);
assert.equal(playerIntersectsBlockCollisionShape(0.2, 0.5, 0.5, 1.8, 0, 0, 0, BLOCK.OAK_STAIRS_EAST), false);
assert.equal(playerIntersectsBlockCollisionShape(0.8, 0.5, 0.5, 1.8, 0, 0, 0, BLOCK.OAK_STAIRS_EAST), true);
assert.deepEqual(planPlayerHalfStep(0.5, 1, 0.5, 0, 0.3, true, 0,
  (_x, y) => y < 1.5, (_x, y) => y === 1.5), [0.8, 1.5, 0.5]);
assert.equal(planPlayerHalfStep(0.5, 1, 0.5, 0, 0.3, false, 0, () => false, () => true), null,
  "airborne movement never magnetizes onto a half step");
assert.equal(planPlayerHalfStep(0.5, 1, 0.5, 0, 0.3, true, 0, () => false, () => false), null,
  "a step is accepted only when the raised pose has exact support");
const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engineSource, /stepVisualOffsetY \+= initialY - step\[1\]/,
  "the rendered camera/body stays at its pre-step height when collision authority steps upward");
assert.match(engineSource, /stepVisualOffsetY \+= dt \* 5;[\s\S]*?stepVisualOffsetY > 0/,
  "the shared first/third-person vertical offset eases to the authoritative height");
assert.match(engineSource, /writePlayerEye\(pose\.x, pose\.y \+ stepVisualOffsetY/);
assert.match(engineSource, /thirdPersonRenderPose\.y = pose\.y \+ stepVisualOffsetY/);

assert.equal(stairPlacementBlock(BLOCK.OAK_STAIRS_NORTH, 0), BLOCK.OAK_STAIRS_NORTH);
assert.equal(stairPlacementBlock(BLOCK.OAK_STAIRS_NORTH, Math.PI / 2), BLOCK.OAK_STAIRS_EAST);
assert.equal(stairPlacementBlock(BLOCK.BRICK_STAIRS_NORTH, Math.PI), BLOCK.BRICK_STAIRS_SOUTH);

assert.equal(BLOCK_TYPES[BLOCK.OAK_SLAB], "oak_slab");
assert.equal(BLOCK_TYPES[BLOCK.BRICK_STAIRS_WEST], "brick_stairs_west");
assert.equal(REALTIME_BLOCK_ID_MAX, BLOCK.BRICK_STAIRS_WEST);
const encoded = encodeRealtimeChunkEdits(0, 0, [{x:1,y:20,z:1,block:BLOCK.BRICK_STAIRS_WEST}]);
assert.deepEqual(decodeRealtimeChunkEdits(0, 0, encoded), [{x:1,y:20,z:1,block:BLOCK.BRICK_STAIRS_WEST}]);

assert.equal(gameBlockForWorldBlock("stone_brick_stairs_west"), "stone_brick_stairs");
assert.equal(ITEMS.brick_stairs.placesBlock, "brick_stairs");
const inventory = createEmptyInventory();
inventory[0] = {itemId:"brick_stairs",count:2};
const placement = resolveWorldBlockOperation({
  operationId:"building-shape-op",kind:"place",x:0,y:20,z:0,expectedBlock:"air",
  placedBlock:"brick_stairs_east",selectedHotbar:0,expectedHeldItem:"brick_stairs",
  expectedInventoryRevision:"1",expectedChunkRevision:"1",
}, {currentBlock:"air",inventory,inventoryRevision:"1",chunkRevision:"1"});
assert.equal(placement.ok, true);
if (placement.ok) {
  assert.equal(placement.effect.nextBlock, "brick_stairs_east");
  assert.equal(placement.effect.inventory[0]?.count, 1);
}

console.log("shared slab/stair geometry, collision, placement, inventory, and wire parity tests passed");
