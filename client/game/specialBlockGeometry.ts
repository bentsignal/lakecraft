import { chestAtlasUv, textureAtlasPixelUv, textureAtlasUv, type TextureUvBounds } from "./blockTextures.ts";
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
export const SPECIAL_TORCH_COLOR_VERTEX_COUNT = 0;
export const SPECIAL_CHEST_TEXTURED_VERTEX_COUNT = 108;
export const SPECIAL_CHEST_COLOR_VERTEX_COUNT = 0;
export const SPECIAL_DOOR_TEXTURED_VERTEX_COUNT = 36;
export const SPECIAL_DOOR_COLOR_VERTEX_COUNT = 216;
export const SPECIAL_BED_TEXTURED_VERTEX_COUNT = 72;
export const SPECIAL_BED_COLOR_VERTEX_COUNT = 36;
export const SPECIAL_LADDER_TEXTURED_VERTEX_COUNT = 252;
export const SPECIAL_LADDER_COLOR_VERTEX_COUNT = 0;

function retainedShade(faceShade: number, exposureLevel?: number, emissive = false): number {
  return exposureLevel === undefined
    ? faceShade
    : packSkyExposureShade(faceShade, exposureLevel, emissive);
}

export type TorchMount = "floor" | "east" | "north" | "south" | "west";

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

type ChestFace = "east" | "west" | "top" | "bottom" | "south" | "north";

function chestFacePoint(face: ChestFace, min: Vec3, max: Vec3, horizontal: number, vertical: number): Vec3 {
  if (face === "east") return [max[0], min[1] + vertical * (max[1] - min[1]), max[2] - horizontal * (max[2] - min[2])];
  if (face === "west") return [min[0], min[1] + vertical * (max[1] - min[1]), min[2] + horizontal * (max[2] - min[2])];
  if (face === "top") return [min[0] + vertical * (max[0] - min[0]), max[1], min[2] + horizontal * (max[2] - min[2])];
  if (face === "bottom") return [min[0] + vertical * (max[0] - min[0]), min[1], max[2] - horizontal * (max[2] - min[2])];
  if (face === "south") return [min[0] + horizontal * (max[0] - min[0]), min[1] + vertical * (max[1] - min[1]), max[2]];
  return [max[0] - horizontal * (max[0] - min[0]), min[1] + vertical * (max[1] - min[1]), min[2]];
}

function appendChestFace(
  output: number[],
  face: ChestFace,
  min: Vec3,
  max: Vec3,
  sourceUv: readonly [number, number, number, number],
  shade: number,
  exposureLevel?: number,
): void {
  const [u0, v0, u1, v1] = sourceUv;
  const winding = [3, 2, 1, 3, 1, 0];
  const points = [
    [0, 0, u0, v1 - 1],
    [0, 1, u0, v0],
    [1, 1, u1 - 1, v0],
    [1, 0, u1 - 1, v1 - 1],
  ] as const;
  for (const pointIndex of winding) {
      const point = points[pointIndex]; const uv = chestAtlasUv(point[2], point[3]);
      output.push(
        ...chestFacePoint(face, min, max, point[0], point[1]),
        uv[0], uv[1], retainedShade(shade, exposureLevel),
      );
  }
}

