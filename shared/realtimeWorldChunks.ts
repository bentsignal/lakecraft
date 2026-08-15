export const REALTIME_WORLD_CHUNK_SIZE = 8;
export const REALTIME_WORLD_MIN_Y = -64;
export const REALTIME_WORLD_MAX_Y = 320;
export const REALTIME_WORLD_MAX_RADIUS = 12;
export const REALTIME_WORLD_MAX_CHUNKS = (REALTIME_WORLD_MAX_RADIUS * 2 + 1) ** 2;

export interface RealtimeChunkEdit {
  x: number;
  y: number;
  z: number;
  block: number;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_CODE = new Int16Array(128).fill(-1);
for (let index = 0; index < BASE64.length; index++) BASE64_CODE[BASE64.charCodeAt(index)] = index;

export function realtimeChunkCoordinate(value: number): number {
  return Math.floor(value / REALTIME_WORLD_CHUNK_SIZE);
}

export function realtimeChunkKey(x: number, z: number): string {
  return `${x},${z}`;
}

export function realtimeChunkKeyForBlock(x: number, z: number): string {
  return realtimeChunkKey(realtimeChunkCoordinate(x), realtimeChunkCoordinate(z));
}

export function realtimeChunkWindow(centerX: number, centerZ: number, radius: number): Array<{ x: number; z: number }> {
  const bounded = Math.max(1, Math.min(REALTIME_WORLD_MAX_RADIUS, Math.floor(radius)));
  const chunks: Array<{ x: number; z: number }> = [];
  for (let dz = -bounded; dz <= bounded; dz++) {
    for (let dx = -bounded; dx <= bounded; dx++) chunks.push({ x: centerX + dx, z: centerZ + dz });
  }
  chunks.sort((left, right) => {
    const a = Math.max(Math.abs(left.x - centerX), Math.abs(left.z - centerZ));
    const b = Math.max(Math.abs(right.x - centerX), Math.abs(right.z - centerZ));
    return a - b || left.z - right.z || left.x - right.x;
  });
  return chunks;
}

/** Three packed bytes per sparse override: local x/z, absolute y, and numeric block id. */
export function encodeRealtimeChunkEdits(chunkX: number, chunkZ: number, edits: readonly RealtimeChunkEdit[]): string {
  const unique = new Map<number, number>();
  for (const edit of edits) {
    if (![edit.x, edit.y, edit.z, edit.block].every(Number.isInteger)
      || edit.y < REALTIME_WORLD_MIN_Y || edit.y > REALTIME_WORLD_MAX_Y
      || edit.block < 0 || edit.block > 33
      || realtimeChunkCoordinate(edit.x) !== chunkX || realtimeChunkCoordinate(edit.z) !== chunkZ) {
      throw new RangeError("Realtime chunk edit is outside its bounded chunk");
    }
    const localX = edit.x - chunkX * REALTIME_WORLD_CHUNK_SIZE;
    const localZ = edit.z - chunkZ * REALTIME_WORLD_CHUNK_SIZE;
    const y = edit.y - REALTIME_WORLD_MIN_Y;
    const coordinate = localX | localZ << 3 | y << 6;
    unique.set(coordinate, edit.block);
  }
  const ordered = [...unique].sort((left, right) => left[0] - right[0]);
  const bytes = new Uint8Array(ordered.length * 3);
  for (let index = 0; index < ordered.length; index++) {
    const [coordinate, block] = ordered[index];
    const packed = coordinate | block << 15;
    bytes[index * 3] = packed;
    bytes[index * 3 + 1] = packed >>> 8;
    bytes[index * 3 + 2] = packed >>> 16;
  }
  return encodeBase64(bytes);
}

export function decodeRealtimeChunkEdits(chunkX: number, chunkZ: number, source: string): RealtimeChunkEdit[] | null {
  const bytes = decodeBase64(source);
  if (!bytes || bytes.length % 3 !== 0 || bytes.length > REALTIME_WORLD_CHUNK_SIZE ** 2
    * (REALTIME_WORLD_MAX_Y - REALTIME_WORLD_MIN_Y + 1) * 3) return null;
  const edits: RealtimeChunkEdit[] = [];
  let previousCoordinate = -1;
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const packed = bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    if (packed >>> 21 !== 0) return null;
    const coordinate = packed & 0x7fff;
    const block = packed >>> 15;
    if (coordinate <= previousCoordinate || block > 33) return null;
    previousCoordinate = coordinate;
    const localX = coordinate & 7;
    const localZ = coordinate >>> 3 & 7;
    const y = (coordinate >>> 6) + REALTIME_WORLD_MIN_Y;
    if (y > REALTIME_WORLD_MAX_Y) return null;
    edits.push({
      x: chunkX * REALTIME_WORLD_CHUNK_SIZE + localX,
      y,
      z: chunkZ * REALTIME_WORLD_CHUNK_SIZE + localZ,
      block,
    });
  }
  return edits;
}

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = a << 16 | b << 8 | c;
    output += BASE64[value >>> 18] + BASE64[value >>> 12 & 63]
      + (index + 1 < bytes.length ? BASE64[value >>> 6 & 63] : "=")
      + (index + 2 < bytes.length ? BASE64[value & 63] : "=");
  }
  return output;
}

function decodeBase64(source: string): Uint8Array | null {
  if (source.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source)) return null;
  const padding = source.endsWith("==") ? 2 : source.endsWith("=") ? 1 : 0;
  const output = new Uint8Array(source.length / 4 * 3 - padding);
  let offset = 0;
  for (let index = 0; index < source.length; index += 4) {
    const a = BASE64_CODE[source.charCodeAt(index)] ?? -1;
    const b = BASE64_CODE[source.charCodeAt(index + 1)] ?? -1;
    const c = source[index + 2] === "=" ? 0 : BASE64_CODE[source.charCodeAt(index + 2)] ?? -1;
    const d = source[index + 3] === "=" ? 0 : BASE64_CODE[source.charCodeAt(index + 3)] ?? -1;
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const value = a << 18 | b << 12 | c << 6 | d;
    if (offset < output.length) output[offset++] = value >>> 16;
    if (offset < output.length) output[offset++] = value >>> 8;
    if (offset < output.length) output[offset++] = value;
  }
  return output;
}
