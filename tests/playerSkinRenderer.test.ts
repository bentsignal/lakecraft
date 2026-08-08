import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAYER_SKIN_VERTEX_COUNT } from "../client/game/playerSkinGeometry.ts";
import { thirdPersonHeldItemPresentation } from "../client/game/playerSkinRenderer.ts";
import { THIRD_PERSON_TUNING, thirdPersonPoseGroupForItem } from "../client/game/thirdPersonTuning.ts";
import { blockIdForCubeItem } from "../client/game/blockItemCubeGeometry.ts";
import { resolvePlayerRigPose, writePlayerRigPartMatrix } from "../client/game/playerRig.ts";
import { itemVisual } from "../shared/visualCatalog.ts";

const source = readFileSync(new URL("../client/game/playerSkinRenderer.ts", import.meta.url), "utf8");
for (const contract of [
  "buildPlayerSkinGeometry", "gl.NEAREST", "gl.CLAMP_TO_EDGE", "uSkin", "uLight",
  "Math.PI - pose.yaw", "gl.enable(gl.BLEND)", "PLAYER_RIG_SKIN_DRAWS", "setPartMvp",
  "appendItemSpriteGeometry", "setHeldItem(itemId)", "heldItemVertexCount",
  "buildPlayerArmorGeometry", "setArmor(appearance)", "armorVertexCount",
  "itemVisual(itemId)", "display.thirdPersonRight", "thirdPersonHeldItemPresentation(heldItem, tuning)",
  "appendBlockItemCubeGeometry", "blockIdForCubeItem(heldItem)",
  "resolvePlayerRigPose(rig)", "playerArmorRigDraws", "setPartMvp(\"rightArm\", true", "drawCallCount",
  "currentThirdPersonTuning()", "heldItemTuningRevision", "rebuildHeldItemGeometry",
]) assert.ok(source.includes(contract), `world skin renderer retains ${contract}`);
for (const itemId of ["dirt", "diamond_pickaxe", "apple", "bow"] as const) {
  const presentation = thirdPersonHeldItemPresentation(itemId);
  const display = itemVisual(itemId).display.thirdPersonRight;
  const tuning = THIRD_PERSON_TUNING[thirdPersonPoseGroupForItem(itemId)];
  assert.deepEqual(presentation.rotationDegrees, display.rotationDegrees.map((value, index) =>
    value + tuning.rotationDegrees[index]), `${itemId} consumes the reviewed third-person rotation delta`);
  assert.equal(
    presentation.size,
    (blockIdForCubeItem(itemId) !== null ? 1.25 : 0.82) * display.scale[0] * tuning.scale,
    `${itemId} consumes reviewed third-person scale`,
  );
  assert.ok(presentation.center?.every(Number.isFinite));
  assert.equal(
    presentation.center?.[1],
    (itemVisual(itemId).parent === "bow" ? 0.875 : 0.53) + display.translation[1] / 16 + tuning.position[1],
    `${itemId} resolves the correct hand socket family`,
  );
  assert.deepEqual(
    presentation.pivotPixels,
    display.pivot ? [display.pivot[0], display.pivot[1]] : undefined,
    `${itemId} uses the correct model-space grip pivot`,
  );
}
const idlePose = resolvePlayerRigPose({ motion: "idle", phase: 0 });
const partMatrix = new Float32Array(16);
for (const model of ["wide", "slim"] as const) {
  const armMinX = model === "wide" ? -0.5 : -0.4375;
  const armMaxX = -0.25;
  const wristMinY = model === "wide" ? 0.75 : 0.71875;
  writePlayerRigPartMatrix(partMatrix, "rightArm", idlePose, model, true);
  for (const itemId of ["dirt", "diamond_pickaxe", "apple", "bow"] as const) {
    const center = thirdPersonHeldItemPresentation(itemId).center!;
    const socketX = center[0] + partMatrix[12];
    const socketY = partMatrix[5] * center[1] + partMatrix[9] * center[2] + partMatrix[13];
    const socketZ = partMatrix[6] * center[1] + partMatrix[10] * center[2] + partMatrix[14];
    assert.ok(socketX >= armMinX && socketX <= armMaxX,
      `${model} ${itemId} grip stays inside the anatomical right-hand width`);
    assert.ok(socketY >= wristMinY - 0.08 && socketY <= wristMinY + 0.2,
      `${model} ${itemId} grip stays at the lower hand rather than floating up the forearm`);
    assert.ok(Math.max(0, Math.abs(socketZ) - 0.125) <= 0.21,
      `${model} ${itemId} grip stays on or immediately in front of the hand surface`);
  }
}
assert.equal(PLAYER_SKIN_VERTEX_COUNT, 432, "local player remains one bounded 12-cuboid skin batch");
assert.doesNotMatch(source, /fetch\(|ImageData|setInterval|requestAnimationFrame/);
console.log("world player skin renderer contract tests passed");
