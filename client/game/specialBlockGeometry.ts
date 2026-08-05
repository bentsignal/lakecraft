import { textureAtlasUv, type TextureUvBounds } from "./blockTextures.ts";
import { CUBE_FACES } from "./cubeFaces.ts";
import { packSkyExposureShade } from "./skyExposure.ts";
import type { BedDirection } from "./types.ts";

type Vec3 = readonly [number, number, number];

/**
 * Special blocks share the retained world batches instead of owning a draw
 * call. Wood and cloth surfaces use Lakecraft's authored atlas materials;
 * small identity details remain in the established color batch.
 */
export type SpecialBlockMeshOutputs = Readonly<{
  textured: number[];
  color: number[];
}>;

export const SPECIAL_TORCH_TEXTURED_VERTEX_COUNT = 36;
export const SPECIAL_TORCH_COLOR_VERTEX_COUNT = 36;
export const SPECIAL_CHEST_TEXTURED_VERTEX_COUNT = 72;
export const SPECIAL_CHEST_COLOR_VERTEX_COUNT = 72;
export const SPECIAL_DOOR_TEXTURED_VERTEX_COUNT = 36;
export const SPECIAL_DOOR_COLOR_VERTEX_COUNT = 216;
export const SPECIAL_BED_TEXTURED_VERTEX_COUNT = 72;
export const SPECIAL_BED_COLOR_VERTEX_COUNT = 36;
export const SPECIAL_LADDER_TEXTURED_VERTEX_COUNT = 252;
export const SPECIAL_LADDER_COLOR_VERTEX_COUNT = 0;

function retainedShade(faceShade: number, exposureLevel?: number): number {
  return exposureLevel === undefined
    ? faceShade
    : packSkyExposureShade(faceShade, exposureLevel);
}

function appendTexturedBox(
  output: number[],
  min: Vec3,
  max: Vec3,
  texture: "oak_planks" | "wool",
  shade: number,
  exposureLevel?: number,
): void {
  const uv: TextureUvBounds = textureAtlasUv(texture);
  for (const face of CUBE_FACES) {
    for (const point of face[5]) {
      const horizontal = face[1] !== 0 ? point[2] : point[0];
      const vertical = face[2] !== 0 ? point[2] : point[1];
      output.push(
        min[0] + point[0] * (max[0] - min[0]),
        min[1] + point[1] * (max[1] - min[1]),
        min[2] + point[2] * (max[2] - min[2]),
        uv.left + (uv.right - uv.left) * horizontal,
        uv.bottom + (uv.top - uv.bottom) * vertical,
        retainedShade(face[4] * shade, exposureLevel),
      );
    }
  }
}

function tint(color: Vec3, shade: number): [number, number, number] {
  return [color[0] * shade, color[1] * shade, color[2] * shade];
}

function appendColorBox(output: number[], min: Vec3, max: Vec3, color: Vec3): void {
  for (const face of CUBE_FACES) {
    const shaded = tint(color, face[4]);
    for (const point of face[5]) {
      output.push(
        min[0] + point[0] * (max[0] - min[0]),
        min[1] + point[1] * (max[1] - min[1]),
        min[2] + point[2] * (max[2] - min[2]),
        shaded[0], shaded[1], shaded[2],
      );
    }
  }
}

/** A narrow oak stem with a deliberately oversized warm ember cap. */
export function appendSpecialTorchMesh(
  output: SpecialBlockMeshOutputs,
  x: number,
  y: number,
  z: number,
  shade = 1,
  exposureLevel?: number,
): void {
  appendTexturedBox(
    output.textured,
    [x + 0.42, y, z + 0.42],
    [x + 0.58, y + 0.7, z + 0.58],
    "oak_planks",
    shade,
    exposureLevel,
  );
  appendColorBox(
    output.color,
    [x + 0.38, y + 0.67, z + 0.38],
    [x + 0.62, y + 0.88, z + 0.62],
    [1, 0.58, 0.11],
  );
}

