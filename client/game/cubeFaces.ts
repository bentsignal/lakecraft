import type { BlockFace } from "./blockTextures.ts";

type Vec3 = readonly [number, number, number];

/** Face, neighbor xyz, shade, and winding shared by every cube mesh. */
export const CUBE_FACES: ReadonlyArray<readonly [
  face: BlockFace,
  neighborX: number,
  neighborY: number,
  neighborZ: number,
  shade: number,
  vertices: ReadonlyArray<Vec3>,
]> = [
  ["east", 1, 0, 0, 0.79, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 1, 1], [1, 0, 1]]],
  ["west", -1, 0, 0, 0.68, [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 0, 0]]],
  ["top", 0, 1, 0, 1, [[0, 1, 0], [0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 1], [1, 1, 0]]],
  ["bottom", 0, -1, 0, 0.52, [[0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1]]],
  ["south", 0, 0, 1, 0.88, [[1, 0, 1], [1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 1, 1], [0, 0, 1]]],
  ["north", 0, 0, -1, 0.73, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0], [1, 1, 0], [1, 0, 0]]],
];
