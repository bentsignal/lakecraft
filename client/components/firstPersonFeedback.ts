/** Ten discrete damage frames mirror the stepped feedback of a voxel texture. */
export const BLOCK_CRACK_STAGE_COUNT = 10;

export function miningCrackStage(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) return -1;
  return Math.min(BLOCK_CRACK_STAGE_COUNT - 1, Math.floor(progress * BLOCK_CRACK_STAGE_COUNT));
}
