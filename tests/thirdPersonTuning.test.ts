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
assert.equal(thirdPersonPoseGroupForItem("chest"), "otherItem");
assert.equal(thirdPersonPoseGroupForItem("torch"), "otherItem");

assert.deepEqual(THIRD_PERSON_TUNING.tool, {
  position: [-0.04, 0.09, 0], rotationDegrees: [-89, -71, -144], scale: 1,
});
assert.deepEqual(THIRD_PERSON_TUNING.block, {
  position: [0, 0, 0], rotationDegrees: [-4, -42, 2], scale: 1,
});
assert.deepEqual(THIRD_PERSON_TUNING.bow, {
  position: [0.06, -0.08, -0.09], rotationDegrees: [-2, -85, -50], scale: 1,
});
assert.deepEqual(THIRD_PERSON_TUNING.otherItem, {
  position: [0, 0.08, -0.09], rotationDegrees: [1, -100, 7], scale: 1,
});

const baseline = thirdPersonHeldItemPresentation("diamond_pickaxe", THIRD_PERSON_TUNING);
const edited = {
  ...THIRD_PERSON_TUNING,
  tool: { position: [0.1, -0.2, 0.3] as const, rotationDegrees: [10, 20, 30] as const, scale: 1.25 },
};
const tuned = thirdPersonHeldItemPresentation("diamond_pickaxe", edited);
assert.deepEqual(tuned.center, baseline.center!.map((value, index) =>
  value - THIRD_PERSON_TUNING.tool.position[index] + edited.tool.position[index]));
assert.deepEqual(tuned.rotationDegrees, baseline.rotationDegrees!.map((value, index) =>
  value - THIRD_PERSON_TUNING.tool.rotationDegrees[index] + edited.tool.rotationDegrees[index]));
assert.equal(tuned.size, baseline.size! / THIRD_PERSON_TUNING.tool.scale * edited.tool.scale);

const before = currentThirdPersonTuning().revision;
const published = publishThirdPersonTuning(edited);
assert.equal(published.revision, before + 1);
assert.equal(currentThirdPersonTuning().tuning.tool.scale, 1.25);
publishThirdPersonTuning(THIRD_PERSON_TUNING);

console.log("third-person pose tuning tests passed");
