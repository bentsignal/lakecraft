import assert from "node:assert/strict";
import { ITEMS, RECIPES } from "../shared/game.ts";
import { CATALOG_V3_BLOCK_ITEMS, CATALOG_V3_STONE_SHAPE_FAMILIES, DEEPSLATE_BUILDING_ITEMS, STONE_SHAPE_FAMILIES } from "../shared/expandedBuildingCatalog.ts";
import { BLOCK_TYPES } from "../shared/protocol.ts";
import { REALTIME_BLOCK_ID_MAX, decodeRealtimeChunkEdits, encodeRealtimeChunkEdits } from "../shared/realtimeWorldChunks.ts";
import { gameBlockForWorldBlock, resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";
import {
  STAIR_MESH_VERTEX_COUNT,
  appendSlabMesh,
  appendStairMesh,
  stairFacingFromYaw,
  stairPlacementBlock,
  stairPlacementIsUpsideDown,
} from "../client/game/voxelEngine.ts";
import {
  blockCollisionHeightAt,
  blockContainsSolidPoint,
  blockSupportsPlayerFeet,
  playerIntersectsBlockCollisionShape,
  planPlayerHalfStep,
  stairShapeAt,
} from "../client/game/blockGeometry.ts";
import { readFileSync } from "node:fs";
import { BLOCK, isSlabBlock, isStairBlock, stairFacingForBlock } from "../client/game/types.ts";
import { createEmptyInventory } from "../shared/game.ts";
import { blockTextureForFace } from "../client/game/blockTextures.ts";
import { ENGINE_TO_GAME, ITEM_TO_ENGINE, placementBlockMatchesItem } from "../client/gameplay/catalog.ts";
import { raycastVoxels } from "../client/game/terrain.ts";

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
  BLOCK.STONE_BRICK_STAIRS_SOUTH, BLOCK.BRICK_STAIRS_WEST,
  BLOCK.SPRUCE_STAIRS_EAST, BLOCK.QUARTZ_STAIRS_UPSIDE_WEST] as const) {
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
const singlePlayerSource = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
assert.match(singlePlayerSource, /placementBlockMatchesItem\(placedItem, edit\.block\)/,
  "survival consumes directional placement through canonical item identity");
assert.match(engineSource, /stepVisualOffsetY \+= initialY - step\[1\]/,
  "the rendered camera/body stays at its pre-step height when collision authority steps upward");
assert.match(engineSource, /stepVisualOffsetY \+= dt \* 5;[\s\S]*?stepVisualOffsetY > 0/,
  "the shared first/third-person vertical offset eases to the authoritative height");
assert.match(engineSource, /writePlayerEye\(pose\.x, pose\.y \+ stepVisualOffsetY/);
assert.match(engineSource, /thirdPersonRenderPose\.y = pose\.y \+ stepVisualOffsetY/);

assert.equal(stairPlacementBlock(BLOCK.OAK_STAIRS_NORTH, 0), BLOCK.OAK_STAIRS_NORTH);
assert.equal(stairPlacementBlock(BLOCK.OAK_STAIRS_NORTH, Math.PI / 2), BLOCK.OAK_STAIRS_EAST);
assert.equal(stairPlacementBlock(BLOCK.BRICK_STAIRS_NORTH, Math.PI), BLOCK.BRICK_STAIRS_SOUTH);
assert.equal(stairPlacementBlock(BLOCK.OAK_STAIRS_NORTH, 0, 0.7), BLOCK.OAK_STAIRS_UPSIDE_NORTH);
assert.equal(stairPlacementBlock(BLOCK.BRICK_STAIRS_NORTH, Math.PI / 2, 0.7), BLOCK.BRICK_STAIRS_UPSIDE_EAST);
assert.equal(stairPlacementBlock(BLOCK.SPRUCE_STAIRS_NORTH, Math.PI, 0.7), BLOCK.SPRUCE_STAIRS_UPSIDE_SOUTH);
assert.equal(stairPlacementBlock(BLOCK.QUARTZ_STAIRS_NORTH, -Math.PI / 2), BLOCK.QUARTZ_STAIRS_WEST);
assert.deepEqual([0, Math.PI / 2, Math.PI, -Math.PI / 2].map(stairFacingFromYaw),
  ["north", "east", "south", "west"], "camera yaw resolves every cardinal placement quadrant");
assert.equal(stairFacingFromYaw(Math.PI * 2), "north", "wrapped camera yaw preserves its cardinal direction");

const placementTarget = {
  block: { x: 0, y: 1, z: 0, block: BLOCK.STONE }, place: { x: 0, y: 0, z: 0 },
  hit: { x: 0.5, y: 1, z: 0.5 }, distance: 2,
} as const;
const floorTarget = { ...placementTarget, place: { x: 0, y: 2, z: 0 }, hit: { x: 0.5, y: 2, z: 0.5 } } as const;
const lowerSideTarget = { ...placementTarget, place: { x: 0, y: 1, z: -1 }, hit: { x: 0.5, y: 1.25, z: 0 } } as const;
const upperSideTarget = { ...lowerSideTarget, hit: { x: 0.5, y: 1.75, z: 0 } } as const;
assert.equal(stairPlacementIsUpsideDown(-1, floorTarget), false, "top face always places a normal stair");
assert.equal(stairPlacementIsUpsideDown(1, placementTarget), true, "underside always places an upside-down stair");
assert.equal(stairPlacementIsUpsideDown(1, lowerSideTarget), false, "lower side hit ignores camera pitch");
assert.equal(stairPlacementIsUpsideDown(-1, upperSideTarget), true, "upper side hit ignores camera pitch");
assert.equal(stairPlacementBlock(BLOCK.OAK_STAIRS_NORTH, 0, 0, lowerSideTarget, [1, 0]), BLOCK.OAK_STAIRS_EAST,
  "the actual horizontal ray wins over a stale yaw fallback");
assert.equal(stairPlacementBlock(BLOCK.OAK_STAIRS_NORTH, 0, 0, lowerSideTarget, [-1, 0]), BLOCK.OAK_STAIRS_WEST,
  "opposite camera rays produce opposite stair headings");
for (const [originY, expected] of [[1.25, false], [1.75, true]] as const) {
  const sideHit = raycastVoxels([0.5, originY, -2], [0, 0, 1],
    (x, y, z) => x === 0 && y === 1 && z === 0 ? BLOCK.STONE : BLOCK.AIR, 4);
  assert.ok(sideHit?.hit, "shared raycast retains the exact side-face impact point");
  assert.equal(stairPlacementIsUpsideDown(0, sideHit ?? undefined), expected,
    `${expected ? "upper" : "lower"} ray hit selects the correct stair half`);
}
const directionFixtures = [[0, "NORTH"], [Math.PI / 2, "EAST"], [Math.PI, "SOUTH"], [-Math.PI / 2, "WEST"]] as const;
for (const [family, source] of STONE_SHAPE_FAMILIES) {
  const slabItem = `${family}_slab` as keyof typeof ITEMS;
  const stairItem = `${family}_stairs` as keyof typeof ITEMS;
  const slab = BLOCK[`${family}_slab`.toUpperCase() as keyof typeof BLOCK];
  const north = BLOCK[`${family}_stairs_north`.toUpperCase() as keyof typeof BLOCK];
  assert.equal(typeof slab, "number", `${family} slab has a stable numeric state`);
  assert.equal(isSlabBlock(slab), true);
  assert.equal(blockCollisionHeightAt(slab), 0.5);
  assert.equal(ITEMS[slabItem].placesBlock, slabItem);
  assert.equal(ITEMS[stairItem].placesBlock, stairItem);
  assert.equal(blockTextureForFace(slab, "north"), source);
  assert.equal(blockTextureForFace(north, "top"), source);
  assert.equal(ITEM_TO_ENGINE[stairItem], north);
  assert.equal(ENGINE_TO_GAME[north], stairItem);
  assert.ok(RECIPES.some((recipe) => recipe.id === slabItem && recipe.output.count === 6));
  assert.ok(RECIPES.some((recipe) => recipe.id === stairItem && recipe.output.count === 4));
  const ordinary = directionFixtures.map(([yaw, suffix]) => stairPlacementBlock(north, yaw)
    === BLOCK[`${family}_stairs_${suffix}`.toUpperCase() as keyof typeof BLOCK]);
  assert.deepEqual(ordinary, [true, true, true, true], `${family} ordinary stairs rotate through all four camera headings`);
  const upside = directionFixtures.map(([yaw, suffix]) => stairPlacementBlock(north, yaw, 0, placementTarget)
    === BLOCK[`${family}_stairs_upside_${suffix}`.toUpperCase() as keyof typeof BLOCK]);
  assert.deepEqual(upside, [true, true, true, true], `${family} underside stairs preserve every cardinal heading`);
  for (const suffix of ["EAST", "NORTH", "SOUTH", "WEST", "UPSIDE_EAST", "UPSIDE_NORTH", "UPSIDE_SOUTH", "UPSIDE_WEST"] as const) {
    const variant = BLOCK[`${family}_stairs_${suffix}`.toUpperCase() as keyof typeof BLOCK];
    assert.equal(placementBlockMatchesItem(stairItem, variant), true,
      `${family} ${suffix.toLowerCase()} authorizes against its canonical inventory item`);
  }
  for (const [shapeItem, placedBlock] of [[slabItem, `${family}_slab`], [stairItem, `${family}_stairs_upside_west`]] as const) {
    const familyInventory = createEmptyInventory();
    familyInventory[0] = { itemId: shapeItem, count: 1 };
    const familyPlacement = resolveWorldBlockOperation({
      operationId:`catalog-v2-${shapeItem}`,kind:"place",x:0,y:20,z:0,expectedBlock:"air",
      placedBlock,selectedHotbar:0,expectedHeldItem:shapeItem,
      expectedInventoryRevision:"1",expectedChunkRevision:"1",
    }, {currentBlock:"air",inventory:familyInventory,inventoryRevision:"1",chunkRevision:"1"});
    assert.equal(familyPlacement.ok, true, `${shapeItem} is accepted by shared placement authority`);
    if (familyPlacement.ok) assert.equal(familyPlacement.effect.inventory[0], null);
  }
}
for (const item of DEEPSLATE_BUILDING_ITEMS) {
  const block = ITEM_TO_ENGINE[item];
  assert.equal(typeof block, "number");
  assert.equal(blockTextureForFace(block!, "north"), item, `${item} uses the installed Minecraft tile`);
}
for (const item of CATALOG_V3_BLOCK_ITEMS) {
  const inventory = createEmptyInventory();
  inventory[0] = { itemId: item, count: 1 };
  const placement = resolveWorldBlockOperation({
    operationId:`catalog-v2-${item}`,kind:"place",x:0,y:20,z:0,expectedBlock:"air",
    placedBlock:item,selectedHotbar:0,expectedHeldItem:item,
    expectedInventoryRevision:"1",expectedChunkRevision:"1",
  }, {currentBlock:"air",inventory,inventoryRevision:"1",chunkRevision:"1"});
  assert.equal(placement.ok, true, `${item} is accepted by shared placement authority`);
  if (placement.ok) assert.equal(placement.effect.inventory[0], null);
}
assert.equal(stairShapeAt(BLOCK.OAK_STAIRS_EAST, 0, 0, 0,
  (x, _y, z) => x === 1 && z === 0 ? BLOCK.OAK_STAIRS_NORTH : BLOCK.AIR), "outer_left");
assert.equal(stairShapeAt(BLOCK.OAK_STAIRS_EAST, 0, 0, 0,
  (x, _y, z) => x === -1 && z === 0 ? BLOCK.OAK_STAIRS_SOUTH : BLOCK.AIR), "inner_right");
assert.equal(stairShapeAt(BLOCK.SPRUCE_STAIRS_UPSIDE_NORTH, 0, 0, 0,
  (x, _y, z) => x === 0 && z === -1 ? BLOCK.QUARTZ_STAIRS_UPSIDE_WEST : BLOCK.AIR), "outer_left",
  "upside-down stairs derive the same corner silhouette, even across materials");
assert.equal(stairShapeAt(BLOCK.SPRUCE_STAIRS_UPSIDE_NORTH, 0, 0, 0,
  (x, _y, z) => x === 0 && z === -1 ? BLOCK.QUARTZ_STAIRS_WEST : BLOCK.AIR), "straight",
  "stairs in opposite vertical halves never connect");
assert.equal(stairShapeAt(BLOCK.OAK_STAIRS_EAST, 0, 0, 0,
  (x, _y, z) => x === 1 && z === 0 ? BLOCK.OAK_STAIRS_NORTH
    : x === 0 && z === 1 ? BLOCK.OAK_STAIRS_EAST : BLOCK.AIR), "straight",
  "a same-facing stair on the outer side blocks an invalid T-intersection corner");
assert.equal(stairShapeAt(BLOCK.OAK_STAIRS_EAST, 0, 0, 0,
  (x, _y, z) => x === -1 && z === 0 ? BLOCK.OAK_STAIRS_SOUTH
    : x === 0 && z === 1 ? BLOCK.OAK_STAIRS_EAST : BLOCK.AIR), "straight",
  "a same-facing stair on the inner side blocks an invalid T-intersection corner");
assert.equal(blockCollisionHeightAt(BLOCK.OAK_STAIRS_UPSIDE_EAST, 0.1, 0.5), 1,
  "an upside-down stair keeps its walkable top slab across the whole cell");

assert.equal(BLOCK_TYPES[BLOCK.OAK_SLAB], "oak_slab");
assert.equal(BLOCK_TYPES[BLOCK.BRICK_STAIRS_WEST], "brick_stairs_west");
assert.ok(BLOCK.NETHER_WART_BLOCK <= REALTIME_BLOCK_ID_MAX);
assert.equal(BLOCK.DEEPSLATE_TILE_STAIRS_UPSIDE_WEST, 498, "the complete deployed v1 palette keeps its last numeric id");
assert.equal(BLOCK_TYPES.length, 769, "the append-only catalog includes natural terrain and derived fluid states");
assert.ok(BLOCK.RESIN_BRICK_STAIRS_UPSIDE_WEST > 511 && BLOCK.RESIN_BRICK_STAIRS_UPSIDE_WEST <= REALTIME_BLOCK_ID_MAX);
assert.ok(BLOCK.DEEPSLATE_TILE_STAIRS_UPSIDE_WEST <= REALTIME_BLOCK_ID_MAX);
const encoded = encodeRealtimeChunkEdits(0, 0, [{x:1,y:20,z:1,block:BLOCK.NETHER_WART_BLOCK}]);
assert.deepEqual(decodeRealtimeChunkEdits(0, 0, encoded), [{x:1,y:20,z:1,block:BLOCK.NETHER_WART_BLOCK}]);
const tailEncoded = encodeRealtimeChunkEdits(0, 0, [{x:2,y:20,z:1,block:BLOCK.DEEPSLATE_TILE_STAIRS_UPSIDE_WEST}]);
assert.deepEqual(decodeRealtimeChunkEdits(0, 0, tailEncoded), [{x:2,y:20,z:1,block:BLOCK.DEEPSLATE_TILE_STAIRS_UPSIDE_WEST}],
  "the highest append-only building state round-trips through Railway chunk persistence");
const v2TailEncoded = encodeRealtimeChunkEdits(0, 0, [{x:3,y:20,z:1,block:BLOCK.RESIN_BRICK_STAIRS_UPSIDE_WEST}]);
assert.match(v2TailEncoded, /^v2:/);
assert.deepEqual(decodeRealtimeChunkEdits(0, 0, v2TailEncoded), [{x:3,y:20,z:1,block:BLOCK.RESIN_BRICK_STAIRS_UPSIDE_WEST}],
  "a state above 511 round-trips through the widened Railway chunk codec");
assert.ok(CATALOG_V3_STONE_SHAPE_FAMILIES.every(([family]) => ITEMS[`${family}_slab` as keyof typeof ITEMS]
  && ITEMS[`${family}_stairs` as keyof typeof ITEMS]), "every v2 shape family is present in the creative item catalog");

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
const tailInventory = createEmptyInventory();
tailInventory[0] = {itemId:"deepslate_tile_stairs",count:1};
const tailPlacement = resolveWorldBlockOperation({
  operationId:"building-shape-tail-op",kind:"place",x:1,y:20,z:0,expectedBlock:"air",
  placedBlock:"deepslate_tile_stairs_upside_west",selectedHotbar:0,expectedHeldItem:"deepslate_tile_stairs",
  expectedInventoryRevision:"2",expectedChunkRevision:"2",
}, {currentBlock:"air",inventory:tailInventory,inventoryRevision:"2",chunkRevision:"2"});
assert.equal(tailPlacement.ok, true, "Lakebed and Railway inventory authority accept the highest stair variant");
if (tailPlacement.ok) assert.equal(tailPlacement.effect.inventory[0], null);

console.log("shared slab/stair geometry, collision, placement, inventory, and wire parity tests passed");
