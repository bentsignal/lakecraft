import type { WorldEdit } from "./types.ts";

export const WORLD_BLOCK_CRACK_STAGE_COUNT = 10;
export const WORLD_BLOCK_CRACK_EPSILON = 0.004;

type CrackPoint = readonly [number, number];
type CrackSegment = readonly [CrackPoint, CrackPoint];

// One new branch appears per stage. The same bounded pattern is projected onto
// all six faces so the feedback remains attached to the solid voxel from every
// camera angle instead of floating over its adjacent placement cell.
const CRACK_SEGMENTS: readonly CrackSegment[] = [
  [[0.50, 0.50], [0.40, 0.38]],
  [[0.40, 0.38], [0.29, 0.34]],
  [[0.40, 0.38], [0.39, 0.20]],
  [[0.50, 0.50], [0.63, 0.42]],
  [[0.63, 0.42], [0.75, 0.27]],
  [[0.63, 0.42], [0.82, 0.47]],
  [[0.50, 0.50], [0.43, 0.65]],
  [[0.43, 0.65], [0.25, 0.76]],
  [[0.50, 0.50], [0.64, 0.68]],
  [[0.64, 0.68], [0.76, 0.86]],
];

export function worldBlockCrackStage(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) return -1;
  return Math.min(WORLD_BLOCK_CRACK_STAGE_COUNT - 1, Math.floor(progress * WORLD_BLOCK_CRACK_STAGE_COUNT));
}

function pushLineVertex(output: number[], x: number, y: number, z: number): void {
  output.push(x, y, z, 0.035, 0.028, 0.02);
}

/**
 * Appends interleaved position/color GL.LINES vertices on the six outer faces
 * of the exact solid block being mined. It never references BlockTarget.place.
 */
export function appendWorldBlockCrackLines(
  output: number[],
  block: Pick<WorldEdit, "x" | "y" | "z">,
  progress: number,
  height = 1,
): number {
  const stage = worldBlockCrackStage(progress);
  if (stage < 0) return 0;
  const startLength = output.length;
  const e = WORLD_BLOCK_CRACK_EPSILON;
  const blockHeight = Number.isFinite(height) ? Math.max(0.01, Math.min(1, height)) : 1;
  for (let index = 0; index <= stage; index += 1) {
    const [[u1, v1], [u2, v2]] = CRACK_SEGMENTS[index];
    // West/east faces.
    pushLineVertex(output, block.x - e, block.y + v1 * blockHeight, block.z + u1);
    pushLineVertex(output, block.x - e, block.y + v2 * blockHeight, block.z + u2);
    pushLineVertex(output, block.x + 1 + e, block.y + v1 * blockHeight, block.z + u1);
    pushLineVertex(output, block.x + 1 + e, block.y + v2 * blockHeight, block.z + u2);
    // Bottom/top faces.
    pushLineVertex(output, block.x + u1, block.y - e, block.z + v1);
    pushLineVertex(output, block.x + u2, block.y - e, block.z + v2);
    pushLineVertex(output, block.x + u1, block.y + blockHeight + e, block.z + v1);
    pushLineVertex(output, block.x + u2, block.y + blockHeight + e, block.z + v2);
    // North/south faces.
    pushLineVertex(output, block.x + u1, block.y + v1 * blockHeight, block.z - e);
    pushLineVertex(output, block.x + u2, block.y + v2 * blockHeight, block.z - e);
    pushLineVertex(output, block.x + u1, block.y + v1 * blockHeight, block.z + 1 + e);
    pushLineVertex(output, block.x + u2, block.y + v2 * blockHeight, block.z + 1 + e);
  }
  return (output.length - startLength) / 6;
}
