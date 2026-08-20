import { ITEMS, type ItemId } from "../../shared/game.ts";
import type { NormalizedDroppedItem } from "../../shared/droppedItems.ts";
import { getItemIconArt, type ItemIconArt } from "../components/itemIconArt.ts";
import { blockIdForCubeItem } from "./blockItemCubeGeometry.ts";
import { blockTextureForFace, textureAtlasUv } from "./blockTextures.ts";
import { CUBE_FACES } from "./cubeFaces.ts";

type Vec3 = readonly [number, number, number];

export const MAX_RENDERED_DROPPED_ITEMS = 256;
export const MAX_RENDERED_DROPPED_SPRITES = 64;
export const DROPPED_ITEM_RENDER_DISTANCE = 48;
export const DROPPED_ITEM_MESH_INTERVAL_MS = 1_000 / 30;
export const DROPPED_ITEM_MAX_ICON_RUNS = 150;
export const DROPPED_BLOCK_CUBE_GRID_SIZE = 16;
export const DROPPED_BLOCK_CUBE_MAX_VERTICES = 36;

const FLOATS_PER_VERTEX = 6;
const CUBE_SIZE = 0.30;
const SPRITE_THICKNESS = CUBE_SIZE / 12;
const RENDER_DISTANCE_SQUARED = DROPPED_ITEM_RENDER_DISTANCE * DROPPED_ITEM_RENDER_DISTANCE;

export type DroppedItemRenderItem = Pick<
  NormalizedDroppedItem,
  "dropId" | "item" | "x" | "y" | "z" | "droppedAt"
>;

export interface DroppedItemGeometryStats {
  totalItemCount: number;
  visibleItemCount: number;
  vertexCount: number;
  colorVertexCount: number;
  textureVertexCount: number;
}

export interface DroppedItemRenderStats extends DroppedItemGeometryStats {
  meshMs: number;
  uploadBytes: number;
  meshUpdates: number;
  updated: boolean;
}

export interface DroppedItemRenderer {
  /** Extruded sprite items/tools rendered by the ordinary color program. */
  readonly buffer: WebGLBuffer;
  /** Exact atlas-textured block cubes rendered by the terrain program. */
  readonly textureBuffer: WebGLBuffer;
  readonly stats: DroppedItemRenderStats;
  setItems(items: readonly DroppedItemRenderItem[]): void;
  update(now: number, camera: Vec3): DroppedItemRenderStats;
  destroy(): void;
}

function itemPhase(dropId: string, droppedAt: number): number {
  let hash = Number.isFinite(droppedAt) ? Math.floor(droppedAt) : 0;
  for (let index = 0; index < dropId.length; index += 1) hash = Math.imul(hash ^ dropId.charCodeAt(index), 0x45d9f3b) | 0;
  return ((hash >>> 0) % 6_283) / 1_000;
}

function parseItemColor(value: string): readonly [number, number, number] {
  return /^#[0-9a-f]{6}$/i.test(value)
    ? [Number.parseInt(value.slice(1, 3), 16) / 255,
      Number.parseInt(value.slice(3, 5), 16) / 255,
      Number.parseInt(value.slice(5, 7), 16) / 255]
    : [0.53, 0.53, 0.53];
}

function appendColorVertex(output: number[], x: number, y: number, z: number,
  color: readonly [number, number, number], shade = 1): void {
  output.push(x, y, z, color[0] * shade, color[1] * shade, color[2] * shade);
}

function appendColorQuad(output: number[], points: readonly (readonly [number, number, number])[],
  color: readonly [number, number, number], shade = 1, reverse = false): void {
  const winding = reverse ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
  for (const index of winding) appendColorVertex(output, ...points[index], color, shade);
}

function droppedBlockCubeTemplate(itemId: ItemId): Float32Array | null {
  const block = blockIdForCubeItem(itemId);
  if (block === null) return null;
  const output: number[] = [];
  for (const face of CUBE_FACES) {
    const texture = blockTextureForFace(block, face[0]);
    if (!texture) continue;
    const uv = textureAtlasUv(texture);
    for (const point of face[5]) {
      const horizontal = face[1] !== 0 ? point[2] : point[0];
      const vertical = face[2] !== 0 ? point[2] : point[1];
      output.push(point[0] - 0.5, point[1] - 0.5, point[2] - 0.5,
        uv.left + (uv.right - uv.left) * horizontal,
        uv.bottom + (uv.top - uv.bottom) * vertical, face[4]);
    }
  }
  return output.length ? new Float32Array(output) : null;
}

