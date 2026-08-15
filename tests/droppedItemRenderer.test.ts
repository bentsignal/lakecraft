import assert from "node:assert/strict";
import {
  DROPPED_BLOCK_CUBE_GRID_SIZE,
  DROPPED_BLOCK_CUBE_MAX_VERTICES,
  DROPPED_ITEM_MAX_ICON_RUNS,
  DROPPED_ITEM_MESH_INTERVAL_MS,
  DROPPED_ITEM_RENDER_DISTANCE,
  DROPPED_ITEM_VERTICES_PER_ITEM,
  MAX_RENDERED_DROPPED_ITEMS,
  createDroppedItemRenderer,
  droppedBlockCubeVertexCount,
  droppedItemBufferCapacity,
  writeDroppedItemGeometry,
  type DroppedItemGeometryStats,
  type DroppedItemRenderItem,
} from "../client/game/droppedItemRenderer.ts";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { CUBE_FACES } from "../client/game/cubeFaces.ts";
import { TEXTURE_ATLAS_RGBA } from "../client/game/generated/textureAtlas.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";

const capacity = droppedItemBufferCapacity();
assert.equal(capacity.itemCount, 256);
assert.equal(capacity.vertexCount, MAX_RENDERED_DROPPED_ITEMS * DROPPED_ITEM_VERTICES_PER_ITEM);
assert.equal(DROPPED_ITEM_MAX_ICON_RUNS, 125, "the fixed batch covers the most detailed exact production icon");
assert.equal(DROPPED_BLOCK_CUBE_GRID_SIZE, 4, "distance drops use a bounded authored-atlas mip");
assert.equal(DROPPED_BLOCK_CUBE_MAX_VERTICES, 576, "six 4x4 faces fit below the sprite stride");
for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  if (droppedBlockCubeVertexCount(itemId) === 0) {
    assert.ok(getItemIconArt(itemId).runs.length <= DROPPED_ITEM_MAX_ICON_RUNS, `${itemId} fits the fixed drop batch stride`);
  }
}
assert.equal(capacity.totalBytes, 4_608_000, "the complete exact-sprite batch remains fixed and bounded");
assert.deepEqual(droppedItemBufferCapacity(-2), { itemCount: 0, vertexCount: 0, floatCount: 0, totalBytes: 0 });
assert.equal(droppedItemBufferCapacity(999).itemCount, MAX_RENDERED_DROPPED_ITEMS);

const positions = new Float32Array(MAX_RENDERED_DROPPED_ITEMS * 3);
const phases = new Float32Array(MAX_RENDERED_DROPPED_ITEMS);
const itemIds = ["dirt", "dirt", "dirt"] as const;
positions.set([
  1, 2, 1,
  DROPPED_ITEM_RENDER_DISTANCE + 1, 2, 0,
  -2, 2, -2,
]);
const output = new Float32Array(capacity.floatCount);
const geometryStats: DroppedItemGeometryStats = { totalItemCount: 0, visibleItemCount: 0, vertexCount: 0 };
writeDroppedItemGeometry(positions, phases, itemIds, 3, [0, 2, 0], 1_000, output, geometryStats);
const dirtVertices = droppedBlockCubeVertexCount("dirt");
assert.equal(dirtVertices, DROPPED_BLOCK_CUBE_MAX_VERTICES, "opaque dirt keeps all six bounded atlas faces");
assert.equal(droppedBlockCubeVertexCount("diamond"), 0, "materials remain catalog sprites");
assert.equal(droppedBlockCubeVertexCount("wooden_pickaxe"), 0, "tools remain catalog sprites");
assert.equal(droppedBlockCubeVertexCount("apple"), 0, "foods remain catalog sprites");
assert.equal(droppedBlockCubeVertexCount("torch"), 0, "special block items remain catalog sprites");
assert.equal(droppedBlockCubeVertexCount("stone_brick_slab"), 0, "partial-height blocks keep their catalog silhouette");
assert.deepEqual(geometryStats, {
  totalItemCount: 3,
  visibleItemCount: 2,
  vertexCount: 2 * dirtVertices,
});
assert.ok(output[0] !== 0 || output[1] !== 0 || output[2] !== 0, "visible item geometry is written");

