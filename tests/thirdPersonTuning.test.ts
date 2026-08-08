import assert from "node:assert/strict";
import {
  THIRD_PERSON_TUNING,
  currentThirdPersonTuning,
  publishThirdPersonTuning,
  thirdPersonPoseGroupForItem,
} from "../client/game/thirdPersonTuning.ts";
import { thirdPersonHeldItemPresentation } from "../client/game/playerSkinRenderer.ts";

assert.equal(thirdPersonPoseGroupForItem("diamond_pickaxe"), "tool");
assert.equal(thirdPersonPoseGroupForItem("bow"), "bow");
assert.equal(thirdPersonPoseGroupForItem("planks"), "block");
assert.equal(thirdPersonPoseGroupForItem("iron_ingot"), "otherItem");

const baseline = thirdPersonHeldItemPresentation("diamond_pickaxe", THIRD_PERSON_TUNING);
const edited = {
  ...THIRD_PERSON_TUNING,
  tool: { position: [0.1, -0.2, 0.3] as const, rotationDegrees: [10, 20, 30] as const, scale: 1.25 },
};
const tuned = thirdPersonHeldItemPresentation("diamond_pickaxe", edited);
assert.deepEqual(tuned.center, baseline.center!.map((value, index) => value + edited.tool.position[index]));
assert.deepEqual(tuned.rotationDegrees, baseline.rotationDegrees!.map((value, index) => value + edited.tool.rotationDegrees[index]));
assert.equal(tuned.size, baseline.size! * edited.tool.scale);

const before = currentThirdPersonTuning().revision;
const published = publishThirdPersonTuning(edited);
assert.equal(published.revision, before + 1);
assert.equal(currentThirdPersonTuning().tuning.tool.scale, 1.25);
publishThirdPersonTuning(THIRD_PERSON_TUNING);

console.log("third-person pose tuning tests passed");
