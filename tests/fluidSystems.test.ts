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
  fluidSurfaceHeight,
  fluidTickDelay,
  planFluidCell,
  pointInFluid,
  raycastFluidSource,
} from "../client/game/fluids.ts";
import {
  WATER_EXIT_SPEED,
  WATER_SWIM_SPEED,
  appendFluidBlockMesh,
  waterVerticalVelocity,
} from "../client/game/voxelEngine.ts";
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
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12);
close(fluidSurfaceHeight(BLOCK.WATER), 8 / 9);
close(fluidSurfaceHeight(BLOCK.WATER_FLOW_1), 7 / 9);
close(fluidSurfaceHeight(BLOCK.WATER_FLOW_7), 1 / 9);
close(fluidSurfaceHeight(BLOCK.LAVA_FLOW_3), 2 / 9);
assert.equal(fluidSurfaceHeight(BLOCK.WATER_FLOW_7, BLOCK.WATER), 1,
  "a vertical fluid column fills the cell beneath its matching fluid");
assert.equal(fluidTickDelay(BLOCK.LAVA), 700, "lava updates materially slower than water");
assert.ok(LAVA_MOVE_SCALE < WATER_MOVE_SCALE && WATER_MOVE_SCALE < 0.5,
  "both fluids prevent sprint-hopping, with lava slower than water");
for (const [kind, maximum] of [["water", 7], ["lava", 3]] as const) {
  const line = new Map<string, BlockId>();
  const lineGet = (x: number, y: number, z: number) => line.get(key(x, y, z)) ?? BLOCK.AIR;
  line.set(key(0, 1, 0), fluidBlock(kind));
  for (let distance = 0; distance <= maximum + 1; distance += 1) line.set(key(distance, 0, 0), BLOCK.STONE);
  for (let distance = 1; distance <= maximum; distance += 1) {
    const edit = planFluidCell(kind, distance, 1, 0, lineGet);
    assert.deepEqual(edit, { x: distance, y: 1, z: 0, block: fluidBlock(kind, distance) });
    line.set(key(distance, 1, 0), edit!.block);
  }
  assert.equal(planFluidCell(kind, maximum + 1, 1, 0, lineGet), null,
    `${kind} stops after its bounded descending range`);
}
cells.delete(key(0, 1, 0));
cells.delete(key(1, 1, 0));
cells.set(key(2, 1, 0), BLOCK.WATER_FLOW_2);
assert.deepEqual(planFluidCell("water", 2, 1, 0, get), { x: 2, y: 1, z: 0, block: BLOCK.AIR },
  "unsupported derived water recedes");

cells.clear();
cells.set(key(0, 4, 0), BLOCK.WATER_FLOW_7);
assert.equal(pointInFluid(0.5, 4.05, 0.5, get), "water");
assert.equal(pointInFluid(0.5, 4.2, 0.5, get), null,
  "a shallow terminal flow cannot submerge a camera floating above it");
const sourceMesh: number[] = [];
appendFluidBlockMesh(sourceMesh, 2, 8, 3, BLOCK.WATER, () => BLOCK.AIR, 1, 15);
const sourceY = sourceMesh.filter((_value, index) => index % 6 === 1);
close(Math.max(...sourceY), 8 + 8 / 9);
const finalFlowMesh: number[] = [];
appendFluidBlockMesh(finalFlowMesh, 2, 8, 3, BLOCK.WATER_FLOW_7, () => BLOCK.AIR, 1, 15);
const finalFlowY = finalFlowMesh.filter((_value, index) => index % 6 === 1);
close(Math.max(...finalFlowY), 8 + 1 / 9);
assert.equal(waterVerticalVelocity(0, true, false, 1, false), WATER_SWIM_SPEED);
assert.equal(waterVerticalVelocity(0, true, false, 1, true), WATER_EXIT_SPEED);
assert.ok(WATER_SWIM_SPEED < 1.5 && WATER_EXIT_SPEED > WATER_SWIM_SPEED * 2,
  "held jump bobs slowly unless a real shore exit is detected");

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
const fluidPass = engine.slice(engine.indexOf("waterMeshes.sort"), engine.indexOf("if (target)", engine.indexOf("waterMeshes.sort")));
assert.doesNotMatch(fluidPass, /colorMask\(false/,
  "fluids never depend on a colorless coplanar prepass");
assert.match(fluidPass, /depthMask\(true\)[\s\S]+enable\(gl\.BLEND\)[\s\S]+mesh\.waterBuffer[\s\S]+depthMask\(false\)[\s\S]+mesh\.transparentBuffer/,
  "the single visible fluid pass writes its own stable depth before glass");
assert.match(fluidPass, /useProgram\(terrainProgram\)[\s\S]+activeTexture\(gl\.TEXTURE0\)[\s\S]+bindTexture\(gl\.TEXTURE_2D, terrainTexture\)[\s\S]+mesh\.waterBuffer/,
  "fluid rendering rebinds the terrain atlas after player and mob textures used texture unit zero");
assert.match(engine, /applyEnvironmentalDamageKnockback\(appliedDamage, true\)/,
  "drowning and lava damage produce a visible recoil impulse");
assert.match(engine, /const cameraFluid = pointInFluid\(eye\[0\], eye\[1\], eye\[2\], getBlock\)/,
  "underwater fog respects the actual height of shallow flows");
assert.match(engine, /cameraFluid === "water" \? 22 : 4/,
  "submerged water and lava have deliberately reduced view distance");

console.log("fluid system tests passed");
