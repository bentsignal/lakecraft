import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAIR_MATERIAL_FAMILIES } from "../shared/expandedBuildingCatalog.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";
import { blockCollisionHeightAt } from "../client/game/blockGeometry.ts";
import { raycastVoxels } from "../client/game/terrain.ts";
import { stairPlacementBlock, stairPlacementIsUpsideDown } from "../client/game/voxelEngine.ts";
import { placementBlockMatchesItem } from "../client/gameplay/catalog.ts";

const constant = (name: string): BlockId => {
  const value = (BLOCK as Readonly<Record<string, BlockId>>)[name.toUpperCase()];
  assert.equal(typeof value, "number", `${name} has a stable block state`);
  return value;
};
const floor = {
  block: { x: 0, y: 1, z: 0, block: BLOCK.STONE }, place: { x: 0, y: 2, z: 0 },
  hit: { x: 0.5, y: 2, z: 0.5 }, distance: 2,
} as const;
const ceiling = { ...floor, place: { x: 0, y: 0, z: 0 }, hit: { x: 0.5, y: 1, z: 0.5 } } as const;
assert.equal(stairPlacementIsUpsideDown(-1, floor), false, "top face forces a normal half");
assert.equal(stairPlacementIsUpsideDown(1, ceiling), true, "underside forces an upside-down half");

for (const [height, upsideDown] of [[1.25, false], [1.75, true]] as const) {
  const hit = raycastVoxels([0.5, height, -2], [0, 0, 1],
    (x, y, z) => x === 0 && y === 1 && z === 0 ? BLOCK.STONE : BLOCK.AIR, 4);
  assert.ok(hit?.hit);
  assert.equal(stairPlacementIsUpsideDown(upsideDown ? -1 : 1, hit ?? undefined), upsideDown,
    `side impact at ${height} selects its clicked half independently of pitch`);
}

const looks = [
  [[1, 0], "east"], [[0, -1], "north"], [[0, 1], "south"], [[-1, 0], "west"],
] as const;
const liveYaws = [[0, "north"], [Math.PI / 2, "east"], [Math.PI, "south"], [-Math.PI / 2, "west"]] as const;
const placedFacingPlayer = [
  [BLOCK.OAK_STAIRS_NORTH, [0.5, .75], [0.5, .25]],
  [BLOCK.OAK_STAIRS_EAST, [.25, .5], [.75, .5]],
  [BLOCK.OAK_STAIRS_SOUTH, [.5, .25], [.5, .75]],
  [BLOCK.OAK_STAIRS_WEST, [.75, .5], [.25, .5]],
] as const;
for (const [block, playerSide, awaySide] of placedFacingPlayer) {
  assert.equal(blockCollisionHeightAt(block, playerSide[0], playerSide[1]), .5,
    "the tread begins low on the placing player's side");
  assert.equal(blockCollisionHeightAt(block, awaySide[0], awaySide[1]), 1,
    "the stair rises away from the placing player");
}
for (const family of STAIR_MATERIAL_FAMILIES) {
  const item = `${family}_stairs` as Parameters<typeof placementBlockMatchesItem>[0];
  const base = constant(`${family}_stairs_north`);
  for (const [look, facing] of looks) for (const [target, half] of [[floor, ""], [ceiling, "upside_"]] as const) {
    const placed = stairPlacementBlock(base, Math.PI, 0, target, look);
    assert.equal(placed, constant(`${family}_stairs_${half}${facing}`),
      `${family} ${half || "normal_"}${facing} follows the ray, not stale yaw`);
    assert.equal(placementBlockMatchesItem(item, placed), true,
      `${family} ${half || "normal_"}${facing} remains authorized by the held item`);
  }
  for (const [yaw, facing] of liveYaws) {
    const placed = stairPlacementBlock(base, yaw, 0, floor);
    assert.equal(placed, constant(`${family}_stairs_${facing}`),
      `${family} follows the live camera after each 90-degree turn`);
    const forwardX = Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    assert.equal(blockCollisionHeightAt(placed, .5 - forwardX * .25, .5 - forwardZ * .25), .5,
      `${family} starts low on the player's side at ${facing}`);
    assert.equal(blockCollisionHeightAt(placed, .5 + forwardX * .25, .5 + forwardZ * .25), 1,
      `${family} rises in the exact direction that forward movement travels at ${facing}`);
  }
}
assert.equal(placementBlockMatchesItem("oak_stairs", BLOCK.BRICK_STAIRS_NORTH), false,
  "canonical matching never authorizes another material family");
const singlePlayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
assert.match(singlePlayer, /placementBlockMatchesItem\(placedItem, edit\.block\)/,
  "survival consumes the oriented state through canonical item identity");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const placementBoundary = engine.slice(engine.indexOf("function tryPlaceSelectedBlock"));
assert.match(placementBoundary, /stairPlacementBlock\(selectedBlock, pose\.yaw, pose\.pitch, target\)/,
  "the click boundary resolves stairs from live camera yaw");
assert.doesNotMatch(placementBoundary.slice(0, placementBoundary.indexOf("function repeatHeldBlockPlacement")),
  /stairPlacementBlock\([^;]*raycastFacing/s,
  "a same-frame turn cannot place from the previous retained ray");
const placementResolver = engine.slice(engine.indexOf("export function stairPlacementBlock"), engine.indexOf("/** Maps the engine palette"));
assert.doesNotMatch(placementResolver, /\(BLOCK as [^;]+\)\[constant\]/,
  "production placement cannot silently collapse to canonical north through a synthesized BLOCK property");
assert.match(placementResolver, /stairBlockForState\(family, facing, upsideDown\)/,
  "development and compact production resolve the same numeric stair palette state");

console.log("stair direction, clicked-half, and survival authorization regressions passed");
