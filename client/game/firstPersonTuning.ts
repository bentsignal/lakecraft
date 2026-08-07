/**
 * FIRST-PERSON POSE LAB
 *
 * These are optional development deltas on top of the socketed viewmodel rig.
 * Position and pivot are retained for compatibility with saved Pose Lab state,
 * but the live renderer intentionally ignores them: the item grip may not move
 * away from the wrist socket. Rotation and scale remain safe live controls.
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
    pivot: [0.66, -0.82, -1.2] as FirstPersonVector,
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
    pivot: [0.4, 0, -1.12] as FirstPersonVector,
  },

  // EDIT `otherItem` FOR FOOD, MATERIALS, AND SPECIAL HELD BLOCK ITEMS.
  // Examples: torch, chest, bed, door, ladder, fence, fence gate, and sapling.
  otherItem: {
    position: [0, 0, 0] as FirstPersonVector,
    rotationDegrees: [0, 0, 0] as FirstPersonVector,
    scale: 1,
    pivot: [0.08, -0.04, -1.18] as FirstPersonVector,
  },

  // This prior live-reviewed angle combines the installed block transform with
  // the camera-hand presentation: top plus two sides, lower corner in hand.
  block: {
    center: [0, 0, 0] as FirstPersonVector,
    rotationDegrees: [28.648, -37.815, 2.292] as FirstPersonVector,
    size: 0.4,
  },
} as const;

export interface FirstPersonTuning {
  readonly rig: FirstPersonGroupTuning;
  readonly arm: FirstPersonGroupTuning;
  readonly tool: FirstPersonGroupTuning;
  readonly bow: FirstPersonGroupTuning;
  readonly otherItem: FirstPersonGroupTuning;
  readonly block: {
    readonly center: FirstPersonVector;
    readonly rotationDegrees: FirstPersonVector;
    readonly size: number;
  };
}

export interface FirstPersonTuningSnapshot {
  revision: number;
  tuning: FirstPersonTuning;
}

const LIVE_TUNING_SLOT = "__lakecraftLiveFirstPersonTuning";
const liveTuningHost = globalThis as typeof globalThis & {
  [LIVE_TUNING_SLOT]?: FirstPersonTuningSnapshot;
};

/**
 * The retained WebGL engine outlives ordinary Preact state changes. Keep the
 * newest Pose Lab object in one stable browser-global slot so the renderer can
 * observe it on its next active or paused frame.
 */
export function publishFirstPersonTuning(
  tuning: FirstPersonTuning,
): FirstPersonTuningSnapshot {
  const snapshot = {
    revision: (liveTuningHost[LIVE_TUNING_SLOT]?.revision ?? 0) + 1,
    tuning,
  };
  liveTuningHost[LIVE_TUNING_SLOT] = snapshot;
  return snapshot;
}

export function currentFirstPersonTuning(): FirstPersonTuningSnapshot {
  return liveTuningHost[LIVE_TUNING_SLOT] ?? publishFirstPersonTuning(FIRST_PERSON_TUNING);
}

publishFirstPersonTuning(FIRST_PERSON_TUNING);
