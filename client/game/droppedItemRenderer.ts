import { ITEMS, type ItemId } from "../../shared/game.ts";
import type { NormalizedDroppedItem } from "../../shared/droppedItems.ts";
import { getItemIconArt, type ItemIconArt } from "../components/itemIconArt.ts";
import { blockIdForCubeItem } from "./blockItemCubeGeometry.ts";
import { blockTextureForFace, type BlockFace } from "./blockTextures.ts";
import { CUBE_FACES } from "./cubeFaces.ts";
import {
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "./generated/textureAtlas.ts";

type Vec3 = readonly [number, number, number];

export const MAX_RENDERED_DROPPED_ITEMS = 256;
export const DROPPED_ITEM_RENDER_DISTANCE = 48;
export const DROPPED_ITEM_MESH_INTERVAL_MS = 1_000 / 30;
export const DROPPED_ITEM_MAX_ICON_RUNS = 131;
/** Four exact authored-atlas color samples per axis keep one six-face drop below the sprite stride. */
export const DROPPED_BLOCK_CUBE_GRID_SIZE = 4;
export const DROPPED_BLOCK_CUBE_MAX_VERTICES = 6 * DROPPED_BLOCK_CUBE_GRID_SIZE * DROPPED_BLOCK_CUBE_GRID_SIZE * 6;
export const DROPPED_ITEM_VERTICES_PER_ITEM = Math.max(
  DROPPED_ITEM_MAX_ICON_RUNS * 6,
  DROPPED_BLOCK_CUBE_MAX_VERTICES,
);

const FLOATS_PER_VERTEX = 6;
const CUBE_SIZE = 0.30;
const RENDER_DISTANCE_SQUARED = DROPPED_ITEM_RENDER_DISTANCE * DROPPED_ITEM_RENDER_DISTANCE;
const ATLAS_WIDTH = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const ATLAS_MIP_SOURCE_SIZE = TEXTURE_TILE_SIZE / DROPPED_BLOCK_CUBE_GRID_SIZE;

/** Only the normalized fields that the renderer consumes. */
export type DroppedItemRenderItem = Pick<
  NormalizedDroppedItem,
  "dropId" | "item" | "x" | "y" | "z" | "droppedAt"
>;

export interface DroppedItemGeometryStats {
  totalItemCount: number;
  visibleItemCount: number;
  vertexCount: number;
}

export interface DroppedItemRenderStats extends DroppedItemGeometryStats {
  meshMs: number;
  uploadBytes: number;
  meshUpdates: number;
  updated: boolean;
}

export interface DroppedItemRenderer {
  readonly buffer: WebGLBuffer;
  readonly stats: DroppedItemRenderStats;
  setItems(items: readonly DroppedItemRenderItem[]): void;
  update(now: number, camera: Vec3): DroppedItemRenderStats;
  destroy(): void;
}

/** Fixed GPU/CPU capacity; the draw call never exceeds this upload budget. */
export function droppedItemBufferCapacity(itemCount = MAX_RENDERED_DROPPED_ITEMS): {
  itemCount: number;
  vertexCount: number;
  floatCount: number;
  totalBytes: number;
} {
  const count = Math.max(0, Math.min(MAX_RENDERED_DROPPED_ITEMS, Math.floor(itemCount)));
  const vertexCount = count * DROPPED_ITEM_VERTICES_PER_ITEM;
  const floatCount = vertexCount * FLOATS_PER_VERTEX;
  return {
    itemCount: count,
    vertexCount,
    floatCount,
    totalBytes: floatCount * Float32Array.BYTES_PER_ELEMENT,
  };
}

function itemPhase(dropId: string, droppedAt: number): number {
  let hash = Number.isFinite(droppedAt) ? Math.floor(droppedAt) : 0;
  for (let index = 0; index < dropId.length; index += 1) {
    hash = Math.imul(hash ^ dropId.charCodeAt(index), 0x45d9f3b) | 0;
  }
  return ((hash >>> 0) % 6_283) / 1_000;
}

function parseItemColor(value: string): readonly [number, number, number] {
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [
      Number.parseInt(value.slice(1, 3), 16) / 255,
      Number.parseInt(value.slice(3, 5), 16) / 255,
      Number.parseInt(value.slice(5, 7), 16) / 255,
    ];
  }
  return [0.53, 0.53, 0.53];
}

