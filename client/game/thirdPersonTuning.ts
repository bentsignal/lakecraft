import { ITEMS, type ItemId } from "../../shared/game.ts";

export type ThirdPersonVector = readonly [x: number, y: number, z: number];
export type ThirdPersonPoseGroup = "block" | "tool" | "bow" | "otherItem";

export interface ThirdPersonGroupTuning {
  readonly position: ThirdPersonVector;
  readonly rotationDegrees: ThirdPersonVector;
  readonly scale: number;
}

const NEUTRAL_GROUP: ThirdPersonGroupTuning = Object.freeze({
  position: Object.freeze([0, 0, 0] as ThirdPersonVector),
  rotationDegrees: Object.freeze([0, 0, 0] as ThirdPersonVector),
  scale: 1,
});

/** Live Pose Lab deltas applied after each catalog-authored third-person transform. */
export const THIRD_PERSON_TUNING: Readonly<Record<ThirdPersonPoseGroup, ThirdPersonGroupTuning>> = Object.freeze({
  block: NEUTRAL_GROUP,
  tool: NEUTRAL_GROUP,
  bow: NEUTRAL_GROUP,
  otherItem: NEUTRAL_GROUP,
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