function droppedSpriteTemplate(art: ItemIconArt): Float32Array {
  const output: number[] = [];
  const pixels: Array<readonly [number, number, number] | null> = Array(256).fill(null);
  const pixel = CUBE_SIZE / 16;
  const frontZ = SPRITE_THICKNESS / 2, backZ = -frontZ;
  for (const run of art.runs) {
    const color = parseItemColor(run.color);
    const left = (run.x - 8) * pixel, right = (run.x + run.width - 8) * pixel;
    const top = (8 - run.y) * pixel, bottom = (7 - run.y) * pixel;
    appendColorQuad(output, [[left,bottom,frontZ],[left,top,frontZ],[right,top,frontZ],[right,bottom,frontZ]], color);
    appendColorQuad(output, [[left,bottom,backZ],[right,bottom,backZ],[right,top,backZ],[left,top,backZ]], color);
    for (let x = run.x; x < run.x + run.width && x < 16; x += 1) if (x >= 0 && run.y >= 0 && run.y < 16) pixels[run.y * 16 + x] = color;
  }
  const occupied = (x: number, y: number) => x >= 0 && x < 16 && y >= 0 && y < 16 && pixels[y * 16 + x] !== null;
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
    const color = pixels[y * 16 + x];
    if (!color) continue;
    const left = (x - 8) * pixel, right = left + pixel;
    const top = (8 - y) * pixel, bottom = top - pixel;
    if (!occupied(x - 1, y)) appendColorQuad(output, [[left,bottom,backZ],[left,top,backZ],[left,top,frontZ],[left,bottom,frontZ]], color, 0.62);
    if (!occupied(x + 1, y)) appendColorQuad(output, [[right,bottom,frontZ],[right,top,frontZ],[right,top,backZ],[right,bottom,backZ]], color, 0.72);
    if (!occupied(x, y - 1)) appendColorQuad(output, [[left,top,frontZ],[left,top,backZ],[right,top,backZ],[right,top,frontZ]], color, 0.86);
    if (!occupied(x, y + 1)) appendColorQuad(output, [[left,bottom,backZ],[left,bottom,frontZ],[right,bottom,frontZ],[right,bottom,backZ]], color, 0.54);
  }
  return new Float32Array(output);
}

const DROPPED_BLOCK_TEMPLATE_BY_ITEM = new Map<ItemId, Float32Array>();
const DROPPED_SPRITE_TEMPLATE_BY_ITEM = new Map<ItemId, Float32Array>();
let maximumSpriteVertices = 0;
for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  const block = droppedBlockCubeTemplate(itemId);
  if (block) DROPPED_BLOCK_TEMPLATE_BY_ITEM.set(itemId, block);
  else {
    const sprite = droppedSpriteTemplate(getItemIconArt(itemId));
    DROPPED_SPRITE_TEMPLATE_BY_ITEM.set(itemId, sprite);
    maximumSpriteVertices = Math.max(maximumSpriteVertices, sprite.length / FLOATS_PER_VERTEX);
  }
}

export const DROPPED_ITEM_VERTICES_PER_ITEM = maximumSpriteVertices;

export function droppedBlockCubeVertexCount(itemId: ItemId): number {
  return (DROPPED_BLOCK_TEMPLATE_BY_ITEM.get(itemId)?.length ?? 0) / FLOATS_PER_VERTEX;
}

export function droppedSpriteVertexCount(itemId: ItemId): number {
  return (DROPPED_SPRITE_TEMPLATE_BY_ITEM.get(itemId)?.length ?? 0) / FLOATS_PER_VERTEX;
}

export function droppedItemBufferCapacity(itemCount = MAX_RENDERED_DROPPED_ITEMS) {
  const count = Math.max(0, Math.min(MAX_RENDERED_DROPPED_ITEMS, Math.floor(itemCount)));
  const colorVertexCount = Math.min(count, MAX_RENDERED_DROPPED_SPRITES) * DROPPED_ITEM_VERTICES_PER_ITEM;
  const textureVertexCount = count * DROPPED_BLOCK_CUBE_MAX_VERTICES;
  const vertexCount = colorVertexCount + textureVertexCount;
  return { itemCount: count, vertexCount, floatCount: vertexCount * FLOATS_PER_VERTEX,
    totalBytes: vertexCount * FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT,
    colorVertexCount, textureVertexCount };
}

function appendTransformedTemplate(output: Float32Array, offset: number, template: Float32Array,
  centerX: number, centerY: number, centerZ: number, yaw: number, scale = 1): number {
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
  for (let source = 0; source < template.length; source += FLOATS_PER_VERTEX) {
    const localX = template[source] * scale;
    const localY = template[source + 1] * scale;
    const localZ = template[source + 2] * scale;
    output[offset++] = centerX + localX * cosYaw + localZ * sinYaw;
    output[offset++] = centerY + localY;
    output[offset++] = centerZ - localX * sinYaw + localZ * cosYaw;
    output[offset++] = template[source + 3]; output[offset++] = template[source + 4]; output[offset++] = template[source + 5];
  }
  return offset;
}

