import { BLOCK, isSlabBlock, stairFacingForBlock, type BlockId } from "./types.ts";

/** Stone-brick slabs occupy the lower half of their voxel cell. */
export const STONE_BRICK_SLAB_HEIGHT = 0.5;
export const BED_COLLISION_HEIGHT = 0.55;

/** Physical vertical extent for authored partial blocks; ordinary voxels remain one block tall. */
export function blockCollisionHeight(block: BlockId): number {
  return isSlabBlock(block) ? STONE_BRICK_SLAB_HEIGHT
    : block === BLOCK.BED ? BED_COLLISION_HEIGHT
      : 1;
}

/** Height of a partial block at one local horizontal point. */
export function blockCollisionHeightAt(block: BlockId, localX = 0.5, localZ = 0.5): number {
  const facing = stairFacingForBlock(block);
  if (!facing) return blockCollisionHeight(block);
  const high = facing === "east" ? localX >= 0.5
    : facing === "west" ? localX < 0.5
      : facing === "south" ? localZ >= 0.5 : localZ < 0.5;
  return high ? 1 : STONE_BRICK_SLAB_HEIGHT;
}

/**
 * Point/shape predicate used by both fine-step targeting and projectile cover.
 * Non-cubic decorative blocks retain their existing whole-cell targeting; the
 * slab is the only partial solid currently represented by the world protocol.
 */
export function blockContainsSolidPoint(
  block: BlockId,
  blockY: number,
  pointY: number,
  pointX = 0.5,
  pointZ = 0.5,
  blockX = Math.floor(pointX),
  blockZ = Math.floor(pointZ),
): boolean {
  if (block === BLOCK.AIR || !Number.isFinite(blockY) || !Number.isFinite(pointY)) return false;
  if (!isSlabBlock(block) && block !== BLOCK.BED && !stairFacingForBlock(block)) return true;
  const localX = pointX - blockX;
  const localZ = pointZ - blockZ;
  return pointY >= blockY - 0.0001
    && pointY <= blockY + blockCollisionHeightAt(block, localX, localZ) + 0.0001;
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

/** Exact player AABB overlap for slabs, stairs, beds, and ordinary cubes. */
export function playerIntersectsBlockCollisionShape(
  playerX: number,
  playerY: number,
  playerZ: number,
  bodyHeight: number,
  blockX: number,
  blockY: number,
  blockZ: number,
  block: BlockId,
): boolean {
  if (playerX + 0.29 <= blockX || playerX - 0.29 >= blockX + 1
    || playerZ + 0.29 <= blockZ || playerZ - 0.29 >= blockZ + 1) return false;
  const facing = stairFacingForBlock(block);
  if (!facing) return playerIntersectsBlockCollisionHeight(playerY, bodyHeight, blockY, block);
  const playerBottom = playerY + 0.001;
  const playerTop = playerY + Math.max(0.1, bodyHeight) - 0.01;
  if (playerTop <= blockY || playerBottom >= blockY + 1) return false;
  if (playerBottom < blockY + STONE_BRICK_SLAB_HEIGHT) return true;
  return facing === "east" ? playerX + 0.29 > blockX + 0.5
    : facing === "west" ? playerX - 0.29 < blockX + 0.5
      : facing === "south" ? playerZ + 0.29 > blockZ + 0.5
        : playerZ - 0.29 < blockZ + 0.5;
}

/** Support-plane check keeps sneaking feet attached to the slab's half-height top. */
export function blockSupportsPlayerFeet(
  block: BlockId,
  blockY: number,
  playerY: number,
  localX = 0.5,
  localZ = 0.5,
): boolean {
  if (![blockY, playerY].every(Number.isFinite)) return false;
  return Math.abs(playerY - (blockY + blockCollisionHeightAt(block, localX, localZ))) <= 0.081;
}

/** Shared deterministic half-step planner used after a grounded horizontal collision. */
export function planPlayerHalfStep(
  x: number,
  y: number,
  z: number,
  axis: 0 | 2,
  distance: number,
  grounded: boolean,
  verticalVelocity: number,
  collides: (x: number, y: number, z: number) => boolean,
  hasSupport: (x: number, y: number, z: number) => boolean,
): readonly [number, number, number] | null {
  if (!grounded || verticalVelocity > 0.01 || !Number.isFinite(distance)) return null;
  const nextX = axis === 0 ? x + distance : x;
  const nextY = y + STONE_BRICK_SLAB_HEIGHT;
  const nextZ = axis === 2 ? z + distance : z;
  return !collides(nextX, nextY, nextZ) && hasSupport(nextX, nextY, nextZ)
    ? [nextX, nextY, nextZ] : null;
}
