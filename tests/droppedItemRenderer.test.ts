import assert from "node:assert/strict";
import {
  DROPPED_ITEM_MESH_INTERVAL_MS,
  DROPPED_ITEM_RENDER_DISTANCE,
  DROPPED_ITEM_VERTICES_PER_ITEM,
  MAX_RENDERED_DROPPED_ITEMS,
  createDroppedItemRenderer,
  droppedItemBufferCapacity,
  writeDroppedItemGeometry,
  type DroppedItemGeometryStats,
  type DroppedItemRenderItem,
} from "../client/game/droppedItemRenderer.ts";

const capacity = droppedItemBufferCapacity();
assert.equal(capacity.itemCount, 256);
assert.equal(capacity.vertexCount, MAX_RENDERED_DROPPED_ITEMS * DROPPED_ITEM_VERTICES_PER_ITEM);
assert.equal(capacity.totalBytes, 221_184, "the entire fixed batch stays under a quarter megabyte");
assert.deepEqual(droppedItemBufferCapacity(-2), { itemCount: 0, vertexCount: 0, floatCount: 0, totalBytes: 0 });
assert.equal(droppedItemBufferCapacity(999).itemCount, MAX_RENDERED_DROPPED_ITEMS);

const positions = new Float32Array(MAX_RENDERED_DROPPED_ITEMS * 3);
const colors = new Float32Array(MAX_RENDERED_DROPPED_ITEMS * 3);
const phases = new Float32Array(MAX_RENDERED_DROPPED_ITEMS);
positions.set([
  1, 2, 1,
  DROPPED_ITEM_RENDER_DISTANCE + 1, 2, 0,
  -2, 2, -2,
]);
colors.fill(0.75);
const output = new Float32Array(capacity.floatCount);
const geometryStats: DroppedItemGeometryStats = { totalItemCount: 0, visibleItemCount: 0, vertexCount: 0 };
writeDroppedItemGeometry(positions, colors, phases, 3, [0, 2, 0], 1_000, output, geometryStats);
assert.deepEqual(geometryStats, {
  totalItemCount: 3,
  visibleItemCount: 2,
  vertexCount: 2 * DROPPED_ITEM_VERTICES_PER_ITEM,
});
assert.ok(output[0] !== 0 || output[1] !== 0 || output[2] !== 0, "visible item geometry is written");

const beforeAnimation = output.slice(0, DROPPED_ITEM_VERTICES_PER_ITEM * 6);
writeDroppedItemGeometry(positions, colors, phases, 3, [0, 2, 0], 1_500, output, geometryStats);
assert.notDeepEqual(
  [...output.slice(0, DROPPED_ITEM_VERTICES_PER_ITEM * 3)],
  [...beforeAnimation.slice(0, DROPPED_ITEM_VERTICES_PER_ITEM * 3)],
  "bobbing/spinning updates vertex positions",
);

let createdBuffers = 0;
let deletedBuffers = 0;
let capacityBytes = 0;
const uploads: Array<{ offset: number; bytes: number }> = [];
const fakeBuffer = {} as WebGLBuffer;
const fakeGl = {
  ARRAY_BUFFER: 0x8892,
  DYNAMIC_DRAW: 0x88e8,
  createBuffer() {
    createdBuffers += 1;
    return fakeBuffer;
  },
  bindBuffer() {},
  bufferData(_target: number, size: number, _usage: number) {
    capacityBytes = size;
  },
  bufferSubData(_target: number, offset: number, data: Float32Array) {
    uploads.push({ offset, bytes: data.byteLength });
  },
  deleteBuffer(buffer: WebGLBuffer) {
    assert.equal(buffer, fakeBuffer);
    deletedBuffers += 1;
  },
} as unknown as WebGLRenderingContext;

function droppedItem(index: number, x = index % 16, itemId: DroppedItemRenderItem["item"]["itemId"] = "dirt"): DroppedItemRenderItem {
  return {
    dropId: `di_${String(index).padStart(14, "0")}`,
    item: { itemId, count: 1 },
    x,
    y: 4,
    z: Math.floor(index / 16),
    droppedAt: 10_000 + index,
  };
}

const renderer = createDroppedItemRenderer(fakeGl);
assert.equal(createdBuffers, 1);
assert.equal(capacityBytes, capacity.totalBytes, "GPU storage is allocated once at the hard bound");

renderer.setItems([droppedItem(0, 0, "diamond"), droppedItem(1, 3, "coal")]);
let renderStats = renderer.update(0, [0, 5, 0]);
assert.equal(renderStats.visibleItemCount, 2);
assert.equal(renderStats.vertexCount, 72);
assert.equal(renderStats.uploadBytes, 72 * 6 * Float32Array.BYTES_PER_ELEMENT);
assert.equal(uploads.length, 1, "all items share one buffer upload");

renderStats = renderer.update(DROPPED_ITEM_MESH_INTERVAL_MS / 2, [0, 5, 0]);
assert.equal(renderStats.updated, false, "steady animation is capped at 30 mesh updates per second");
assert.equal(uploads.length, 1);

renderer.setItems(Array.from({ length: 320 }, (_, index) => droppedItem(index, 0)));
renderStats = renderer.update(DROPPED_ITEM_MESH_INTERVAL_MS, [0, 5, 0]);
assert.equal(renderStats.totalItemCount, MAX_RENDERED_DROPPED_ITEMS);
assert.equal(renderStats.visibleItemCount, MAX_RENDERED_DROPPED_ITEMS);
assert.equal(renderStats.vertexCount, capacity.vertexCount);
assert.equal(renderStats.uploadBytes, capacity.totalBytes);
assert.equal(uploads.length, 2, "the worst case is still one upload for the frame");
assert.ok(uploads.every((upload) => upload.offset === 0 && upload.bytes <= capacity.totalBytes));

renderer.setItems([droppedItem(0, DROPPED_ITEM_RENDER_DISTANCE + 2)]);
renderStats = renderer.update(DROPPED_ITEM_MESH_INTERVAL_MS * 2, [0, 5, 0]);
assert.equal(renderStats.visibleItemCount, 0);
assert.equal(renderStats.vertexCount, 0);
assert.equal(renderStats.uploadBytes, 0);
assert.equal(uploads.length, 2, "fully culled batches do not upload");

renderer.destroy();
assert.equal(deletedBuffers, 1);

console.log("dropped item renderer tests passed");
