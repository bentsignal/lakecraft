import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAIR_MATERIAL_FAMILIES } from "../shared/expandedBuildingCatalog.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";
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
}
assert.equal(placementBlockMatchesItem("oak_stairs", BLOCK.BRICK_STAIRS_NORTH), false,
  "canonical matching never authorizes another material family");
const singlePlayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
assert.match(singlePlayer, /placementBlockMatchesItem\(placedItem, edit\.block\)/,
  "survival consumes the oriented state through canonical item identity");

console.log("stair direction, clicked-half, and survival authorization regressions passed");