function atlasPixel(texture: TextureAtlasName, x: number, y: number): number {
  const textureIndex = TEXTURE_ATLAS_NAMES.indexOf(texture);
  if (textureIndex < 0) throw new Error(`Unknown dropped-block texture ${texture}.`);
  const cell = TEXTURE_ATLAS_CELLS[textureIndex];
  const atlasX = cell % TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE + x;
  const atlasY = Math.floor(cell / TEXTURE_ATLAS_COLUMNS) * TEXTURE_TILE_SIZE + y;
  const offset = (atlasY * ATLAS_WIDTH + atlasX) * 4;
  return (
    (TEXTURE_ATLAS_RGBA[offset] << 24)
    | (TEXTURE_ATLAS_RGBA[offset + 1] << 16)
    | (TEXTURE_ATLAS_RGBA[offset + 2] << 8)
    | TEXTURE_ATLAS_RGBA[offset + 3]
  ) >>> 0;
}

/**
 * Pick the most frequent visible authored texel in one 4x4 source cell. Ties
 * retain the first nearest-neighbor sample, keeping generation deterministic.
 */
function atlasMipColor(texture: TextureAtlasName, mipX: number, mipY: number): number {
  let bestColor = 0;
  let bestCount = 0;
  const startX = mipX * ATLAS_MIP_SOURCE_SIZE;
  const startY = mipY * ATLAS_MIP_SOURCE_SIZE;
  for (let sourceY = startY; sourceY < startY + ATLAS_MIP_SOURCE_SIZE; sourceY += 1) {
    for (let sourceX = startX; sourceX < startX + ATLAS_MIP_SOURCE_SIZE; sourceX += 1) {
      const candidate = atlasPixel(texture, sourceX, sourceY);
      if ((candidate & 0xff) < 16) continue;
      let count = 0;
      for (let compareY = startY; compareY < startY + ATLAS_MIP_SOURCE_SIZE; compareY += 1) {
        for (let compareX = startX; compareX < startX + ATLAS_MIP_SOURCE_SIZE; compareX += 1) {
          if (atlasPixel(texture, compareX, compareY) === candidate) count += 1;
        }
      }
      if (count > bestCount) {
        bestColor = candidate;
        bestCount = count;
      }
    }
  }
  return bestColor;
}

function droppedCubePoint(face: BlockFace, horizontal: number, vertical: number): Vec3 {
  if (face === "east") return [0.5, vertical - 0.5, horizontal - 0.5];
  if (face === "west") return [-0.5, vertical - 0.5, horizontal - 0.5];
  if (face === "top") return [horizontal - 0.5, 0.5, vertical - 0.5];
  if (face === "bottom") return [horizontal - 0.5, -0.5, vertical - 0.5];
  if (face === "south") return [horizontal - 0.5, vertical - 0.5, 0.5];
  return [horizontal - 0.5, vertical - 0.5, -0.5];
}

function droppedBlockCubeTemplate(itemId: ItemId): Float32Array | null {
  const block = blockIdForCubeItem(itemId);
  if (block === null) return null;
  const template: number[] = [];
  for (const face of CUBE_FACES) {
    const texture = blockTextureForFace(block, face[0]);
    if (!texture) continue;
    const winding = face[0] === "west" || face[0] === "south"
      ? [3, 2, 1, 3, 1, 0]
      : face[0] === "bottom" ? [1, 0, 3, 1, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (let pixelY = 0; pixelY < DROPPED_BLOCK_CUBE_GRID_SIZE; pixelY += 1) {
      const bottom = 1 - (pixelY + 1) / DROPPED_BLOCK_CUBE_GRID_SIZE;
      const top = 1 - pixelY / DROPPED_BLOCK_CUBE_GRID_SIZE;
      for (let pixelX = 0; pixelX < DROPPED_BLOCK_CUBE_GRID_SIZE; pixelX += 1) {
        const packed = atlasMipColor(texture, pixelX, pixelY);
        const alpha = (packed & 0xff) / 255;
        if (alpha < 16 / 255) continue;
        const left = pixelX / DROPPED_BLOCK_CUBE_GRID_SIZE;
        const right = (pixelX + 1) / DROPPED_BLOCK_CUBE_GRID_SIZE;
        const points = [
          droppedCubePoint(face[0], left, bottom),
          droppedCubePoint(face[0], left, top),
          droppedCubePoint(face[0], right, top),
          droppedCubePoint(face[0], right, bottom),
        ];
        const red = (packed >>> 24) / 255 * face[4] * alpha;
        const green = ((packed >>> 16) & 0xff) / 255 * face[4] * alpha;
        const blue = ((packed >>> 8) & 0xff) / 255 * face[4] * alpha;
        for (const pointIndex of winding) {
          const point = points[pointIndex];
          template.push(point[0], point[1], point[2], red, green, blue);
        }
      }
    }
  }
  if (template.length / FLOATS_PER_VERTEX > DROPPED_BLOCK_CUBE_MAX_VERTICES) {
    throw new Error(`${itemId} exceeded the dropped-block cube vertex budget.`);
  }
  return new Float32Array(template);
}

// Full-block drops share small immutable templates derived once from the same
// generated RGBA atlas as world terrain. The animation loop only transforms
// these retained values into its one caller-owned batch.
const DROPPED_BLOCK_CUBE_BY_ITEM = new Map<ItemId, Float32Array>();
for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  const template = droppedBlockCubeTemplate(itemId);
  if (template) DROPPED_BLOCK_CUBE_BY_ITEM.set(itemId, template);
}

