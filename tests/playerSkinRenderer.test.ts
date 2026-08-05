import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAYER_SKIN_VERTEX_COUNT } from "../client/game/playerSkinGeometry.ts";
import { thirdPersonHeldItemPresentation } from "../client/game/playerSkinRenderer.ts";
import { itemVisual } from "../shared/visualCatalog.ts";

const source = readFileSync(new URL("../client/game/playerSkinRenderer.ts", import.meta.url), "utf8");
for (const contract of [
  "buildPlayerSkinGeometry", "gl.NEAREST", "gl.CLAMP_TO_EDGE", "uSkin", "uLight",
  "pose.yaw + Math.PI", "gl.enable(gl.BLEND)", "PLAYER_RIG_SKIN_DRAWS", "setPartMvp",
  "appendItemSpriteGeometry", "setHeldItem(itemId)", "heldItemVertexCount",
  "buildPlayerArmorGeometry", "setArmor(appearance)", "armorVertexCount",
  "itemVisual(itemId)", "display.thirdPersonRight", "thirdPersonHeldItemPresentation(itemId)",
  "appendBlockItemCubeGeometry", "blockIdForCubeItem(itemId)",
  "resolvePlayerRigPose(rig)", "playerArmorRigDraws", "setPartMvp(\"rightArm\", true", "drawCallCount",
]) assert.ok(source.includes(contract), `world skin renderer retains ${contract}`);
for (const itemId of ["dirt", "diamond_pickaxe", "apple", "bow"] as const) {
  const presentation = thirdPersonHeldItemPresentation(itemId);
  const display = itemVisual(itemId).display.thirdPersonRight;
  assert.deepEqual(presentation.rotationDegrees, display.rotationDegrees, `${itemId} consumes the canonical third-person rotation`);
  assert.equal(
    presentation.size,
    (itemVisual(itemId).family === "block" ? 1.25 : 0.54) * display.scale[0],
    `${itemId} consumes canonical third-person scale`,
  );
  assert.ok(presentation.center?.every(Number.isFinite));
  assert.equal(
    presentation.center?.[1],
    (itemVisual(itemId).parent === "bow" ? 0.875 : 0.53) + display.translation[1] / 16,
    `${itemId} resolves the correct hand socket family`,
  );
  assert.deepEqual(
    presentation.pivotPixels,
    display.pivot ? [display.pivot[0], display.pivot[1]] : undefined,
    `${itemId} uses the correct model-space grip pivot`,
  );
}
assert.equal(PLAYER_SKIN_VERTEX_COUNT, 432, "local player remains one bounded 12-cuboid skin batch");
assert.doesNotMatch(source, /fetch\(|ImageData|setInterval|requestAnimationFrame/);
console.log("world player skin renderer contract tests passed");
