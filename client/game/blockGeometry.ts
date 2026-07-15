import { BLOCK, type BlockId } from "./types.ts";

/** Stone-brick slabs occupy the lower half of their voxel cell. */
export const STONE_BRICK_SLAB_HEIGHT = 0.5;

/** Physical vertical extent for authored partial blocks; ordinary voxels remain one block tall. */
export function blockCollisionHeight(block: BlockId): number {
  return block === BLOCK.STONE_BRICK_SLAB ? STONE_BRICK_SLAB_HEIGHT : 1;
}

/**
 * Point/shape predicate used by both fine-step targeting and projectile cover.
 * Non-cubic decorative blocks retain their existing whole-cell targeting; the
 * slab is the only partial solid currently represented by the world protocol.
 */
export function blockContainsSolidPoint(block: BlockId, blockY: number, pointY: number): boolean {
  if (block === BLOCK.AIR || !Number.isFinite(blockY) || !Number.isFinite(pointY)) return false;
  if (block !== BLOCK.STONE_BRICK_SLAB) return true;
  return pointY >= blockY - 0.0001 && pointY <= blockY + STONE_BRICK_SLAB_HEIGHT + 0.0001;
}

/** Exact vertical AABB overlap used by player and mob collision against partial blocks. */
export function playerIntersectsBlockCollisionHeight(
  playerY: number,
  bodyHeight: number,
  blockY: number,
  block: BlockId,
): boolean {
  if (![playerY, bodyHeight, blockY].every(Number.isFinite) || bodyHeight <= 0) return false;
  const playerBottom = playerY + 0.001;
  const playerTop = playerY + Math.max(0.1, bodyHeight) - 0.01;
  return playerTop > blockY && playerBottom < blockY + blockCollisionHeight(block);
}

/** Support-plane check keeps sneaking feet attached to the slab's half-height top. */
export function blockSupportsPlayerFeet(block: BlockId, blockY: number, playerY: number): boolean {
  if (![blockY, playerY].every(Number.isFinite)) return false;
  return Math.abs(playerY - (blockY + blockCollisionHeight(block))) <= 0.081;
}
