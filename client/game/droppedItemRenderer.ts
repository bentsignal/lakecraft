import { ITEMS, type ItemId } from "../../shared/game.ts";
import type { NormalizedDroppedItem } from "../../shared/droppedItems.ts";

type Vec3 = readonly [number, number, number];

export const MAX_RENDERED_DROPPED_ITEMS = 256;
export const DROPPED_ITEM_RENDER_DISTANCE = 48;
export const DROPPED_ITEM_MESH_INTERVAL_MS = 1_000 / 30;
export const DROPPED_ITEM_VERTICES_PER_ITEM = 36;

const FLOATS_PER_VERTEX = 6;
const CUBE_SIZE = 0.30;
const HALF_CUBE_SIZE = CUBE_SIZE * 0.5;
const RENDER_DISTANCE_SQUARED = DROPPED_ITEM_RENDER_DISTANCE * DROPPED_ITEM_RENDER_DISTANCE;

const BOX_FACES: ReadonlyArray<{ shade: number; vertices: ReadonlyArray<Vec3> }> = [
  { shade: 0.79, vertices: [[1,0,0],[1,1,0],[1,1,1],[1,0,0],[1,1,1],[1,0,1]] },
  { shade: 0.68, vertices: [[0,0,1],[0,1,1],[0,1,0],[0,0,1],[0,1,0],[0,0,0]] },
  { shade: 1, vertices: [[0,1,0],[0,1,1],[1,1,1],[0,1,0],[1,1,1],[1,1,0]] },
  { shade: 0.52, vertices: [[0,0,1],[0,0,0],[1,0,0],[0,0,1],[1,0,0],[1,0,1]] },
  { shade: 0.88, vertices: [[1,0,1],[1,1,1],[0,1,1],[1,0,1],[0,1,1],[0,0,1]] },
  { shade: 0.73, vertices: [[0,0,0],[0,1,0],[1,1,0],[0,0,0],[1,1,0],[1,0,0]] },
];

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

function parseItemColor(itemId: ItemId): readonly [number, number, number] {
  const value = ITEMS[itemId]?.color ?? "#888888";
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [
      Number.parseInt(value.slice(1, 3), 16) / 255,
      Number.parseInt(value.slice(3, 5), 16) / 255,
      Number.parseInt(value.slice(5, 7), 16) / 255,
    ];
  }
  return [0.53, 0.53, 0.53];
}

function appendSpinningCube(
  data: Float32Array,
  offset: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  yaw: number,
  red: number,
  green: number,
  blue: number,
): number {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  for (let faceIndex = 0; faceIndex < BOX_FACES.length; faceIndex += 1) {
    const face = BOX_FACES[faceIndex];
    for (let vertexIndex = 0; vertexIndex < face.vertices.length; vertexIndex += 1) {
      const point = face.vertices[vertexIndex];
      const localX = point[0] * CUBE_SIZE - HALF_CUBE_SIZE;
      const localY = point[1] * CUBE_SIZE - HALF_CUBE_SIZE;
      const localZ = point[2] * CUBE_SIZE - HALF_CUBE_SIZE;
      data[offset++] = centerX + localX * cosYaw - localZ * sinYaw;
      data[offset++] = centerY + localY;
      data[offset++] = centerZ + localX * sinYaw + localZ * cosYaw;
      data[offset++] = red * face.shade;
      data[offset++] = green * face.shade;
      data[offset++] = blue * face.shade;
    }
  }
  return offset;
}

/**
 * Writes animated dropped-item geometry into caller-owned storage. Every loop
 * is capped at 256 entries, and this function allocates no arrays or objects.
 */
export function writeDroppedItemGeometry(
  positions: Float32Array,
  colors: Float32Array,
  phases: Float32Array,
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
    offset = appendSpinningCube(
      output,
      offset,
      x,
      y + 0.24 + bob,
      z,
      animationSeconds * 1.8 + phase,
      colors[sourceOffset],
      colors[sourceOffset + 1],
      colors[sourceOffset + 2],
    );
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
  const colors = new Float32Array(MAX_RENDERED_DROPPED_ITEMS * 3);
  const phases = new Float32Array(MAX_RENDERED_DROPPED_ITEMS);
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
        const color = parseItemColor(item.item.itemId);
        positions[targetOffset] = item.x;
        positions[targetOffset + 1] = item.y;
        positions[targetOffset + 2] = item.z;
        colors[targetOffset] = color[0];
        colors[targetOffset + 1] = color[1];
        colors[targetOffset + 2] = color[2];
        phases[itemCount] = itemPhase(item.dropId, item.droppedAt);
        itemCount += 1;
      }
      dirty = true;
    },
    update(now, camera) {
      stats.updated = false;
      if (!dirty && now - lastMeshAt < DROPPED_ITEM_MESH_INTERVAL_MS) return stats;
      const startedAt = performance.now();
      writeDroppedItemGeometry(positions, colors, phases, itemCount, camera, now, vertices, stats);
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