/** Atlas-grained body and lid with a compact original gold latch. */
export function appendSpecialChestMesh(
  output: SpecialBlockMeshOutputs,
  x: number,
  y: number,
  z: number,
  shade = 1,
  exposureLevel?: number,
): void {
  appendTexturedBox(
    output.textured,
    [x + 0.04, y, z + 0.04],
    [x + 0.96, y + 0.64, z + 0.96],
    "oak_planks",
    shade * 0.9,
    exposureLevel,
  );
  appendTexturedBox(
    output.textured,
    [x + 0.02, y + 0.64, z + 0.02],
    [x + 0.98, y + 0.92, z + 0.98],
    "oak_planks",
    shade,
    exposureLevel,
  );
  appendColorBox(
    output.color,
    [x + 0.025, y + 0.53, z + 0.025],
    [x + 0.975, y + 0.62, z + 0.975],
    [0.34, 0.18, 0.065],
  );
  appendColorBox(
    output.color,
    [x + 0.43, y + 0.48, z + 0.92],
    [x + 0.57, y + 0.70, z + 1.01],
    [0.86, 0.68, 0.20],
  );
}

/**
 * One thin atlas-grained slab. Its panel relief and handle remain color
 * details, preserving the same closed/open silhouettes and collision contract.
 */
export function appendSpecialDoorMesh(
  output: SpecialBlockMeshOutputs,
  x: number,
  y: number,
  z: number,
  open: boolean,
  shade = 1,
  exposureLevel?: number,
): void {
  if (open) {
    appendTexturedBox(
      output.textured,
      [x + 0.05, y, z + 0.02],
      [x + 0.15, y + 1.9, z + 0.98],
      "oak_planks",
      shade,
      exposureLevel,
    );
    appendColorBox(output.color, [x + 0.035, y + 0.18, z + 0.16], [x + 0.065, y + 0.75, z + 0.84], [0.38, 0.20, 0.07]);
    appendColorBox(output.color, [x + 0.035, y + 1.05, z + 0.16], [x + 0.065, y + 1.70, z + 0.84], [0.38, 0.20, 0.07]);
    appendColorBox(output.color, [x, y + 0.90, z + 0.77], [x + 0.05, y + 1.0, z + 0.87], [0.84, 0.69, 0.22]);
    appendColorBox(output.color, [x + 0.135, y + 0.18, z + 0.16], [x + 0.165, y + 0.75, z + 0.84], [0.38, 0.20, 0.07]);
    appendColorBox(output.color, [x + 0.135, y + 1.05, z + 0.16], [x + 0.165, y + 1.70, z + 0.84], [0.38, 0.20, 0.07]);
    appendColorBox(output.color, [x + 0.15, y + 0.90, z + 0.77], [x + 0.20, y + 1.0, z + 0.87], [0.84, 0.69, 0.22]);
    return;
  }
  appendTexturedBox(
    output.textured,
    [x + 0.02, y, z + 0.45],
    [x + 0.98, y + 1.9, z + 0.55],
    "oak_planks",
    shade,
    exposureLevel,
  );
  appendColorBox(output.color, [x + 0.16, y + 0.18, z + 0.42], [x + 0.84, y + 0.75, z + 0.455], [0.38, 0.20, 0.07]);
  appendColorBox(output.color, [x + 0.16, y + 1.05, z + 0.42], [x + 0.84, y + 1.70, z + 0.455], [0.38, 0.20, 0.07]);
  appendColorBox(output.color, [x + 0.77, y + 0.90, z + 0.38], [x + 0.87, y + 1.0, z + 0.43], [0.84, 0.69, 0.22]);
  appendColorBox(output.color, [x + 0.16, y + 0.18, z + 0.545], [x + 0.84, y + 0.75, z + 0.58], [0.38, 0.20, 0.07]);
  appendColorBox(output.color, [x + 0.16, y + 1.05, z + 0.545], [x + 0.84, y + 1.70, z + 0.58], [0.38, 0.20, 0.07]);
  appendColorBox(output.color, [x + 0.77, y + 0.90, z + 0.57], [x + 0.87, y + 1.0, z + 0.62], [0.84, 0.69, 0.22]);
}

