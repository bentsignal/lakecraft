import { WORLD_CHUNK_SIZE, chunkBounds, chunkKeyForBlock } from "./chunks.ts";
import { TERRAIN_MIN_Y } from "./terrain.ts";
import { BLOCK, blockStateName, isSlabBlock, isStairBlock, isTorchBlock, type BlockId } from "./types.ts";
import { WORLD_EDIT_MAX_Y } from "../../shared/worldChunks.ts";

export const SKY_EXPOSURE_LEVELS = 3;
export const SKY_EXPOSURE_SPILL_RADIUS = 2;
// Fully roofed terrain stays hostile-spawn dark, but is still barely readable
// without a torch on ordinary displays.
export const CAVE_LIGHT_FLOOR = 0.16;
export const SKY_SHADE_PACK_MARKER = 8;
export const SKY_SHADE_EMISSIVE_MARKER = 16;

export interface SkyOccluderColumn {
  /** Highest stone-like block that fully stops both visual and ecological skylight. */
  opaqueY: number;
  /** Highest leaf block, which attenuates visual skylight but still shelters hostile mobs. */
  leafY: number;
}

export type SkyOccluderColumns = Map<string, SkyOccluderColumn>;
export type SkyBlockLookup = (x: number, y: number, z: number) => BlockId;

export type SkyOccluderClass = 0 | 1 | 2;

export function skyColumnKey(x: number, z: number): string {
  return `${Math.floor(x)},${Math.floor(z)}`;
}

function isLeavesBlock(block: BlockId): boolean {
  return block === BLOCK.LEAVES || blockStateName(block).endsWith("_leaves");
}

/** Thin, transparent, or explicitly open blocks do not stop the cheap vertical daylight test. */
export function skyOccluderClass(block: BlockId): SkyOccluderClass {
  const state = blockStateName(block);
  if (isLeavesBlock(block)) return 1;
  return block !== BLOCK.AIR
    && !isTorchBlock(block)
    && block !== BLOCK.DOOR_CLOSED
    && block !== BLOCK.DOOR_OPEN
    && !state.includes("_door_")
    && block !== BLOCK.LADDER
    && block !== BLOCK.GLASS
    && block !== BLOCK.BED
    && block !== BLOCK.SAPLING
    && block !== BLOCK.OAK_FENCE
    && block !== BLOCK.OAK_FENCE_GATE_CLOSED
    && block !== BLOCK.OAK_FENCE_GATE_OPEN
    && !isSlabBlock(block)
    && !isStairBlock(block)
    ? 2
    : 0;
}

export function blockStopsSky(block: BlockId): boolean {
  return skyOccluderClass(block) !== 0;
}

/**
 * Replaces the 8x8 cached column tops owned by one streamed chunk. Every
 * column receives an entry, so a missing key unambiguously means "unloaded".
 */
export function writeChunkSkyOccluders(
  columns: SkyOccluderColumns,
  chunkX: number,
  chunkZ: number,
  blocks: Iterable<readonly [string, BlockId]>,
): void {
  const bounds = chunkBounds(chunkX, chunkZ);
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
      columns.set(skyColumnKey(x, z), {
        opaqueY: TERRAIN_MIN_Y - 1,
        leafY: TERRAIN_MIN_Y - 1,
      });
    }
  }
  for (const [key, block] of blocks) {
    if (!blockStopsSky(block)) continue;
    const [x, y, z] = key.split(",").map(Number);
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
    const columnKey = skyColumnKey(x, z);
    const column = columns.get(columnKey);
    if (!column) continue;
    if (isLeavesBlock(block)) column.leafY = Math.max(column.leafY, y);
    else column.opaqueY = Math.max(column.opaqueY, y);
  }
}

export function removeChunkSkyOccluders(
  columns: SkyOccluderColumns,
  chunkX: number,
  chunkZ: number,
): void {
  const bounds = chunkBounds(chunkX, chunkZ);
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) columns.delete(skyColumnKey(x, z));
  }
}

