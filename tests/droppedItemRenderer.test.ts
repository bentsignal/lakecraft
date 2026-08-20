import assert from "node:assert/strict";
import {
  DROPPED_BLOCK_CUBE_GRID_SIZE,
  DROPPED_BLOCK_CUBE_MAX_VERTICES,
  DROPPED_ITEM_MESH_INTERVAL_MS,
  DROPPED_ITEM_RENDER_DISTANCE,
  DROPPED_ITEM_VERTICES_PER_ITEM,
  MAX_RENDERED_DROPPED_ITEMS,
  MAX_RENDERED_DROPPED_SPRITES,
  createDroppedItemRenderer,
  droppedBlockCubeVertexCount,
  droppedItemBufferCapacity,
  droppedSpriteVertexCount,
  writeDroppedItemGeometry,
  type DroppedItemGeometryStats,
  type DroppedItemRenderItem,
} from "../client/game/droppedItemRenderer.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";

const capacity = droppedItemBufferCapacity();
assert.equal(capacity.itemCount, MAX_RENDERED_DROPPED_ITEMS);
assert.equal(capacity.colorVertexCount, MAX_RENDERED_DROPPED_SPRITES * DROPPED_ITEM_VERTICES_PER_ITEM);
assert.equal(capacity.textureVertexCount, MAX_RENDERED_DROPPED_ITEMS * DROPPED_BLOCK_CUBE_MAX_VERTICES);
assert.equal(DROPPED_BLOCK_CUBE_GRID_SIZE, 16, "dropped cubes sample the complete imported 16px tile");
assert.equal(DROPPED_BLOCK_CUBE_MAX_VERTICES, 36, "one exact textured cube needs only six quads");
assert.ok(capacity.totalBytes < 5_000_000, "the mixed dropped-item GPU pool stays below five MiB");
assert.equal(droppedItemBufferCapacity(-2).totalBytes, 0);
assert.equal(droppedItemBufferCapacity(999).itemCount, MAX_RENDERED_DROPPED_ITEMS);
for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  assert.ok(droppedBlockCubeVertexCount(itemId) === 36 || droppedSpriteVertexCount(itemId) > 0,
    `${itemId} has either an exact textured cube or an extruded catalog sprite`);
  assert.ok(droppedSpriteVertexCount(itemId) <= DROPPED_ITEM_VERTICES_PER_ITEM);
}

const positions = new Float32Array([1,2,1, DROPPED_ITEM_RENDER_DISTANCE + 1,2,0, -2,2,-2]);
const phases = new Float32Array(3);
const itemIds = ["dirt", "dirt", "wooden_pickaxe"] as const;
const color = new Float32Array(capacity.colorVertexCount * 6);
const textured = new Float32Array(capacity.textureVertexCount * 6);
const stats: DroppedItemGeometryStats = { totalItemCount: 0, visibleItemCount: 0, vertexCount: 0,
  colorVertexCount: 0, textureVertexCount: 0 };
writeDroppedItemGeometry(positions, phases, itemIds, 3, [0,2,0], 1_000, color, textured, stats);
assert.deepEqual(stats, { totalItemCount: 3, visibleItemCount: 2,
  vertexCount: 36 + droppedSpriteVertexCount("wooden_pickaxe"),
  colorVertexCount: droppedSpriteVertexCount("wooden_pickaxe"), textureVertexCount: 36 });

let cubeMinZ = Infinity, cubeMaxZ = -Infinity;
const cubeUvs = new Set<string>();
for (let vertex = 0; vertex < stats.textureVertexCount; vertex += 1) {
  const offset = vertex * 6;
  cubeMinZ = Math.min(cubeMinZ, textured[offset + 2]); cubeMaxZ = Math.max(cubeMaxZ, textured[offset + 2]);
  assert.ok(textured[offset + 3] >= 0 && textured[offset + 3] <= 1);
  assert.ok(textured[offset + 4] >= 0 && textured[offset + 4] <= 1);
  cubeUvs.add(`${textured[offset + 3].toFixed(4)},${textured[offset + 4].toFixed(4)}`);
}
assert.ok(cubeMaxZ - cubeMinZ >= 0.299, "dropped blocks retain full cube depth");
assert.ok(cubeUvs.size >= 4, "dropped blocks carry real atlas UV corners rather than flat colors");

let spriteMinZ = Infinity, spriteMaxZ = -Infinity;
for (let vertex = 0; vertex < stats.colorVertexCount; vertex += 1) {
  const z = color[vertex * 6 + 2]; spriteMinZ = Math.min(spriteMinZ, z); spriteMaxZ = Math.max(spriteMaxZ, z);
}
assert.ok(spriteMaxZ - spriteMinZ > 0.015, "tools have visible front/back pixel-edge thickness");
assert.ok(droppedSpriteVertexCount("wooden_pickaxe") > 2 * 6,
  "a dropped tool is not a single flat two-triangle plane");

let created = 0, deleted = 0;
const allocations: number[] = [], uploads: number[] = [];
const buffers = [{ id: 1 }, { id: 2 }] as unknown as WebGLBuffer[];
const fakeGl = {
  ARRAY_BUFFER: 0x8892, DYNAMIC_DRAW: 0x88e8,
  createBuffer() { return buffers[created++]; }, bindBuffer() {},
  bufferData(_target: number, size: number) { allocations.push(size); },
  bufferSubData(_target: number, _offset: number, data: Float32Array) { uploads.push(data.byteLength); },
  deleteBuffer() { deleted += 1; },
} as unknown as WebGLRenderingContext;

function drop(index: number, itemId: ItemId): DroppedItemRenderItem {
  return { dropId: `di_${String(index).padStart(14,"0")}`, item: { itemId, count: 1 },
    x: index % 16, y: 4, z: Math.floor(index / 16), droppedAt: 10_000 + index };
}
const renderer = createDroppedItemRenderer(fakeGl);
assert.deepEqual(allocations, [
  capacity.colorVertexCount * 6 * Float32Array.BYTES_PER_ELEMENT,
  capacity.textureVertexCount * 6 * Float32Array.BYTES_PER_ELEMENT,
]);
renderer.setItems([drop(0,"dirt"), drop(1,"wooden_pickaxe")]);
let rendered = renderer.update(0, [0,5,0]);
assert.equal(rendered.textureVertexCount, 36);
assert.equal(rendered.colorVertexCount, droppedSpriteVertexCount("wooden_pickaxe"));
assert.equal(uploads.length, 2, "textured blocks and extruded sprites each use one bounded batch upload");
rendered = renderer.update(DROPPED_ITEM_MESH_INTERVAL_MS / 2, [0,5,0]);
assert.equal(rendered.updated, false);
assert.equal(uploads.length, 2);
renderer.setItems(Array.from({ length: 320 }, (_, index) => drop(index, "dirt")));
rendered = renderer.update(DROPPED_ITEM_MESH_INTERVAL_MS, [0,5,0]);
assert.equal(rendered.totalItemCount, MAX_RENDERED_DROPPED_ITEMS);
assert.equal(rendered.textureVertexCount, MAX_RENDERED_DROPPED_ITEMS * 36);
assert.equal(rendered.colorVertexCount, 0);
renderer.destroy();
assert.equal(deleted, 2);

console.log("dropped item renderer tests passed");