function appendChestBox(
  output: number[],
  min: Vec3,
  max: Vec3,
  textureU: number,
  textureV: number,
  textureWidth: number,
  textureHeight: number,
  textureDepth: number,
  shade: number,
  exposureLevel?: number,
): void {
  const faces: Readonly<Record<ChestFace, readonly [number, number, number, number]>> = {
    west: [textureU, textureV + textureDepth, textureU + textureDepth, textureV + textureDepth + textureHeight],
    north: [textureU + textureDepth, textureV + textureDepth, textureU + textureDepth + textureWidth, textureV + textureDepth + textureHeight],
    east: [textureU + textureDepth + textureWidth, textureV + textureDepth, textureU + textureDepth * 2 + textureWidth, textureV + textureDepth + textureHeight],
    south: [textureU + textureDepth * 2 + textureWidth, textureV + textureDepth, textureU + textureDepth * 2 + textureWidth * 2, textureV + textureDepth + textureHeight],
    top: [textureU + textureDepth, textureV, textureU + textureDepth + textureWidth, textureV + textureDepth],
    bottom: [textureU + textureDepth + textureWidth, textureV, textureU + textureDepth + textureWidth * 2, textureV + textureDepth],
  };
  for (const face of CUBE_FACES) appendChestFace(output, face[0], min, max, faces[face[0]], face[4] * shade, exposureLevel);
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

function rotateWallTorchPoint(point: Vec3, mount: Exclude<TorchMount, "floor">): Vec3 {
  const angle = -22.5 * Math.PI / 180;
  const origin: Vec3 = [0, 3.5 / 16, 0.5];
  const dx = point[0] - origin[0];
  const dy = point[1] - origin[1];
  const tilted: Vec3 = [
    origin[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    origin[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
    point[2],
  ];
  const rotations = { east: 0, south: 90, west: 180, north: 270 } as const;
  const yaw = rotations[mount] * Math.PI / 180;
  const centeredX = tilted[0] - 0.5;
  const centeredZ = tilted[2] - 0.5;
  return [
    0.5 + centeredX * Math.cos(yaw) - centeredZ * Math.sin(yaw),
    tilted[1],
    0.5 + centeredX * Math.sin(yaw) + centeredZ * Math.cos(yaw),
  ];
}

/** Exact installed 26.2 floor/wall torch model and source-pixel UV rectangles. */
export function appendSpecialTorchMesh(
  output: SpecialBlockMeshOutputs,
  x: number,
  y: number,
  z: number,
  shade = 1,
  exposureLevel?: number,
  mount: TorchMount = "floor",
): void {
  const min: Vec3 = mount === "floor" ? [7 / 16, 0, 7 / 16] : [-1 / 16, 3.5 / 16, 7 / 16];
  const max: Vec3 = mount === "floor" ? [9 / 16, 10 / 16, 9 / 16] : [1 / 16, 13.5 / 16, 9 / 16];
  for (const face of CUBE_FACES) {
    const source = face[0] === "bottom" ? [7, 13, 9, 15]
      : face[0] === "top" ? [7, 6, 9, 8] : [7, 6, 9, 16];
    for (const point of face[5]) {
      const horizontal = face[1] !== 0 ? point[2] : point[0];
      const vertical = face[2] !== 0 ? point[2] : point[1];
      const local: Vec3 = [
        min[0] + point[0] * (max[0] - min[0]),
        min[1] + point[1] * (max[1] - min[1]),
        min[2] + point[2] * (max[2] - min[2]),
      ];
      const transformed = mount === "floor" ? local : rotateWallTorchPoint(local, mount);
      const uv = textureAtlasPixelUv(
        "torch",
        source[0] + 0.5 + horizontal * (source[2] - source[0] - 1),
        source[3] - 0.5 - vertical * (source[3] - source[1] - 1),
      );
      output.textured.push(x + transformed[0], y + transformed[1], z + transformed[2],
        uv[0], uv[1], retainedShade(shade, exposureLevel, true));
    }
  }
}

/** Exact installed normal-chest entity texture on the standard body, lid, and latch boxes. */
export function appendSpecialChestMesh(
  output: SpecialBlockMeshOutputs,
  x: number,
  y: number,
  z: number,
  shade = 1,
  exposureLevel?: number,
): void {
  // Exact closed single-chest cuboids from the installed client's
  // ChestModel.createSingleBodyLayer(): bottom (1,0,1)+(14,10,14), lid
  // (1,0,0)+(14,5,14) at (0,9,1), lock (7,-2,14)+(2,4,1) at (0,9,1).
  appendChestBox(output.textured,
    [x + 1 / 16, y, z + 1 / 16], [x + 15 / 16, y + 10 / 16, z + 15 / 16],
    0, 19, 14, 10, 14, shade, exposureLevel);
  appendChestBox(output.textured,
    [x + 1 / 16, y + 9 / 16, z + 1 / 16], [x + 15 / 16, y + 14 / 16, z + 15 / 16],
    0, 0, 14, 5, 14, shade, exposureLevel);
  appendChestBox(output.textured,
    [x + 7 / 16, y + 7 / 16, z + 15 / 16], [x + 9 / 16, y + 11 / 16, z + 1],
    0, 0, 2, 4, 1, shade, exposureLevel);
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