/** One bounded vertical probe refreshes an edited column; no flood fill or world scan is needed. */
export function refreshSkyOccluderColumn(
  columns: SkyOccluderColumns,
  x: number,
  z: number,
  readBlock: SkyBlockLookup,
): number {
  let opaqueY = TERRAIN_MIN_Y - 1;
  let leafY = TERRAIN_MIN_Y - 1;
  for (let y = WORLD_EDIT_MAX_Y; y >= TERRAIN_MIN_Y; y -= 1) {
    const block = readBlock(x, y, z);
    if (isLeavesBlock(block)) {
      leafY = Math.max(leafY, y);
      continue;
    }
    if (!blockStopsSky(block)) continue;
    opaqueY = y;
    break;
  }
  columns.set(skyColumnKey(x, z), { opaqueY, leafY });
  return Math.max(opaqueY, leafY);
}

/** Deduplicates explosion/tree batches so each changed column is scanned at most once. */
export function refreshEditedSkyColumns(
  columns: SkyOccluderColumns,
  edits: ReadonlyArray<Readonly<{ x: number; z: number }>>,
  readBlock: SkyBlockLookup,
): number {
  const changedColumns = new Map<string, readonly [number, number]>();
  for (const edit of edits) {
    const x = Math.floor(edit.x);
    const z = Math.floor(edit.z);
    changedColumns.set(skyColumnKey(x, z), [x, z]);
  }
  for (const [x, z] of changedColumns.values()) refreshSkyOccluderColumn(columns, x, z, readBlock);
  return changedColumns.size;
}

function columnVisualExposure(
  columns: ReadonlyMap<string, SkyOccluderColumn>,
  x: number,
  y: number,
  z: number,
): 0 | 2 | 3 {
  const key = skyColumnKey(x, z);
  const column = columns.get(key);
  if (!column) return 0;
  if (column.opaqueY >= y) return 0;
  return column.leafY >= y ? 2 : 3;
}

function columnSeesEcologySky(
  columns: ReadonlyMap<string, SkyOccluderColumn>,
  x: number,
  y: number,
  z: number,
): boolean {
  const column = columns.get(skyColumnKey(x, z));
  return column !== undefined && Math.max(column.opaqueY, column.leafY) < y;
}

/**
 * Vertical sky is full strength. A fixed two-column Manhattan fringe provides
 * a deterministic 3→2→1→0 transition at shafts and entrances without becoming
 * general light propagation.
 */
export function skyExposureLevel(
  columns: ReadonlyMap<string, SkyOccluderColumn>,
  x: number,
  y: number,
  z: number,
): 0 | 1 | 2 | 3 {
  const blockX = Math.floor(x);
  const blockY = Math.floor(y);
  const blockZ = Math.floor(z);
  const direct = columnVisualExposure(columns, blockX, blockY, blockZ);
  if (direct > 0) return direct;
  let best = 0;
  for (let distance = 1; distance <= SKY_EXPOSURE_SPILL_RADIUS; distance += 1) {
    for (let dx = -distance; dx <= distance; dx += 1) {
      const dz = distance - Math.abs(dx);
      const positive = columnVisualExposure(columns, blockX + dx, blockY, blockZ + dz);
      const negative = dz === 0 ? 0 : columnVisualExposure(columns, blockX + dx, blockY, blockZ - dz);
      best = Math.max(best, positive - distance, negative - distance);
    }
    if (best >= SKY_EXPOSURE_LEVELS - distance) break;
  }
  return Math.max(0, Math.min(2, best)) as 0 | 1 | 2;
}

/**
 * Gameplay light deliberately treats leaves as complete shelter. Visual
 * readability can therefore improve without changing spawning, burning, or
 * torch-safe habitat rules.
 */
