import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAVA_MOVE_SCALE,
  PLAYER_MAX_AIR,
  WATER_MOVE_SCALE,
  advanceBreath,
  createBreathState,
  fluidBlock,
  fluidLevel,
  fluidTickDelay,
  planFluidCell,
  raycastFluidSource,
} from "../client/game/fluids.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";
import { blockTextureForFace } from "../client/game/blockTextures.ts";
import { INVENTORY_SIZE, exchangeSelectedItem, type Inventory } from "../shared/game.ts";
import { resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";

const cells = new Map<string, BlockId>();
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const get = (x: number, y: number, z: number) => cells.get(key(x, y, z)) ?? BLOCK.AIR;
cells.set(key(0, 1, 0), BLOCK.WATER);
cells.set(key(0, 0, 0), BLOCK.STONE);
cells.set(key(1, 0, 0), BLOCK.STONE);
cells.set(key(2, 0, 0), BLOCK.STONE);
assert.deepEqual(planFluidCell("water", 1, 1, 0, get), { x: 1, y: 1, z: 0, block: BLOCK.WATER_FLOW_1 });
cells.set(key(1, 1, 0), BLOCK.WATER_FLOW_1);
assert.deepEqual(planFluidCell("water", 2, 1, 0, get), { x: 2, y: 1, z: 0, block: BLOCK.WATER_FLOW_2 });
assert.deepEqual(planFluidCell("water", 0, 0, 1, (x, y, z) => {
  if (x === 0 && y === 1 && z === 1) return BLOCK.WATER;
  return BLOCK.AIR;
}), { x: 0, y: 0, z: 1, block: BLOCK.WATER_FLOW_1 }, "fluid falls into an opened cell below a source");
assert.equal(fluidLevel(fluidBlock("water", 7)), 7);
assert.equal(fluidLevel(fluidBlock("lava", 3)), 3);
assert.equal(fluidTickDelay(BLOCK.LAVA), 700, "lava updates materially slower than water");
assert.ok(LAVA_MOVE_SCALE < WATER_MOVE_SCALE && WATER_MOVE_SCALE < 0.5,
  "both fluids prevent sprint-hopping, with lava slower than water");
cells.delete(key(0, 1, 0));
cells.delete(key(1, 1, 0));
cells.set(key(2, 1, 0), BLOCK.WATER_FLOW_2);
assert.deepEqual(planFluidCell("water", 2, 1, 0, get), { x: 2, y: 1, z: 0, block: BLOCK.AIR },
  "unsupported derived water recedes");

cells.clear();
cells.set(key(0, 1, -2), BLOCK.WATER_FLOW_2);
cells.set(key(0, 1, -3), BLOCK.WATER);
assert.deepEqual(raycastFluidSource([0.5, 1.5, 0.5], [0, 0, -1], get),
  { x: 0, y: 1, z: -3, block: BLOCK.WATER }, "buckets target sources through flowing fluid");

let breath = createBreathState();
for (let tick = 0; tick < 30; tick += 1) breath = advanceBreath(breath, true, 0.5);
assert.equal(breath.air, 0, "ten exact bubbles last fifteen seconds");
assert.equal(advanceBreath(breath, true, 1).damageTaken, 2, "drowning deals two damage per second");
assert.equal(advanceBreath(breath, false, 1).air, 4, "air refills promptly above the surface");
assert.equal(PLAYER_MAX_AIR, 10);

const inventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
inventory[0] = { itemId: "bucket", count: 2 };
const filled = exchangeSelectedItem(inventory, 0, "bucket", "water_bucket");
assert.equal(filled.ok, true);
assert.deepEqual(filled.inventory[0], { itemId: "bucket", count: 1 });
assert.equal(filled.inventory.some((stack) => stack?.itemId === "water_bucket"), true);
const collected = resolveWorldBlockOperation({
  operationId: "bucket_collect_123", kind: "mine", x: 1, y: 64, z: 1,
  expectedBlock: "water", selectedHotbar: 0, expectedHeldItem: "bucket",
  expectedInventoryRevision: "4", expectedChunkRevision: "2",
}, { currentBlock: "water", inventory, inventoryRevision: "4", chunkRevision: "2" });
assert.equal(collected.ok, true);
if (collected.ok) assert.equal(collected.effect.inventory.some((stack) => stack?.itemId === "water_bucket"), true);
const placed = resolveWorldBlockOperation({
  operationId: "bucket_place_1234", kind: "place", x: 1, y: 64, z: 1,
  expectedBlock: "air", placedBlock: "lava", selectedHotbar: 0, expectedHeldItem: "lava_bucket",
  expectedInventoryRevision: "4", expectedChunkRevision: "2",
}, { currentBlock: "air", inventory: [{ itemId: "lava_bucket", count: 1 }, ...inventory.slice(1)],
  inventoryRevision: "4", chunkRevision: "2" });
assert.equal(placed.ok, true);
if (placed.ok) assert.deepEqual(placed.effect.inventory[0], { itemId: "bucket", count: 1 });

assert.equal(blockTextureForFace(BLOCK.WATER_FLOW_7, "top"), "water");
assert.equal(blockTextureForFace(BLOCK.LAVA, "top"), "lava");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engine, /gl\.colorMask\(false, false, false, false\)[\s\S]+gl\.depthFunc\(gl\.LEQUAL\)/,
  "fluid depth prepass prevents camera-order surface disappearance");
assert.match(engine, /cameraFluid === "water" \? 22 : 4/,
  "submerged water and lava have deliberately reduced view distance");

console.log("fluid system tests passed");
