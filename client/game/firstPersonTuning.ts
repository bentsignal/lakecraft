/**
 * FIRST-PERSON POSE LAB
 *
 * Edit only the numbers in this file while Lakebed dev is running. Saving the
 * file hot-reloads the game, so this is the quickest place to dial in the held
 * arm, blocks, tools, and bow without touching renderer geometry.
 *
 * Camera-space axes:
 *   X: positive moves right
 *   Y: positive moves up
 *   Z: positive moves toward the camera (less negative is closer)
 * Rotations are degrees around X, Y, then Z. Group pivots are camera-space.
 */

export type FirstPersonVector = readonly [x: number, y: number, z: number];

export interface FirstPersonGroupTuning {
  position: FirstPersonVector;
  rotationDegrees: FirstPersonVector;
  scale: number;
  pivot: FirstPersonVector;
}

const unchanged = (pivot: FirstPersonVector): FirstPersonGroupTuning => ({
  position: [0, 0, 0],
  rotationDegrees: [0, 0, 0],
  scale: 1,
  pivot,
});

export const FIRST_PERSON_TUNING = {
  // Moves/rotates/scales the complete viewmodel, including the action swing.
  rig: {
    position: [0, 0, 0] as FirstPersonVector,
    rotationDegrees: [0, 0, 0] as FirstPersonVector,
    scale: 0.48,
    pivot: [0.66, -0.82, -1.20] as FirstPersonVector,
  },

  // Fine-tuning groups. These start neutral, so a changed value is an obvious
  // delta that can be copied into a bug report or commit.
  arm: unchanged([0.56, -0.49, -1.23]),
  tool: unchanged([0.14, -0.16, -1.17]),
  bow: unchanged([0.40, 0, -1.12]),
  otherItem: unchanged([0.08, -0.04, -1.18]),

  // Blocks use one cube, so their authored pose is exposed directly.
  block: {
    center: [0.14, -0.10, -1.36] as FirstPersonVector,
    rotationDegrees: [28.648, -37.815, 2.292] as FirstPersonVector,
    size: 0.64,
  },
} as const;