export function skyEcologyExposureLevel(
  columns: ReadonlyMap<string, SkyOccluderColumn>,
  x: number,
  y: number,
  z: number,
): 0 | 1 | 2 | 3 {
  const blockX = Math.floor(x);
  const blockY = Math.floor(y);
  const blockZ = Math.floor(z);
  if (columnSeesEcologySky(columns, blockX, blockY, blockZ)) return 3;
  for (let distance = 1; distance <= SKY_EXPOSURE_SPILL_RADIUS; distance += 1) {
    for (let dx = -distance; dx <= distance; dx += 1) {
      const dz = distance - Math.abs(dx);
      if (columnSeesEcologySky(columns, blockX + dx, blockY, blockZ + dz)
        || (dz !== 0 && columnSeesEcologySky(columns, blockX + dx, blockY, blockZ - dz))) {
        return (SKY_EXPOSURE_LEVELS - distance) as 1 | 2;
      }
    }
  }
  return 0;
}

/**
 * Mesh invalidation includes one cell beyond the sampled light fringe because
 * a cube face reads sky exposure from its adjacent coordinate.
 */
export function skyExposureDirtyChunkKeysForEdits(
  edits: ReadonlyArray<Readonly<{ x: number; z: number }>>,
): string[] {
  const dirty = new Set<string>();
  const visitedColumns = new Set<string>();
  const meshRadius = SKY_EXPOSURE_SPILL_RADIUS + 1;
  for (const edit of edits) {
    const x = Math.floor(edit.x);
    const z = Math.floor(edit.z);
    const column = skyColumnKey(x, z);
    if (visitedColumns.has(column)) continue;
    visitedColumns.add(column);
    for (let dx = -meshRadius; dx <= meshRadius; dx += 1) {
      const remaining = meshRadius - Math.abs(dx);
      for (let dz = -remaining; dz <= remaining; dz += 1) {
        dirty.add(chunkKeyForBlock(x + dx, z + dz, WORLD_CHUNK_SIZE));
      }
    }
  }
  return [...dirty];
}

/** Packs four exposure levels beside the existing face shade without widening retained vertices. */
export function packSkyExposureShade(faceShade: number, exposureLevel: number, emissive = false): number {
  const shade = Number.isFinite(faceShade) ? Math.max(0, Math.min(1, faceShade)) : 1;
  const level = Number.isFinite(exposureLevel)
    ? Math.max(0, Math.min(SKY_EXPOSURE_LEVELS, Math.floor(exposureLevel)))
    : SKY_EXPOSURE_LEVELS;
  return SKY_SHADE_PACK_MARKER + Number(emissive) * SKY_SHADE_EMISSIVE_MARKER + level * 2 + shade;
}

export function unpackSkyExposureShade(
  packed: number,
): { faceShade: number; exposureLevel: 0 | 1 | 2 | 3; emissive: boolean } {
  if (!Number.isFinite(packed) || packed < SKY_SHADE_PACK_MARKER) {
    return { faceShade: Number.isFinite(packed) ? packed : 1, exposureLevel: 3, emissive: false };
  }
  const emissive = packed >= SKY_SHADE_PACK_MARKER + SKY_SHADE_EMISSIVE_MARKER;
  const encoded = packed - SKY_SHADE_PACK_MARKER - Number(emissive) * SKY_SHADE_EMISSIVE_MARKER;
  return {
    faceShade: encoded % 2,
    exposureLevel: Math.max(0, Math.min(3, Math.floor(encoded / 2))) as 0 | 1 | 2 | 3,
    emissive,
  };
}

/** Scalar mirror of the terrain shader's fixed cave floor/daylight mix. */
export function skyLitIntensity(surfaceIntensity: number, exposureLevel: number): number {
  const surface = Number.isFinite(surfaceIntensity) ? Math.max(0, surfaceIntensity) : CAVE_LIGHT_FLOOR;
  const exposure = Math.max(0, Math.min(SKY_EXPOSURE_LEVELS, Math.floor(exposureLevel)))
    / SKY_EXPOSURE_LEVELS;
  const readableExposure = exposure * (1.5 - 0.5 * exposure);
  return CAVE_LIGHT_FLOOR + (surface - CAVE_LIGHT_FLOOR) * readableExposure;
}
