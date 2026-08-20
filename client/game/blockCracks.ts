import type { WorldEdit } from "./types.ts";
import {
  DESTROY_STAGE_COUNT,
  DESTROY_STAGE_HEIGHT,
  DESTROY_STAGE_RGBA,
  DESTROY_STAGE_WIDTH,
} from "./generated/destroyStageAtlas.ts";

export const WORLD_BLOCK_CRACK_STAGE_COUNT = DESTROY_STAGE_COUNT;
export const WORLD_BLOCK_CRACK_EPSILON = 0.004;
export const WORLD_BLOCK_CRACK_VERTEX_COUNT = 36;
export const WORLD_BLOCK_CRACK_VERTEX_FLOATS = 6;

export function worldBlockCrackStage(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) return -1;
  return Math.min(WORLD_BLOCK_CRACK_STAGE_COUNT - 1, Math.floor(progress * WORLD_BLOCK_CRACK_STAGE_COUNT));
}

function pushVertex(
  output: number[], x: number, y: number, z: number, u: number, v: number,
): void {
  // Position, exact destroy-atlas UV, and unattenuated shade. The ordinary
  // terrain program discards the one-alpha background and draws only Mojang's
  // authored crack pixels.
  output.push(x, y, z, u, v, 1);
}

function pushFace(
  output: number[],
  points: readonly (readonly [number, number, number])[],
  u0: number,
  u1: number,
  v0: number,
  v1: number,
): void {
  const uv = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]] as const;
  for (const index of [0, 1, 2, 0, 2, 3]) {
    const point = points[index];
    pushVertex(output, point[0], point[1], point[2], uv[index][0], uv[index][1]);
  }
}

/**
 * Appends the exact installed destroy-stage texture across every outer face of
 * the mined voxel. Half-texel UVs keep nearest filtering inside one 16x16 stage
 * of the vertical atlas; the small outward offset prevents z fighting.
 */
export function appendWorldBlockCrackFaces(
  output: number[],
  block: Pick<WorldEdit, "x" | "y" | "z">,
  progress: number,
  height = 1,
): number {
  const stage = worldBlockCrackStage(progress);
  if (stage < 0) return 0;
  const startLength = output.length;
  const e = WORLD_BLOCK_CRACK_EPSILON;
  const x0 = block.x - e, x1 = block.x + 1 + e;
  const y0 = block.y - e;
  const y1 = block.y + Math.max(0.01, Math.min(1, Number.isFinite(height) ? height : 1)) + e;
  const z0 = block.z - e, z1 = block.z + 1 + e;
  const u0 = 0.5 / DESTROY_STAGE_WIDTH;
  const u1 = (DESTROY_STAGE_WIDTH - 0.5) / DESTROY_STAGE_WIDTH;
  const atlasHeight = DESTROY_STAGE_HEIGHT * DESTROY_STAGE_COUNT;
  const v1 = 1 - (stage * DESTROY_STAGE_HEIGHT + 0.5) / atlasHeight;
  const v0 = 1 - (stage * DESTROY_STAGE_HEIGHT + DESTROY_STAGE_HEIGHT - 0.5) / atlasHeight;
  pushFace(output, [[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[x0,y0,z0]], u0, u1, v0, v1);
  pushFace(output, [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]], u0, u1, v0, v1);
  pushFace(output, [[x0,y0,z0],[x0,y0,z1],[x1,y0,z1],[x1,y0,z0]], u0, u1, v0, v1);
  pushFace(output, [[x0,y1,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1]], u0, u1, v0, v1);
  pushFace(output, [[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z0]], u0, u1, v0, v1);
  pushFace(output, [[x0,y0,z1],[x0,y1,z1],[x1,y1,z1],[x1,y0,z1]], u0, u1, v0, v1);
  return (output.length - startLength) / WORLD_BLOCK_CRACK_VERTEX_FLOATS;
}

export function createDestroyStageTexture(gl: WebGLRenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Unable to allocate the block destroy-stage texture.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DESTROY_STAGE_WIDTH,
    DESTROY_STAGE_HEIGHT * DESTROY_STAGE_COUNT, 0, gl.RGBA, gl.UNSIGNED_BYTE, DESTROY_STAGE_RGBA);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}
