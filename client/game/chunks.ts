export const WORLD_CHUNK_SIZE = 8;

export interface ChunkCoordinate {
  x: number;
  z: number;
}

export function chunkCoordinate(value: number, size = WORLD_CHUNK_SIZE): number {
  return Math.floor(value / size);
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