/**
 * A paired bed stays one continuous two-cell object. The frame and pillow use
 * authored wood/wool tiles; one uninterrupted color box preserves the blanket
 * with no internal cell seam.
 */
export function appendSpecialBedMesh(
  output: SpecialBlockMeshOutputs,
  x: number,
  y: number,
  z: number,
  part: "single" | "foot" | "head" = "single",
  direction: BedDirection = "north",
  shade = 1,
  exposureLevel?: number,
): void {
  if (part === "head") return;
  const paired = part === "foot";
  const dx = paired ? (direction === "east" ? 1 : direction === "west" ? -1 : 0) : 0;
  const dz = paired ? (direction === "south" ? 1 : direction === "north" ? -1 : 0) : 0;
  const headX = x + dx;
  const headZ = z + dz;
  const longX = dx !== 0;
  const longZ = dz !== 0;
  const minX = Math.min(x, headX);
  const minZ = Math.min(z, headZ);
  appendTexturedBox(
    output.textured,
    [minX + (longX ? 0.03 : 0.08), y + 0.08, minZ + (longZ ? 0.03 : 0.08)],
    [Math.max(x, headX) + (longX ? 0.97 : 0.92), y + 0.32, Math.max(z, headZ) + (longZ ? 0.97 : 0.92)],
    "oak_planks",
    shade * 0.82,
    exposureLevel,
  );
  appendColorBox(
    output.color,
    [minX + (longX ? 0.04 : 0.09), y + 0.32, minZ + (longZ ? 0.04 : 0.09)],
    [Math.max(x, headX) + (longX ? 0.96 : 0.91), y + 0.53, Math.max(z, headZ) + (longZ ? 0.96 : 0.91)],
    [0.72, 0.10, 0.12],
  );
  const pillowMin: Vec3 = direction === "east" ? [headX + 0.66, y + 0.32, headZ + 0.11]
    : direction === "west" ? [headX + 0.09, y + 0.32, headZ + 0.11]
      : direction === "south" ? [headX + 0.11, y + 0.32, headZ + 0.66]
        : [headX + 0.11, y + 0.32, headZ + 0.09];
  const pillowMax: Vec3 = direction === "east" ? [headX + 0.91, y + 0.55, headZ + 0.89]
    : direction === "west" ? [headX + 0.34, y + 0.55, headZ + 0.89]
      : direction === "south" ? [headX + 0.89, y + 0.55, headZ + 0.91]
        : [headX + 0.89, y + 0.55, headZ + 0.34];
  appendTexturedBox(output.textured, pillowMin, pillowMax, "wool", shade, exposureLevel);
}

/** Two atlas-grained rails and five rungs form the fixed north-facing ladder. */
export function appendSpecialLadderMesh(
  output: SpecialBlockMeshOutputs,
  x: number,
  y: number,
  z: number,
  shade = 1,
  exposureLevel?: number,
): void {
  appendTexturedBox(output.textured, [x + 0.13, y + 0.03, z + 0.84], [x + 0.23, y + 0.97, z + 0.93], "oak_planks", shade * 0.84, exposureLevel);
  appendTexturedBox(output.textured, [x + 0.77, y + 0.03, z + 0.84], [x + 0.87, y + 0.97, z + 0.93], "oak_planks", shade * 0.84, exposureLevel);
  for (let rung = 0; rung < 5; rung += 1) {
    const rungY = y + 0.12 + rung * 0.19;
    appendTexturedBox(output.textured, [x + 0.18, rungY, z + 0.78], [x + 0.82, rungY + 0.07, z + 0.98], "oak_planks", shade, exposureLevel);
  }
}
