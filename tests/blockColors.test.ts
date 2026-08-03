import assert from "node:assert/strict";
import { BLOCK_MATERIAL_COLORS } from "../client/game/blockColors.ts";

const expected = [
  [0, 0, 0], [0.31, 0.66, 0.23], [0.48, 0.31, 0.17], [0.48, 0.51, 0.53],
  [0.49, 0.31, 0.14], [0.18, 0.48, 0.19], [0.69, 0.48, 0.25], [0.55, 0.35, 0.16],
  [0.76, 0.46, 0.14], [0.57, 0.31, 0.10], [0.57, 0.34, 0.14], [0.57, 0.34, 0.14],
  [0.72, 0.08, 0.07], [0.25, 0.27, 0.28], [0.66, 0.49, 0.35], [0.42, 0.44, 0.45],
  [0.67, 0.43, 0.19], [0.36, 0.39, 0.40], [0.78, 0.69, 0.45], [0.63, 0.84, 0.86],
  [0.78, 0.64, 0.17], [0.24, 0.78, 0.76], [0.72, 0.16, 0.12], [0.47, 0.45, 0.42],
  [0.86, 0.84, 0.78], [0.28, 0.55, 0.18], [0.43, 0.45, 0.43], [0.69, 0.48, 0.25],
  [0.69, 0.48, 0.25], [0.69, 0.48, 0.25], [0.43, 0.45, 0.43], [0.58, 0.64, 0.70],
  [0.68, 0.28, 0.20], [0.16, 0.17, 0.18],
];

assert.deepEqual(BLOCK_MATERIAL_COLORS, expected, "shared material palette preserves every double");
assert.deepEqual(
  new Float32Array(BLOCK_MATERIAL_COLORS.flat()),
  new Float32Array(expected.flat()),
  "particle palette preserves every Float32 bit pattern",
);

console.log("shared block material and particle palette parity: ok");