export function droppedBlockCubeVertexCount(itemId: ItemId): number {
  return (DROPPED_BLOCK_CUBE_BY_ITEM.get(itemId)?.length ?? 0) / FLOATS_PER_VERTEX;
}

// Resolve the finite generated palette once so the 30 Hz mesh loop creates no
// per-run color objects while transforming recognizable catalog pixels.
const DROPPED_ITEM_COLOR_BY_HEX = new Map<string, readonly [number, number, number]>();
const DROPPED_ITEM_FALLBACK_COLOR = [0.53, 0.53, 0.53] as const;
for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  for (const run of getItemIconArt(itemId).runs) {
    if (!DROPPED_ITEM_COLOR_BY_HEX.has(run.color)) DROPPED_ITEM_COLOR_BY_HEX.set(run.color, parseItemColor(run.color));
  }
}

function cachedItemColor(value: string): readonly [number, number, number] {
  return DROPPED_ITEM_COLOR_BY_HEX.get(value) ?? DROPPED_ITEM_FALLBACK_COLOR;
}

function appendSpriteVertex(
  data: Float32Array,
  offset: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  cosYaw: number,
  sinYaw: number,
  localX: number,
  localY: number,
  red: number,
  green: number,
  blue: number,
): number {
  data[offset++] = centerX + localX * cosYaw;
  data[offset++] = centerY + localY;
  data[offset++] = centerZ + localX * sinYaw;
  data[offset++] = red;
  data[offset++] = green;
  data[offset++] = blue;
  return offset;
}

function appendSpinningSprite(
  data: Float32Array,
  offset: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  yaw: number,
  art: ItemIconArt,
): number {
  const pixel = CUBE_SIZE / 16;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  for (const run of art.runs) {
    const [red, green, blue] = cachedItemColor(run.color);
    const left = (run.x - 8) * pixel;
    const right = (run.x + run.width - 8) * pixel;
    const top = (8 - run.y) * pixel;
    const bottom = (7 - run.y) * pixel;
    offset = appendSpriteVertex(data, offset, centerX, centerY, centerZ, cosYaw, sinYaw, left, top, red, green, blue);
    offset = appendSpriteVertex(data, offset, centerX, centerY, centerZ, cosYaw, sinYaw, left, bottom, red, green, blue);
    offset = appendSpriteVertex(data, offset, centerX, centerY, centerZ, cosYaw, sinYaw, right, bottom, red, green, blue);
    offset = appendSpriteVertex(data, offset, centerX, centerY, centerZ, cosYaw, sinYaw, left, top, red, green, blue);
    offset = appendSpriteVertex(data, offset, centerX, centerY, centerZ, cosYaw, sinYaw, right, bottom, red, green, blue);
    offset = appendSpriteVertex(data, offset, centerX, centerY, centerZ, cosYaw, sinYaw, right, top, red, green, blue);
  }
  return offset;
}

function appendSpinningBlockCube(
  data: Float32Array,
  offset: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  yaw: number,
  template: Float32Array,
): number {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  for (let source = 0; source < template.length; source += FLOATS_PER_VERTEX) {
    const localX = template[source] * CUBE_SIZE;
    const localY = template[source + 1] * CUBE_SIZE;
    const localZ = template[source + 2] * CUBE_SIZE;
    data[offset++] = centerX + localX * cosYaw + localZ * sinYaw;
    data[offset++] = centerY + localY;
    data[offset++] = centerZ - localX * sinYaw + localZ * cosYaw;
    data[offset++] = template[source + 3];
    data[offset++] = template[source + 4];
    data[offset++] = template[source + 5];
  }
  return offset;
}

/**
 * Writes animated dropped-item geometry into caller-owned storage. Every loop
 * is capped at 256 entries and creates no per-item arrays, objects, or geometry
 * templates; all output lands in the retained caller-owned batch.
 */
