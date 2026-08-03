export const WORLD_CHUNK_SIZE = 8;
/** A 7x7 window matches the Lakebed visible-chunk query ceiling (49 rows). */
export const DEFAULT_STREAMING_CHUNK_RADIUS = 3;
export const MAX_STREAMING_CHUNK_RADIUS = 3;
/** Offline worlds may opt into a larger bounded window without expanding Lakebed query limits. */
export const MAX_LOCAL_STREAMING_CHUNK_RADIUS = 6;
export const MAX_STREAMING_CHUNK_COUNT = (MAX_STREAMING_CHUNK_RADIUS * 2 + 1) ** 2;

export interface ChunkCoordinate {
  x: number;
  z: number;
}

export interface ChunkBounds extends ChunkCoordinate {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ChunkWindowPlan {
  center: ChunkCoordinate;
  active: ChunkCoordinate[];
  load: ChunkCoordinate[];
  unload: ChunkCoordinate[];
}

function normalizedChunkSize(size: number): number {
  return Number.isFinite(size) ? Math.max(1, Math.floor(size)) : WORLD_CHUNK_SIZE;
}

export function chunkCoordinate(value: number, size = WORLD_CHUNK_SIZE): number {
  return Math.floor(value / normalizedChunkSize(size));
}

export function chunkKey(x: number, z: number): string {
  return `${x},${z}`;
}

export function parseChunkKey(key: string): ChunkCoordinate {
  const separator = key.indexOf(",");
  return {
    x: Number(key.slice(0, separator)),
    z: Number(key.slice(separator + 1)),
  };
}

/** Inclusive block bounds for one globally anchored horizontal chunk. */
export function chunkBounds(x: number, z: number, size = WORLD_CHUNK_SIZE): ChunkBounds {
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new RangeError("Chunk coordinates must be finite numbers.");
  }
  const wholeSize = normalizedChunkSize(size);
  const chunkX = Math.floor(x);
  const chunkZ = Math.floor(z);
  const minX = chunkX * wholeSize;
  const minZ = chunkZ * wholeSize;
  return {
    x: chunkX,
    z: chunkZ,
    minX,
    maxX: minX + wholeSize - 1,
    minZ,
    maxZ: minZ + wholeSize - 1,
  };
}

function boundedWindowRadius(radius: number, maximumRadius: number): number {
  if (!Number.isFinite(radius)) return DEFAULT_STREAMING_CHUNK_RADIUS;
  return Math.max(0, Math.min(maximumRadius, Math.floor(radius)));
}

/**
 * Returns a stable, nearest-first chunk window around a block position. The
 * hard radius ceiling keeps generation, meshes, and Lakebed reads bounded even
 * if an invalid caller supplies an enormous view distance.
 */
export function chunkWindow(
  blockX: number,
  blockZ: number,
  radius = DEFAULT_STREAMING_CHUNK_RADIUS,
  size = WORLD_CHUNK_SIZE,
  maximumRadius = MAX_STREAMING_CHUNK_RADIUS,
): ChunkCoordinate[] {
  const center = {
    x: chunkCoordinate(Number.isFinite(blockX) ? blockX : 0, size),
    z: chunkCoordinate(Number.isFinite(blockZ) ? blockZ : 0, size),
  };
  const boundedRadius = boundedWindowRadius(radius, maximumRadius);
  const chunks: ChunkCoordinate[] = [];
  for (let dz = -boundedRadius; dz <= boundedRadius; dz += 1) {
    for (let dx = -boundedRadius; dx <= boundedRadius; dx += 1) {
      chunks.push({ x: center.x + dx, z: center.z + dz });
    }
  }
  chunks.sort((left, right) => {
    const leftDistance = Math.max(Math.abs(left.x - center.x), Math.abs(left.z - center.z));
    const rightDistance = Math.max(Math.abs(right.x - center.x), Math.abs(right.z - center.z));
    return leftDistance - rightDistance || left.z - right.z || left.x - right.x;
  });
  return chunks;
}

/** Plans incremental load/unload work without retaining an unbounded world map. */
export function planChunkWindow(
  blockX: number,
  blockZ: number,
  currentKeys: ReadonlySet<string>,
  radius = DEFAULT_STREAMING_CHUNK_RADIUS,
  size = WORLD_CHUNK_SIZE,
  maximumRadius = MAX_STREAMING_CHUNK_RADIUS,
): ChunkWindowPlan {
  const active = chunkWindow(blockX, blockZ, radius, size, maximumRadius);
  const activeKeys = new Set(active.map(({ x, z }) => chunkKey(x, z)));
  return {
    center: {
      x: chunkCoordinate(Number.isFinite(blockX) ? blockX : 0, size),
      z: chunkCoordinate(Number.isFinite(blockZ) ? blockZ : 0, size),
    },
    active,
    load: active.filter(({ x, z }) => !currentKeys.has(chunkKey(x, z))),
    unload: [...currentKeys]
      .filter((key) => !activeKeys.has(key))
      .map(parseChunkKey)
      .filter(({ x, z }) => Number.isInteger(x) && Number.isInteger(z))
      .sort((left, right) => left.z - right.z || left.x - right.x),
  };
}

export function chunkKeyForBlock(x: number, z: number, size = WORLD_CHUNK_SIZE): string {
  return chunkKey(chunkCoordinate(x, size), chunkCoordinate(z, size));
}

/**
 * A changed block always dirties its owning chunk. A block on a horizontal
 * chunk edge also changes face visibility in the chunk across that edge.
 */
export function dirtyChunkKeysForEdit(x: number, z: number, size = WORLD_CHUNK_SIZE): string[] {
  const chunkX = chunkCoordinate(x, size);
  const chunkZ = chunkCoordinate(z, size);
  const localX = x - chunkX * size;
  const localZ = z - chunkZ * size;
  const dirty = new Set<string>([chunkKey(chunkX, chunkZ)]);
  if (localX === 0) dirty.add(chunkKey(chunkX - 1, chunkZ));
  if (localX === size - 1) dirty.add(chunkKey(chunkX + 1, chunkZ));
  if (localZ === 0) dirty.add(chunkKey(chunkX, chunkZ - 1));
  if (localZ === size - 1) dirty.add(chunkKey(chunkX, chunkZ + 1));
  return [...dirty];
}

export function dirtyChunkKeysForEdits(
  edits: ReadonlyArray<{ x: number; z: number }>,
  size = WORLD_CHUNK_SIZE,
): string[] {
  const dirty = new Set<string>();
  for (const edit of edits) {
    for (const key of dirtyChunkKeysForEdit(edit.x, edit.z, size)) dirty.add(key);
  }
  return [...dirty];
}