export function writeDroppedItemGeometry(
  positions: Float32Array, phases: Float32Array, itemIds: readonly ItemId[], itemCount: number,
  camera: Vec3, now: number, colorOutput: Float32Array, texturedOutput: Float32Array,
  stats: DroppedItemGeometryStats,
): DroppedItemGeometryStats {
  const boundedCount = Math.max(0, Math.min(MAX_RENDERED_DROPPED_ITEMS, Math.floor(itemCount)));
  let colorOffset = 0, texturedOffset = 0, visible = 0, visibleSprites = 0;
  const seconds = now / 1_000;
  for (let index = 0; index < boundedCount; index += 1) {
    const source = index * 3;
    const x = positions[source], y = positions[source + 1], z = positions[source + 2];
    const dx = x - camera[0], dy = y - camera[1], dz = z - camera[2];
    if (dx * dx + dy * dy + dz * dz > RENDER_DISTANCE_SQUARED) continue;
    const itemId = itemIds[index];
    if (!itemId || !Object.prototype.hasOwnProperty.call(ITEMS, itemId)) continue;
    const phase = phases[index], centerY = y + 0.24 + Math.sin(seconds * 2.4 + phase) * 0.075;
    const yaw = seconds * 1.8 + phase;
    const block = DROPPED_BLOCK_TEMPLATE_BY_ITEM.get(itemId);
    if (block) texturedOffset = appendTransformedTemplate(texturedOutput, texturedOffset, block, x, centerY, z, yaw, CUBE_SIZE);
    else {
      if (visibleSprites >= MAX_RENDERED_DROPPED_SPRITES) continue;
      colorOffset = appendTransformedTemplate(colorOutput, colorOffset, DROPPED_SPRITE_TEMPLATE_BY_ITEM.get(itemId)!, x, centerY, z, yaw);
      visibleSprites += 1;
    }
    visible += 1;
  }
  stats.totalItemCount = boundedCount;
  stats.visibleItemCount = visible;
  stats.colorVertexCount = colorOffset / FLOATS_PER_VERTEX;
  stats.textureVertexCount = texturedOffset / FLOATS_PER_VERTEX;
  stats.vertexCount = stats.colorVertexCount + stats.textureVertexCount;
  return stats;
}

export function createDroppedItemRenderer(gl: WebGLRenderingContext): DroppedItemRenderer {
  const buffer = gl.createBuffer(), textureBuffer = gl.createBuffer();
  if (!buffer || !textureBuffer) throw new Error("Unable to allocate the dropped-item batch buffers.");
  const capacity = droppedItemBufferCapacity();
  const colors = new Float32Array(capacity.colorVertexCount * FLOATS_PER_VERTEX);
  const textured = new Float32Array(capacity.textureVertexCount * FLOATS_PER_VERTEX);
  const positions = new Float32Array(MAX_RENDERED_DROPPED_ITEMS * 3);
  const phases = new Float32Array(MAX_RENDERED_DROPPED_ITEMS);
  const itemIds: ItemId[] = [];
  let itemCount = 0, lastMeshAt = -Infinity, dirty = true;
  let colorFloats = 0, texturedFloats = 0;
  const stats: DroppedItemRenderStats = { totalItemCount: 0, visibleItemCount: 0, vertexCount: 0,
    colorVertexCount: 0, textureVertexCount: 0, meshMs: 0, uploadBytes: 0, meshUpdates: 0, updated: false };
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, colors.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer); gl.bufferData(gl.ARRAY_BUFFER, textured.byteLength, gl.DYNAMIC_DRAW);
  return {
    buffer, textureBuffer, stats,
    setItems(items) {
      itemCount = 0;
      for (let sourceIndex = 0; sourceIndex < Math.min(items.length, MAX_RENDERED_DROPPED_ITEMS); sourceIndex += 1) {
        const item = items[sourceIndex];
        if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.z)
          || !Object.prototype.hasOwnProperty.call(ITEMS, item.item.itemId)) continue;
        const offset = itemCount * 3;
        positions[offset] = item.x; positions[offset + 1] = item.y; positions[offset + 2] = item.z;
        itemIds[itemCount] = item.item.itemId; phases[itemCount] = itemPhase(item.dropId, item.droppedAt); itemCount += 1;
      }
      itemIds.length = itemCount; dirty = true;
    },
    update(now, camera) {
      stats.updated = false;
      if (!dirty && now - lastMeshAt < DROPPED_ITEM_MESH_INTERVAL_MS) return stats;
      const startedAt = performance.now();
      writeDroppedItemGeometry(positions, phases, itemIds, itemCount, camera, now, colors, textured, stats);
      colorFloats = stats.colorVertexCount * FLOATS_PER_VERTEX;
      texturedFloats = stats.textureVertexCount * FLOATS_PER_VERTEX;
      if (colorFloats) { gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors.subarray(0, colorFloats)); }
      if (texturedFloats) { gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, textured.subarray(0, texturedFloats)); }
      stats.meshMs = performance.now() - startedAt;
      stats.uploadBytes = (colorFloats + texturedFloats) * Float32Array.BYTES_PER_ELEMENT;
      stats.meshUpdates += 1; stats.updated = true; lastMeshAt = now; dirty = false;
      return stats;
    },
    destroy() { gl.deleteBuffer(buffer); gl.deleteBuffer(textureBuffer); },
  };
}
