import { ITEMS, type ItemId } from "../../shared/game.ts";

export type ThirdPersonVector = readonly [x: number, y: number, z: number];
export type ThirdPersonPoseGroup = "block" | "tool" | "bow" | "otherItem";

export interface ThirdPersonGroupTuning {
  readonly position: ThirdPersonVector;
  readonly rotationDegrees: ThirdPersonVector;
  readonly scale: number;
}

function group(
  position: ThirdPersonVector,
  rotationDegrees: ThirdPersonVector,
  scale = 1,
): ThirdPersonGroupTuning {
  return Object.freeze({ position: Object.freeze(position), rotationDegrees: Object.freeze(rotationDegrees), scale });
}

/** Live Pose Lab deltas applied after each catalog-authored third-person transform. */
export const THIRD_PERSON_TUNING: Readonly<Record<ThirdPersonPoseGroup, ThirdPersonGroupTuning>> = Object.freeze({
  block: group([0, 0, 0], [-4, -42, 2]),
  tool: group([-0.04, 0.09, 0], [-89, -71, -144]),
  bow: group([0.06, -0.08, -0.09], [-2, -85, -50]),
  otherItem: group([0, 0.08, -0.09], [1, -100, 7]),
});

export type ThirdPersonTuning = typeof THIRD_PERSON_TUNING;

export interface ThirdPersonTuningSnapshot {
  readonly revision: number;
  readonly tuning: ThirdPersonTuning;
}

const LIVE_TUNING_SLOT = "__lakecraftLiveThirdPersonTuning";
const liveTuningHost = globalThis as typeof globalThis & {
  [LIVE_TUNING_SLOT]?: ThirdPersonTuningSnapshot;
};

export function thirdPersonPoseGroupForItem(itemId: ItemId): ThirdPersonPoseGroup {
  if (itemId === "bow") return "bow";
  if (itemId === "chest" || itemId === "torch") return "otherItem";
  if (ITEMS[itemId].tool) return "tool";
  if (ITEMS[itemId].category === "block" && itemId !== "torch") return "block";
  return "otherItem";
}

export function publishThirdPersonTuning(tuning: ThirdPersonTuning): ThirdPersonTuningSnapshot {
  const snapshot = Object.freeze({
    revision: (liveTuningHost[LIVE_TUNING_SLOT]?.revision ?? 0) + 1,
    tuning,
  });
  liveTuningHost[LIVE_TUNING_SLOT] = snapshot;
  return snapshot;
}

export function currentThirdPersonTuning(): ThirdPersonTuningSnapshot {
  return liveTuningHost[LIVE_TUNING_SLOT] ?? publishThirdPersonTuning(THIRD_PERSON_TUNING);
}

publishThirdPersonTuning(THIRD_PERSON_TUNING);
