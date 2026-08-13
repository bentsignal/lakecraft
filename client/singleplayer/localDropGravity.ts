import { blockCollisionHeight } from "../game/blockGeometry.ts";
import {
  DEFAULT_STREAMING_CHUNK_RADIUS,
  WORLD_CHUNK_SIZE,
  chunkCoordinate,
  chunkKeyForBlock,
} from "../game/chunks.ts";
import { BLOCK, type BlockId } from "../game/types.ts";
import type { DroppedItemRenderItem } from "../game/droppedItemRenderer.ts";

export const LOCAL_DROP_FIXED_STEP_SECONDS = 1 / 60;
export const LOCAL_DROP_MAX_CATCH_UP_SECONDS = 0.1;
export const LOCAL_DROP_MAX_SUBSTEPS = 6;
export const LOCAL_DROP_GRAVITY = 24;
export const LOCAL_DROP_TERMINAL_VELOCITY = -24;

const SUPPORT_EPSILON = 0.0001;
const MAX_SUPPORT_READS_PER_STEP = 12;
const FENCE_SUPPORT_HEIGHT = 1.5;
const DOOR_SUPPORT_HEIGHT = 1.9;
const MAX_PARTIAL_SUPPORT_HEIGHT = DOOR_SUPPORT_HEIGHT;

export type LocalDroppedItem = DroppedItemRenderItem & {
  velocityY: number;
  settled: boolean;
  ownerPickupBlocked?: boolean;
};

export type LocalDropGravityClock = {
  accumulatorSeconds: number;
};

export type LocalDropGravityStats = {
  changed: boolean;
  movedSteps: number;
  processedSteps: number;
  blockReads: number;
  substeps: number;
};

export type LocalDropBlockLookup = (x: number, y: number, z: number) => BlockId;

export function createLocalDropGravityClock(): LocalDropGravityClock {
  return { accumulatorSeconds: 0 };
}

/** Vertical support extent for the collision-bearing local block palette. */
export function localDropBlockSupportHeight(block: BlockId): number {
  if (block === BLOCK.AIR || block === BLOCK.TORCH || block === BLOCK.DOOR_OPEN
    || block === BLOCK.OAK_FENCE_GATE_OPEN || block === BLOCK.LADDER || block === BLOCK.SAPLING) return 0;
  if (block === BLOCK.OAK_FENCE || block === BLOCK.OAK_FENCE_GATE_CLOSED) return FENCE_SUPPORT_HEIGHT;
  if (block === BLOCK.DOOR_CLOSED) return DOOR_SUPPORT_HEIGHT;
  return blockCollisionHeight(block);
}

export function localDropSimulationChunkKey(x: number, z: number): string {
  return chunkKeyForBlock(x, z);
}

export function localDropIsInSimulationWindow(
  drop: Readonly<Pick<LocalDroppedItem, "x" | "z">>,
  centerX: number,
  centerZ: number,
): boolean {
  const chunkX = chunkCoordinate(drop.x, WORLD_CHUNK_SIZE);
  const chunkZ = chunkCoordinate(drop.z, WORLD_CHUNK_SIZE);
  const centerChunkX = chunkCoordinate(centerX, WORLD_CHUNK_SIZE);
  const centerChunkZ = chunkCoordinate(centerZ, WORLD_CHUNK_SIZE);
  return Math.abs(chunkX - centerChunkX) <= DEFAULT_STREAMING_CHUNK_RADIUS
    && Math.abs(chunkZ - centerChunkZ) <= DEFAULT_STREAMING_CHUNK_RADIUS;
}

function sweptSupport(
  drop: Readonly<Pick<LocalDroppedItem, "x" | "z">>,
  fromY: number,
  toY: number,
  readBlock: LocalDropBlockLookup,
): { y: number; reads: number } | null {
  if (![drop.x, drop.z, fromY, toY].every(Number.isFinite)) return null;
  const blockX = Math.floor(drop.x);
  const blockZ = Math.floor(drop.z);
  const highest = Math.max(fromY, toY);
  const lowest = Math.min(fromY, toY);
  const minimumBlockY = Math.floor(lowest - MAX_PARTIAL_SUPPORT_HEIGHT);
  let supportY = -Infinity;
  let reads = 0;
  for (let blockY = Math.floor(highest); blockY >= minimumBlockY && reads < MAX_SUPPORT_READS_PER_STEP; blockY -= 1) {
    const height = localDropBlockSupportHeight(readBlock(blockX, blockY, blockZ));
    reads += 1;
    if (height <= 0) continue;
    const top = blockY + height;
    if (top <= highest + SUPPORT_EPSILON && top >= lowest - SUPPORT_EPSILON) {
      supportY = Math.max(supportY, top);
    }
  }
  return Number.isFinite(supportY) ? { y: supportY, reads } : { y: -Infinity, reads };
}

export function localDroppedItemHasSupport(
  drop: Readonly<LocalDroppedItem>,
  readBlock: LocalDropBlockLookup,
): boolean {
  const support = sweptSupport(drop, drop.y + SUPPORT_EPSILON, drop.y - SUPPORT_EPSILON, readBlock);
  return Boolean(support && Number.isFinite(support.y) && Math.abs(support.y - drop.y) <= SUPPORT_EPSILON * 2);
}

