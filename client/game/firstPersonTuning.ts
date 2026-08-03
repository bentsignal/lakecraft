/**
 * FIRST-PERSON POSE LAB
 *
 * Edit only the numbers in this file while Lakebed dev is running. Save this
 * file, then look at the PAUSED game in the browser: the pose updates by itself.
 * You do not need to unpause, click the game, or refresh the page.
 *
 * Start with ONE small change:
 *   position:        change by 0.02 (example: 0 becomes 0.02)
 *   rotationDegrees: change by 5    (example: 0 becomes 5)
 *   scale:           change by 0.05 (example: 1 becomes 1.05)
 *
 * Every row has three numbers in this order: [X, Y, Z]
 *   X: bigger moves RIGHT; smaller moves LEFT.
 *   Y: bigger moves UP; smaller moves DOWN.
 *   Z: bigger moves TOWARD YOU; smaller moves AWAY from you.
 *
 * rotationDegrees turns the object around X, Y, and Z. If you do not know
 * which turn you want, try changing one number by 5, save, and look. Undo the
 * change if it turned the wrong way. Leave pivot alone until position,
 * rotationDegrees, and scale have been tried.
 */

export type FirstPersonVector = readonly [x: number, y: number, z: number];

export interface FirstPersonGroupTuning {
  position: FirstPersonVector;
  rotationDegrees: FirstPersonVector;
  scale: number;
  pivot: FirstPersonVector;
}

export const FIRST_PERSON_TUNING = {
  // LEAVE THIS ALONE AT FIRST. `rig` moves everything together, including the
  // swing animation. Use it only after the individual object looks right.
  rig: {
    position: [0, 0, 0] as FirstPersonVector,
    rotationDegrees: [0, 0, 0] as FirstPersonVector,
    scale: 0.48,
    pivot: [0.66, -0.82, -1.20] as FirstPersonVector,
  },

  // EDIT `arm` FOR THE ARM AND EMPTY HAND.
  arm: {
    position: [0, 0, 0] as FirstPersonVector,
    rotationDegrees: [0, 0, 0] as FirstPersonVector,
    scale: 1,
    pivot: [0.56, -0.49, -1.23] as FirstPersonVector,
  },

  // EDIT `tool` FOR A PICKAXE, AXE, SHOVEL, OR SWORD.
  tool: {
    position: [0, 0, 0] as FirstPersonVector,
    rotationDegrees: [0, 0, 0] as FirstPersonVector,
    scale: 1,
    pivot: [0.14, -0.16, -1.17] as FirstPersonVector,
  },

  // EDIT `bow` FOR THE BOW.
  bow: {
    position: [0, 0, 0] as FirstPersonVector,
    rotationDegrees: [0, 0, 0] as FirstPersonVector,
    scale: 1,
    pivot: [0.40, 0, -1.12] as FirstPersonVector,
  },

  // EDIT `otherItem` FOR FOOD, MATERIALS, AND SPECIAL HELD BLOCK ITEMS.
  // Examples: torch, chest, bed, door, ladder, fence, fence gate, and sapling.
  otherItem: {
    position: [0, 0, 0] as FirstPersonVector,
    rotationDegrees: [0, 0, 0] as FirstPersonVector,
    scale: 1,
    pivot: [0.08, -0.04, -1.18] as FirstPersonVector,
  },

  // EDIT `block` FOR A FULL CUBE, such as dirt, stone, or planks. The stone
  // brick slab also uses this box. These items use `center`, `rotationDegrees`,
  // and `size` instead of the four knobs above. Use 0.02, 5 degrees, and 0.05
  // as the same safe first steps. Center is also [X, Y, Z].
  block: {
    center: [0.14, -0.10, -1.36] as FirstPersonVector,
    rotationDegrees: [28.648, -37.815, 2.292] as FirstPersonVector,
    size: 0.64,
  },
} as const;
