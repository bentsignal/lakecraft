import type { PlayerSkinModel } from "./playerSkin.ts";

export const PLAYER_SKIN_VERTEX_STRIDE = 6;
export const PLAYER_SKIN_BOX_COUNT = 12;
export const PLAYER_SKIN_VERTEX_COUNT = PLAYER_SKIN_BOX_COUNT * 36;
export const PLAYER_SKIN_BOX_FLOATS = 36 * PLAYER_SKIN_VERTEX_STRIDE;

export type PlayerSkinPart = "head" | "body" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";
export const PLAYER_SKIN_PART_BOX_RANGES: Readonly<Record<PlayerSkinPart, readonly [number, number]>> = Object.freeze({
  head: [0, 2], body: [2, 4], rightArm: [4, 6], leftArm: [6, 8], rightLeg: [8, 10], leftLeg: [10, 12],
});

type Rect = readonly [u0: number, v0: number, u1: number, v1: number];
type Point = readonly [x: number, y: number, z: number];

type SkinBox = Readonly<{
  u: number;
  v: number;
  width: number;
  height: number;
  depth: number;
  min: Point;
  max: Point;
  inflate?: number;
}>;

type SkinBoxPair = readonly [
  baseU: number, baseV: number, overlayU: number, overlayV: number,
  width: number, height: number, depth: number, min: Point, max: Point,
];

const PIXEL = 1 / 16;

function appendQuad(output: number[], points: readonly [Point, Point, Point, Point], uv: Rect, shade: number): void {
  const [u0, v0, u1, v1] = uv.map((value) => value / 64) as [number, number, number, number];
  const corners = [
    [u0, v0], [u0, v1], [u1, v1],
    [u0, v0], [u1, v1], [u1, v0],
  ] as const;
  const indices = [0, 1, 2, 0, 2, 3] as const;
  for (let index = 0; index < indices.length; index += 1) {
    const point = points[indices[index]];
    const texture = corners[index];
    output.push(point[0], point[1], point[2], texture[0], texture[1], shade);
  }
}

function appendBox(output: number[], box: SkinBox): void {
  const inflate = box.inflate ?? 0;
  const x0 = box.min[0] - inflate; const y0 = box.min[1] - inflate; const z0 = box.min[2] - inflate;
  const x1 = box.max[0] + inflate; const y1 = box.max[1] + inflate; const z1 = box.max[2] + inflate;
  const { u, v, width: w, height: h, depth: d } = box;
  const right: Rect = [u, v + d, u + d, v + d + h];
  const front: Rect = [u + d, v + d, u + d + w, v + d + h];
  const left: Rect = [u + d + w, v + d, u + d + w + d, v + d + h];
  const back: Rect = [u + d + w + d, v + d, u + d + w + d + w, v + d + h];
  const top: Rect = [u + d, v, u + d + w, v + d];
  const bottom: Rect = [u + d + w, v, u + d + w + w, v + d];
  appendQuad(output, [[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]], right, 0.84);
  appendQuad(output, [[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]], front, 0.96);
  appendQuad(output, [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], left, 0.78);
  appendQuad(output, [[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]], back, 0.70);
  appendQuad(output, [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], top, 1);
  appendQuad(output, [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], bottom, 0.62);
}

function appendBoxPair(output: number[], pair: SkinBoxPair, inflate: number): void {
  const [u, v, overlayU, overlayV, width, height, depth, min, max] = pair;
  appendBox(output, { u, v, width, height, depth, min, max });
  appendBox(output, { u: overlayU, v: overlayV, width, height, depth, min, max, inflate });
}

/** Standard 64×64 skin UVs; 128×128 skins work because their coordinates normalize identically. */
export function buildPlayerSkinGeometry(model: PlayerSkinModel = "wide"): Float32Array {
  const armWidth = model === "slim" ? 3 : 4;
  const halfArm = armWidth * PIXEL / 2;
  const torsoHalf = 4 * PIXEL;
  const armCenter = torsoHalf + halfArm;
  const outer = 0.5 * PIXEL;
  const pairs: SkinBoxPair[] = [
    [0, 0, 32, 0, 8, 8, 8, [-4 * PIXEL, 24 * PIXEL, -4 * PIXEL], [4 * PIXEL, 32 * PIXEL, 4 * PIXEL]],
    [16, 16, 16, 32, 8, 12, 4, [-torsoHalf, 12 * PIXEL, -2 * PIXEL], [torsoHalf, 24 * PIXEL, 2 * PIXEL]],
    [40, 16, 40, 32, armWidth, 12, 4, [armCenter - halfArm, 12 * PIXEL, -2 * PIXEL], [armCenter + halfArm, 24 * PIXEL, 2 * PIXEL]],
    [32, 48, 48, 48, armWidth, 12, 4, [-armCenter - halfArm, 12 * PIXEL, -2 * PIXEL], [-armCenter + halfArm, 24 * PIXEL, 2 * PIXEL]],
    [0, 16, 0, 32, 4, 12, 4, [0, 0, -2 * PIXEL], [4 * PIXEL, 12 * PIXEL, 2 * PIXEL]],
    [16, 48, 0, 48, 4, 12, 4, [-4 * PIXEL, 0, -2 * PIXEL], [0, 12 * PIXEL, 2 * PIXEL]],
  ];
  const output: number[] = [];
  pairs.forEach((pair) => appendBoxPair(output, pair, outer));
  return new Float32Array(output);
}

/** Base and outer-layer vertices for one named standard-skin body part. */
export function buildPlayerSkinPartGeometry(
  part: PlayerSkinPart,
  model: PlayerSkinModel = "wide",
): Float32Array {
  const [startBox, endBox] = PLAYER_SKIN_PART_BOX_RANGES[part];
  return buildPlayerSkinGeometry(model).slice(startBox * PLAYER_SKIN_BOX_FLOATS, endBox * PLAYER_SKIN_BOX_FLOATS);
}