writeDroppedItemGeometry(positions, phases, itemIds, 1, [0, 2, 0], 0, output, geometryStats);
let minimumZ = Infinity;
let maximumZ = -Infinity;
for (let vertex = 0; vertex < dirtVertices; vertex += 1) {
  const z = output[vertex * 6 + 2];
  minimumZ = Math.min(minimumZ, z);
  maximumZ = Math.max(maximumZ, z);
}
assert.ok(maximumZ - minimumZ >= 0.299, "a dropped block has real front-to-back cube depth");
const authoredShadedColors = new Set<string>();
for (let offset = 0; offset < TEXTURE_ATLAS_RGBA.length; offset += 4) {
  const alpha = TEXTURE_ATLAS_RGBA[offset + 3] / 255;
  if (alpha < 16 / 255) continue;
  for (const face of CUBE_FACES) {
    authoredShadedColors.add([
      TEXTURE_ATLAS_RGBA[offset] / 255 * face[4] * alpha,
      TEXTURE_ATLAS_RGBA[offset + 1] / 255 * face[4] * alpha,
      TEXTURE_ATLAS_RGBA[offset + 2] / 255 * face[4] * alpha,
    ].map((value) => value.toFixed(5)).join(","));
  }
}
for (let vertex = 0; vertex < dirtVertices; vertex += 1) {
  const offset = vertex * 6;
  const color = [output[offset + 3], output[offset + 4], output[offset + 5]]
    .map((value) => value.toFixed(5)).join(",");
  assert.ok(authoredShadedColors.has(color), `dropped cube color ${color} comes from the authored atlas`);
}

const beforeAnimation = output.slice(0, dirtVertices * 6);
writeDroppedItemGeometry(positions, phases, itemIds, 3, [0, 2, 0], 1_500, output, geometryStats);
assert.notDeepEqual(
  [...output.slice(0, dirtVertices * 3)],
  [...beforeAnimation.slice(0, dirtVertices * 3)],
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
const twoItemVertices = (getItemIconArt("diamond").runs.length + getItemIconArt("coal").runs.length) * 6;
assert.equal(renderStats.vertexCount, twoItemVertices);
assert.equal(renderStats.uploadBytes, twoItemVertices * 6 * Float32Array.BYTES_PER_ELEMENT);
assert.equal(uploads.length, 1, "all items share one buffer upload");

renderStats = renderer.update(DROPPED_ITEM_MESH_INTERVAL_MS / 2, [0, 5, 0]);
assert.equal(renderStats.updated, false, "steady animation is capped at 30 mesh updates per second");
assert.equal(uploads.length, 1);

renderer.setItems(Array.from({ length: 320 }, (_, index) => droppedItem(index, 0, "dirt")));
renderStats = renderer.update(DROPPED_ITEM_MESH_INTERVAL_MS, [0, 5, 0]);
assert.equal(renderStats.totalItemCount, MAX_RENDERED_DROPPED_ITEMS);
assert.equal(renderStats.visibleItemCount, MAX_RENDERED_DROPPED_ITEMS);
assert.equal(renderStats.vertexCount, MAX_RENDERED_DROPPED_ITEMS * DROPPED_BLOCK_CUBE_MAX_VERTICES);
assert.equal(renderStats.uploadBytes, 3_538_944, "a complete 256-drop atlas-cube batch stays below four MiB");
assert.equal(uploads.length, 2, "all atlas cubes retain one buffer upload");

renderer.setItems(Array.from({ length: 320 }, (_, index) => droppedItem(index, 0, "chest")));
renderStats = renderer.update(DROPPED_ITEM_MESH_INTERVAL_MS * 2, [0, 5, 0]);
assert.equal(renderStats.totalItemCount, MAX_RENDERED_DROPPED_ITEMS);
assert.equal(renderStats.visibleItemCount, MAX_RENDERED_DROPPED_ITEMS);
const worstRoutedVertices = MAX_RENDERED_DROPPED_ITEMS * getItemIconArt("chest").runs.length * 6;
assert.equal(renderStats.vertexCount, worstRoutedVertices);
assert.equal(renderStats.uploadBytes, 4_349_952, "the exact model-rendered chest keeps the densest routed batch below 4.5 MiB");
assert.ok(renderStats.vertexCount <= capacity.vertexCount);
assert.equal(uploads.length, 3, "the worst case is still one upload for the frame");
assert.ok(uploads.every((upload) => upload.offset === 0 && upload.bytes <= capacity.totalBytes));

renderer.setItems([droppedItem(0, DROPPED_ITEM_RENDER_DISTANCE + 2)]);
renderStats = renderer.update(DROPPED_ITEM_MESH_INTERVAL_MS * 3, [0, 5, 0]);
assert.equal(renderStats.visibleItemCount, 0);
assert.equal(renderStats.vertexCount, 0);
assert.equal(renderStats.uploadBytes, 0);
assert.equal(uploads.length, 3, "fully culled batches do not upload");

renderer.destroy();
assert.equal(deletedBuffers, 1);

console.log("dropped item renderer tests passed");