/** One pure fixed gravity step with a bounded swept support query, so fast drops cannot tunnel. */
export function stepLocalDroppedItemGravity(
  drop: Readonly<LocalDroppedItem>,
  elapsedSeconds: number,
  readBlock: LocalDropBlockLookup,
): { drop: LocalDroppedItem; blockReads: number } {
  if (drop.settled || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return { drop: drop as LocalDroppedItem, blockReads: 0 };
  }
  const dt = Math.min(LOCAL_DROP_FIXED_STEP_SECONDS, elapsedSeconds);
  const currentVelocity = Number.isFinite(drop.velocityY)
    ? Math.max(LOCAL_DROP_TERMINAL_VELOCITY, Math.min(0, drop.velocityY))
    : 0;
  const velocityY = Math.max(LOCAL_DROP_TERMINAL_VELOCITY, currentVelocity - LOCAL_DROP_GRAVITY * dt);
  const nextY = drop.y + velocityY * dt;
  const support = sweptSupport(drop, drop.y, nextY, readBlock);
  if (support && Number.isFinite(support.y)) {
    return { drop: { ...drop, y: support.y, velocityY: 0, settled: true }, blockReads: support.reads };
  }
  return {
    drop: { ...drop, y: nextY, velocityY, settled: false },
    blockReads: support?.reads ?? 0,
  };
}

/**
 * Advances only caller-selected visible, unsettled indices. The fixed clock
 * makes 30/60/144 Hz schedules equivalent and drops excess catch-up work.
 */
export function advanceLocalDropGravity(
  drops: LocalDroppedItem[],
  activeIndices: Set<number>,
  clock: LocalDropGravityClock,
  elapsedSeconds: number,
  readBlock: LocalDropBlockLookup,
  movedIndices?: Set<number>,
): LocalDropGravityStats {
  movedIndices?.clear();
  const stats: LocalDropGravityStats = {
    changed: false, movedSteps: 0, processedSteps: 0, blockReads: 0, substeps: 0,
  };
  if (activeIndices.size === 0) {
    clock.accumulatorSeconds = 0;
    return stats;
  }
  const elapsed = Number.isFinite(elapsedSeconds)
    ? Math.max(0, Math.min(LOCAL_DROP_MAX_CATCH_UP_SECONDS, elapsedSeconds))
    : 0;
  clock.accumulatorSeconds = Math.min(LOCAL_DROP_MAX_CATCH_UP_SECONDS, clock.accumulatorSeconds + elapsed);
  const substeps = Math.min(
    LOCAL_DROP_MAX_SUBSTEPS,
    Math.floor((clock.accumulatorSeconds + Number.EPSILON) / LOCAL_DROP_FIXED_STEP_SECONDS),
  );
  if (substeps <= 0) return stats;
  clock.accumulatorSeconds = Math.max(0, clock.accumulatorSeconds - substeps * LOCAL_DROP_FIXED_STEP_SECONDS);
  stats.substeps = substeps;
  for (let step = 0; step < substeps; step += 1) {
    for (const index of activeIndices) {
      const current = drops[index];
      if (!current || current.settled) {
        activeIndices.delete(index);
        continue;
      }
      const result = stepLocalDroppedItemGravity(current, LOCAL_DROP_FIXED_STEP_SECONDS, readBlock);
      drops[index] = result.drop;
      stats.changed = true;
      stats.movedSteps += 1;
      stats.processedSteps += 1;
      stats.blockReads += result.blockReads;
      movedIndices?.add(index);
      if (result.drop.settled) activeIndices.delete(index);
    }
  }
  return stats;
}

/**
 * One bounded scan on a chunk-window/drop-array change. Stable supported drops
 * stay out of the active set; stale saved support is revalidated on stream-in.
 */
export function rebuildActiveLocalDropIndices(
  drops: LocalDroppedItem[],
  activeIndices: Set<number>,
  centerX: number,
  centerZ: number,
  readBlock?: LocalDropBlockLookup,
): { active: number; woken: number } {
  activeIndices.clear();
  let woken = 0;
  for (let index = 0; index < drops.length; index += 1) {
    let drop = drops[index];
    if (!localDropIsInSimulationWindow(drop, centerX, centerZ)) continue;
    if (drop.settled && readBlock && !localDroppedItemHasSupport(drop, readBlock)) {
      drop = { ...drop, velocityY: 0, settled: false };
      drops[index] = drop;
      woken += 1;
    }
    if (!drop.settled) activeIndices.add(index);
  }
  return { active: activeIndices.size, woken };
}

/** Rechecks only settled drops in edited horizontal columns after terrain changes. */
export function wakeUnsupportedLocalDroppedItems(
  drops: LocalDroppedItem[],
  columns: readonly Readonly<{ x: number; z: number }>[],
  readBlock: LocalDropBlockLookup,
): number {
  let woken = 0;
  for (let index = 0; index < drops.length; index += 1) {
    const drop = drops[index];
    if (!drop.settled || !columns.some((column) => Math.floor(drop.x) === column.x && Math.floor(drop.z) === column.z)
      || localDroppedItemHasSupport(drop, readBlock)) continue;
    drops[index] = { ...drop, velocityY: 0, settled: false };
    woken += 1;
  }
  return woken;
}
