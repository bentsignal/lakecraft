import assert from "node:assert/strict";
import {
  bedBreakEdits,
  bedCellKey,
  bedDirectionFromYaw,
  bedStructureAt,
  blockSupportsBed,
  createBedStructure,
  planBedPlacement,
  validateBedStructures,
} from "../client/game/localBeds.ts";
import { BED_COLLISION_HEIGHT, blockCollisionHeight, blockContainsSolidPoint } from "../client/game/blockGeometry.ts";
import { raycastVoxels } from "../client/game/terrain.ts";
import { BLOCK, type BlockId, type WorldEdit } from "../client/game/types.ts";
import {
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";

assert.deepEqual([
  bedDirectionFromYaw(0),
  bedDirectionFromYaw(Math.PI),
  bedDirectionFromYaw(Math.PI / 2),
  bedDirectionFromYaw(-Math.PI / 2),
], ["north", "south", "east", "west"], "the nearest cardinal direction follows player yaw");

const makeWorld = () => {
  const blocks = new Map<string, BlockId>();
  for (let x = -3; x <= 3; x += 1) {
    for (let z = -3; z <= 3; z += 1) blocks.set(`${x},0,${z}`, BLOCK.GRASS);
  }
  return {
    blocks,
    getBlock: (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`) ?? BLOCK.AIR,
  };
};

for (const [yaw, direction, head] of [
  [0, "north", { x: 0, y: 1, z: -1 }],
  [Math.PI, "south", { x: 0, y: 1, z: 1 }],
  [Math.PI / 2, "east", { x: 1, y: 1, z: 0 }],
  [-Math.PI / 2, "west", { x: -1, y: 1, z: 0 }],
] as const) {
  const world = makeWorld();
  const plan = planBedPlacement({ foot: { x: 0, y: 1, z: 0 }, yaw, getBlock: world.getBlock });
  assert.equal(plan.ok, true, `${direction} placement should fit on two supported empty cells`);
  if (!plan.ok) continue;
  assert.equal(plan.bed.direction, direction);
  assert.deepEqual(plan.bed.head, head);
  assert.deepEqual(plan.edits, [
    { x: 0, y: 1, z: 0, block: BLOCK.BED },
    { ...head, block: BLOCK.BED },
  ]);
}

const reject = (mutate: (blocks: Map<string, BlockId>) => void, reason: string) => {
  const world = makeWorld();
  mutate(world.blocks);
  assert.deepEqual(
    planBedPlacement({ foot: { x: 0, y: 1, z: 0 }, yaw: 0, getBlock: world.getBlock }),
    { ok: false, reason },
  );
};
reject((blocks) => blocks.set("0,1,-1", BLOCK.STONE), "occupied");
reject((blocks) => blocks.delete("0,0,-1"), "unsupported");
reject((blocks) => blocks.set("0,0,-1", BLOCK.STONE_BRICK_SLAB), "unsupported");
reject((blocks) => blocks.set("0,1,0", BLOCK.CHEST), "occupied");

const collisionWorld = makeWorld();
assert.deepEqual(planBedPlacement({
  foot: { x: 0, y: 1, z: 0 },
  yaw: 0,
  getBlock: collisionWorld.getBlock,
  intersectsPlayer: (x, _y, z) => x === 0 && z === -1,
}), { ok: false, reason: "player_collision" });
assert.deepEqual(planBedPlacement({
  foot: { x: 1_000_000, y: 1, z: 0 },
  yaw: Math.PI / 2,
  getBlock: () => BLOCK.AIR,
}), { ok: false, reason: "invalid_coordinate" }, "the second half cannot cross the world edge");

for (const solid of [BLOCK.GRASS, BLOCK.GLASS, BLOCK.PLANKS, BLOCK.FURNACE]) assert.equal(blockSupportsBed(solid), true);
for (const unsupported of [BLOCK.AIR, BLOCK.BED, BLOCK.CHEST, BLOCK.DOOR_CLOSED, BLOCK.OAK_FENCE, BLOCK.STONE_BRICK_SLAB]) {
  assert.equal(blockSupportsBed(unsupported), false);
}

const bed = createBedStructure({ x: 4, y: 7, z: 9 }, "west");
assert.deepEqual(bedBreakEdits(bed, bed.foot), [
  { ...bed.foot, block: BLOCK.AIR },
  { ...bed.head, block: BLOCK.AIR },
]);
assert.deepEqual(bedBreakEdits(bed, bed.head), [
  { ...bed.head, block: BLOCK.AIR },
  { ...bed.foot, block: BLOCK.AIR },
]);
assert.equal(bedBreakEdits(bed, { x: 99, y: 7, z: 9 }), null);
assert.deepEqual(bedStructureAt([bed], bed.head.x, bed.head.y, bed.head.z), bed);

const bedEdits: WorldEdit[] = [
  { ...bed.foot, block: BLOCK.BED },
  { ...bed.head, block: BLOCK.BED },
];
assert.deepEqual(validateBedStructures([bed], bedEdits, 10), [bed]);
assert.equal(validateBedStructures([bed, bed], bedEdits, 10), null, "one cell cannot belong to two structures");
assert.equal(validateBedStructures([bed], [bedEdits[0]], 10), null, "metadata cannot point at a missing half");
assert.equal(validateBedStructures([{ ...bed, head: { ...bed.head, x: bed.head.x - 1 } }], bedEdits, 10), null);

assert.equal(blockCollisionHeight(BLOCK.BED), BED_COLLISION_HEIGHT);
assert.equal(blockContainsSolidPoint(BLOCK.BED, 1, 1.54), true);
assert.equal(blockContainsSolidPoint(BLOCK.BED, 1, 1.56), false);
const bedKey = bedCellKey({ x: 0, y: 1, z: 0 });
const rayBlock = (x: number, y: number, z: number): BlockId => `${x},${y},${z}` === bedKey ? BLOCK.BED : BLOCK.AIR;
assert.equal(raycastVoxels([0.5, 2, 0.5], [0, -1, 0], rayBlock, 3)?.block.block, BLOCK.BED);
assert.equal(raycastVoxels([0.5, 1.8, 2], [0, 0, -1], rayBlock, 3), null,
  "a horizontal ray above the mattress does not hit the empty upper cell");

const values = new Map<string, string>();
const storage: SinglePlayerStorageAdapter = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
};
const snapshot = createDefaultSinglePlayerSnapshot(7319, 100);
snapshot.world.edits = bedEdits;
snapshot.world.beds = [bed];
assert.equal(saveSinglePlayerSnapshot(storage, snapshot, 200).ok, true);
const loaded = loadSinglePlayerSave(storage);
assert.equal(loaded.status, "loaded");
assert.deepEqual(loaded.snapshot?.world.beds, [bed], "direction metadata survives the verified A/B journal");

console.log("two-block bed placement, structure, break, collision, raycast, and save checks passed");