export function writeDroppedItemGeometry(
  positions: Float32Array,
  phases: Float32Array,
  itemIds: readonly ItemId[],
  itemCount: number,
  camera: Vec3,
  now: number,
  output: Float32Array,
  stats: DroppedItemGeometryStats,
): DroppedItemGeometryStats {
  const boundedCount = Math.max(0, Math.min(MAX_RENDERED_DROPPED_ITEMS, Math.floor(itemCount)));
  let offset = 0;
  let visible = 0;
  const animationSeconds = now / 1_000;
  for (let index = 0; index < boundedCount; index += 1) {
    const sourceOffset = index * 3;
    const x = positions[sourceOffset];
    const y = positions[sourceOffset + 1];
    const z = positions[sourceOffset + 2];
    const dx = x - camera[0];
    const dy = y - camera[1];
    const dz = z - camera[2];
    if (dx * dx + dy * dy + dz * dz > RENDER_DISTANCE_SQUARED) continue;
    const phase = phases[index];
    const bob = Math.sin(animationSeconds * 2.4 + phase) * 0.075;
    const itemId = itemIds[index];
    if (!itemId || !Object.prototype.hasOwnProperty.call(ITEMS, itemId)) continue;
    const centerY = y + 0.24 + bob;
    const yaw = animationSeconds * 1.8 + phase;
    const blockCube = DROPPED_BLOCK_CUBE_BY_ITEM.get(itemId);
    offset = blockCube
      ? appendSpinningBlockCube(output, offset, x, centerY, z, yaw, blockCube)
      : appendSpinningSprite(output, offset, x, centerY, z, yaw, getItemIconArt(itemId));
    visible += 1;
  }
  stats.totalItemCount = boundedCount;
  stats.visibleItemCount = visible;
  stats.vertexCount = offset / FLOATS_PER_VERTEX;
  return stats;
}

export function createDroppedItemRenderer(gl: WebGLRenderingContext): DroppedItemRenderer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Unable to allocate the dropped-item batch buffer.");
  const capacity = droppedItemBufferCapacity();
  const vertices = new Float32Array(capacity.floatCount);
  const positions = new Float32Array(MAX_RENDERED_DROPPED_ITEMS * 3);
  const phases = new Float32Array(MAX_RENDERED_DROPPED_ITEMS);
  const itemIds: ItemId[] = [];
  let itemCount = 0;
  let lastMeshAt = -Infinity;
  let dirty = true;
  let uploadFloatCount = 0;
  let uploadView = vertices.subarray(0, 0);
  const stats: DroppedItemRenderStats = {
    totalItemCount: 0,
    visibleItemCount: 0,
    vertexCount: 0,
    meshMs: 0,
    uploadBytes: 0,
    meshUpdates: 0,
    updated: false,
  };

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);

  return {
    buffer,
    stats,
    setItems(items) {
      itemCount = 0;
      const limit = Math.min(items.length, MAX_RENDERED_DROPPED_ITEMS);
      for (let sourceIndex = 0; sourceIndex < limit; sourceIndex += 1) {
        const item = items[sourceIndex];
        if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.z)) continue;
        if (!Object.prototype.hasOwnProperty.call(ITEMS, item.item.itemId)) continue;
        const targetOffset = itemCount * 3;
        positions[targetOffset] = item.x;
        positions[targetOffset + 1] = item.y;
        positions[targetOffset + 2] = item.z;
        itemIds[itemCount] = item.item.itemId;
        phases[itemCount] = itemPhase(item.dropId, item.droppedAt);
        itemCount += 1;
      }
      itemIds.length = itemCount;
      dirty = true;
    },
    update(now, camera) {
      stats.updated = false;
      if (!dirty && now - lastMeshAt < DROPPED_ITEM_MESH_INTERVAL_MS) return stats;
      const startedAt = performance.now();
      writeDroppedItemGeometry(positions, phases, itemIds, itemCount, camera, now, vertices, stats);
      const nextUploadFloatCount = stats.vertexCount * FLOATS_PER_VERTEX;
      // A view allocation occurs only when culling changes geometry size.
      if (nextUploadFloatCount !== uploadFloatCount) {
        uploadFloatCount = nextUploadFloatCount;
        uploadView = vertices.subarray(0, uploadFloatCount);
      }
      if (uploadFloatCount > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, uploadView);
      }
      stats.meshMs = performance.now() - startedAt;
      stats.uploadBytes = uploadFloatCount * Float32Array.BYTES_PER_ELEMENT;
      stats.meshUpdates += 1;
      stats.updated = true;
      lastMeshAt = now;
      dirty = false;
      return stats;
    },
    destroy() {
      gl.deleteBuffer(buffer);
    },
  };
}
