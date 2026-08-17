import assert from "node:assert/strict";
import { ITEMS, type ItemId } from "../shared/game.ts";
import {
  BLOCK_ITEM_CUBE_MAX_VERTICES,
  BLOCK_ITEM_CUBE_VERTEX_FLOATS,
  appendBlockItemCubeGeometry,
  blockIdForCubeItem,
} from "../client/game/blockItemCubeGeometry.ts";

const cubeItems = (Object.keys(ITEMS) as ItemId[]).filter((itemId) => blockIdForCubeItem(itemId) !== null);
assert.ok(cubeItems.length >= 20, "canonical full blocks share the real held-cube path");
for (const [itemId, block] of [
  ["coal_ore", 13], ["iron_ore", 14], ["gold_ore", 20], ["diamond_ore", 21], ["tnt", 22],
] as const) {
  assert.equal(blockIdForCubeItem(itemId), block, `${itemId} keeps its existing atlas-backed inventory cube ID`);
}
for (const itemId of cubeItems) {
  const output: number[] = [];
  const vertices = appendBlockItemCubeGeometry(output, itemId, {
    center: [0.4, 0.7, 0.1],
    size: 0.47,
    rotationDegrees: [75, 45, 0],
  });
  assert.ok(vertices > 0 && vertices <= BLOCK_ITEM_CUBE_MAX_VERTICES, `${itemId} produces one bounded atlas cube`);
  assert.equal(output.length, vertices * BLOCK_ITEM_CUBE_VERTEX_FLOATS);
  assert.ok(output.every(Number.isFinite));
}

const dirt: number[] = [];
const dirtVertices = appendBlockItemCubeGeometry(dirt, "dirt");
assert.equal(dirtVertices, 6 * 16 * 16 * 6, "opaque dirt renders all six exact 16x16 atlas faces");
const xs = dirt.filter((_, index) => index % BLOCK_ITEM_CUBE_VERTEX_FLOATS === 0);
const ys = dirt.filter((_, index) => index % BLOCK_ITEM_CUBE_VERTEX_FLOATS === 1);
const zs = dirt.filter((_, index) => index % BLOCK_ITEM_CUBE_VERTEX_FLOATS === 2);
assert.deepEqual([Math.min(...xs), Math.max(...xs)], [-0.5, 0.5]);
assert.deepEqual([Math.min(...ys), Math.max(...ys)], [-0.5, 0.5]);
assert.deepEqual([Math.min(...zs), Math.max(...zs)], [-0.5, 0.5]);
const glass: number[] = [];
const glassVertices = appendBlockItemCubeGeometry(glass, "glass");
const readableGlass: number[] = [];
const readableGlassVertices = appendBlockItemCubeGeometry(readableGlass, "glass", { thickenTransparentEdges: true });
assert.equal(readableGlassVertices, 12 * 36,
  "third-person glass is twelve bounded volumetric frame rods instead of a fragile transparent face");
assert.ok(readableGlassVertices < glassVertices,
  "the reviewed frame is smaller than the raw per-texel clear-glass surface");
assert.ok(readableGlassVertices < dirtVertices,
  "third-person glass remains visibly transparent instead of becoming an opaque cube");
const readableGlassColors = readableGlass.filter((_, index) => index % BLOCK_ITEM_CUBE_VERTEX_FLOATS >= 3);
assert.ok(readableGlassColors.every((channel) => channel > 0.24),
  "the color-only third-person shader receives the authored glass-frame color instead of alpha-darkened near-black");
for (const [axis, sign, lateral] of [[0, 1, 2], [0, -1, 2], [2, 1, 0], [2, -1, 0]] as const) {
  const coordinates = readableGlass.filter((_, index) => index % BLOCK_ITEM_CUBE_VERTEX_FLOATS === axis);
  const extreme = sign > 0 ? Math.max(...coordinates) : Math.min(...coordinates);
  const visible: number[] = [];
  for (let offset = 0; offset < readableGlass.length; offset += BLOCK_ITEM_CUBE_VERTEX_FLOATS) {
    if (Math.abs(readableGlass[offset + axis] - extreme) < 0.00001) visible.push(offset);
  }
  const ys = visible.map((offset) => readableGlass[offset + 1]);
  const sides = visible.map((offset) => readableGlass[offset + lateral]);
  assert.ok(Math.max(...ys) - Math.min(...ys) >= 0.99 && Math.max(...sides) - Math.min(...sides) >= 0.99,
    `glass frame has bright full-height/full-width silhouette from camera ${axis}:${sign}`);
}
assert.equal(appendBlockItemCubeGeometry([], "diamond_pickaxe"), 0, "non-block sprites never enter the cube path");
assert.throws(() => appendBlockItemCubeGeometry([], "dirt", { size: 0 }), /finite and visible/);

console.log("atlas-backed held block cube tests passed");
