import {
  BLOCK,
  isSlabBlock,
  isUpsideDownStairBlock,
  isWaterBlock,
  stairFacingForBlock,
  type BlockId,
  type StairFacing,
} from "./types.ts";

/** Stone-brick slabs occupy the lower half of their voxel cell. */
export const STONE_BRICK_SLAB_HEIGHT = 0.5;
export const BED_COLLISION_HEIGHT = 0.55;
export type StairShape = "straight" | "inner_left" | "inner_right" | "outer_left" | "outer_right";

const STAIR_VECTOR: Readonly<Record<StairFacing, readonly [number, number]>> = {
  east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1],
};

function stairLeft(facing: StairFacing): StairFacing {
  return facing === "east" ? "north" : facing === "north" ? "west" : facing === "west" ? "south" : "east";
}

function stairRight(facing: StairFacing): StairFacing {
  return stairLeft(stairLeft(stairLeft(facing)));
}

function matchingStairHalf(a: BlockId, b: BlockId): boolean {
  return stairFacingForBlock(b) !== null && isUpsideDownStairBlock(a) === isUpsideDownStairBlock(b);
}

function canTakeCorner(
  block: BlockId,
  facing: StairFacing,
  x: number,
  y: number,
  z: number,
  getBlock: (x: number, y: number, z: number) => BlockId,
): boolean {
  const vector = STAIR_VECTOR[facing];
  const neighbor = getBlock(x + vector[0], y, z + vector[1]);
  return !matchingStairHalf(block, neighbor) || stairFacingForBlock(neighbor) !== stairFacingForBlock(block);
}

/** Minecraft-style corner state is derived from neighbors, so edits remain one compact stair cell. */
export function stairShapeAt(
  block: BlockId,
  x: number,
  y: number,
  z: number,
  getBlock: (x: number, y: number, z: number) => BlockId,
): StairShape {
  const facing = stairFacingForBlock(block);
  if (!facing) return "straight";
  const vector = STAIR_VECTOR[facing];
  const front = getBlock(x + vector[0], y, z + vector[1]);
  const frontFacing = matchingStairHalf(block, front) ? stairFacingForBlock(front) : null;
  if (frontFacing === stairLeft(facing) && canTakeCorner(block, stairRight(facing), x, y, z, getBlock)) return "outer_left";
  if (frontFacing === stairRight(facing) && canTakeCorner(block, stairLeft(facing), x, y, z, getBlock)) return "outer_right";
  const back = getBlock(x - vector[0], y, z - vector[1]);
  const backFacing = matchingStairHalf(block, back) ? stairFacingForBlock(back) : null;
  if (backFacing === stairLeft(facing) && canTakeCorner(block, backFacing, x, y, z, getBlock)) return "inner_left";
  if (backFacing === stairRight(facing) && canTakeCorner(block, backFacing, x, y, z, getBlock)) return "inner_right";
  return "straight";
}

function stairHalfContains(facing: StairFacing, x: number, z: number): boolean {
  return facing === "east" ? x >= 0.5 : facing === "west" ? x < 0.5
    : facing === "south" ? z >= 0.5 : z < 0.5;
}

function stairStepContains(block: BlockId, x: number, z: number, shape: StairShape): boolean {
  const facing = stairFacingForBlock(block);
  if (!facing) return false;
  const front = stairHalfContains(facing, x, z);
  if (shape === "straight") return front;
  const side = stairHalfContains(shape.endsWith("left") ? stairLeft(facing) : stairRight(facing), x, z);
  return shape.startsWith("outer") ? front && side : front || (!front && side);
}

/** Physical vertical extent for authored partial blocks; ordinary voxels remain one block tall. */
export function blockCollisionHeight(block: BlockId): number {
  return isSlabBlock(block) ? STONE_BRICK_SLAB_HEIGHT
    : block === BLOCK.BED ? BED_COLLISION_HEIGHT
      : 1;
}

/** Height of a partial block at one local horizontal point. */
export function blockCollisionHeightAt(block: BlockId, localX = 0.5, localZ = 0.5, shape: StairShape = "straight"): number {
  const facing = stairFacingForBlock(block);
  if (!facing) return blockCollisionHeight(block);
  if (isUpsideDownStairBlock(block)) return 1;
  const high = stairStepContains(block, localX, localZ, shape);
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
  stairShape: StairShape = "straight",
): boolean {
  if (block === BLOCK.AIR || isWaterBlock(block) || !Number.isFinite(blockY) || !Number.isFinite(pointY)) return false;
  if (!isSlabBlock(block) && block !== BLOCK.BED && !stairFacingForBlock(block)) return true;
  const localX = pointX - blockX;
  const localZ = pointZ - blockZ;
  if (stairFacingForBlock(block)) {
    const localY = pointY - blockY;
    if (localY < -0.0001 || localY > 1.0001) return false;
    return isUpsideDownStairBlock(block)
      ? localY >= 0.5 - 0.0001 || stairStepContains(block, localX, localZ, stairShape)
      : localY <= 0.5 + 0.0001 || stairStepContains(block, localX, localZ, stairShape);
  }
  return pointY >= blockY - 0.0001
    && pointY <= blockY + blockCollisionHeightAt(block, localX, localZ, stairShape) + 0.0001;
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
  stairShape: StairShape = "straight",
): boolean {
  if (playerX + 0.29 <= blockX || playerX - 0.29 >= blockX + 1
    || playerZ + 0.29 <= blockZ || playerZ - 0.29 >= blockZ + 1) return false;
  const facing = stairFacingForBlock(block);
  if (!facing) return playerIntersectsBlockCollisionHeight(playerY, bodyHeight, blockY, block);
  const playerBottom = playerY + 0.001;
  const playerTop = playerY + Math.max(0.1, bodyHeight) - 0.01;
  if (playerTop <= blockY || playerBottom >= blockY + 1) return false;
  const intersectsStep = stairStepContains(block, playerX - blockX, playerZ - blockZ, stairShape)
    || stairStepContains(block, playerX - blockX + 0.29, playerZ - blockZ, stairShape)
    || stairStepContains(block, playerX - blockX - 0.29, playerZ - blockZ, stairShape)
    || stairStepContains(block, playerX - blockX, playerZ - blockZ + 0.29, stairShape)
    || stairStepContains(block, playerX - blockX, playerZ - blockZ - 0.29, stairShape);
  return isUpsideDownStairBlock(block)
    ? playerTop > blockY + 0.5 || (playerBottom < blockY + 0.5 && intersectsStep)
    : playerBottom < blockY + 0.5 || (playerTop > blockY + 0.5 && intersectsStep);
}

/** Support-plane check keeps sneaking feet attached to the slab's half-height top. */
export function blockSupportsPlayerFeet(
  block: BlockId,
  blockY: number,
  playerY: number,
  localX = 0.5,
  localZ = 0.5,
  stairShape: StairShape = "straight",
): boolean {
  if (![blockY, playerY].every(Number.isFinite)) return false;
  return Math.abs(playerY - (blockY + blockCollisionHeightAt(block, localX, localZ, stairShape))) <= 0.081;
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
