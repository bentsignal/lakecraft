import assert from "node:assert/strict";
import {
  MINECRAFT_BLOCK_FIRST_PERSON,
  MINECRAFT_HANDHELD_FIRST_PERSON,
} from "../client/game/generated/viewmodelDisplayTransforms.ts";
import {
  VIEWMODEL_SHOULDER_NDC,
  VIEWMODEL_WRIST_NDC,
  createViewmodelRigPose,
  minecraftDisplayTranslation,
  projectViewmodelPoint,
  writeViewmodelProjection,
} from "../client/game/viewmodelRig.ts";
import { buildSocketedFirstPersonSkinArmGeometry } from "../client/game/firstPersonSkinRenderer.ts";
import {
  PLAYER_SKIN_VERTEX_STRIDE,
  buildPlayerSkinPartGeometry,
} from "../client/game/playerSkinGeometry.ts";
import { writeSocketedViewmodelActionMatrix } from "../client/game/firstPersonRenderer.ts";

const fovs = [30, 70, 90, 110];
const aspects = [4 / 3, 16 / 9, 21 / 9, 390 / 844];
const neutralArmTuning = {
  position: [0, 0, 0] as const,
  rotationDegrees: [0, 0, 0] as const,
  scale: 1,
  pivot: [0, 0, 0] as const,
};
function assertPointNear(
  actual: readonly [number, number],
  expected: readonly [number, number],
  message: string,
): void {
  assert.ok(Math.abs(actual[0] - expected[0]) < 1e-12
    && Math.abs(actual[1] - expected[1]) < 1e-12, message);
}
for (const fovDegrees of fovs) {
  for (const aspect of aspects) {
    const fov = fovDegrees * Math.PI / 180;
    const pose = createViewmodelRigPose(fov, aspect);
    assertPointNear(projectViewmodelPoint(pose.shoulder, fov, aspect), VIEWMODEL_SHOULDER_NDC,
      `shoulder remains outside the lower-right frame at FOV ${fovDegrees}, aspect ${aspect}`);
    assertPointNear(projectViewmodelPoint(pose.wrist, fov, aspect), VIEWMODEL_WRIST_NDC,
      `wrist remains at the authored hand socket at FOV ${fovDegrees}, aspect ${aspect}`);
    assert.strictEqual(pose.socket, pose.wrist, "item socket is the wrist object, not a nearby copy");
    assert.ok(pose.wrist[2] < pose.shoulder[2],
      "the wrist reaches away from the camera instead of pointing back at the player");
    assert.ok(pose.armLength > 0.1 && Number.isFinite(pose.armLength));
    const projection = writeViewmodelProjection(new Float32Array(16), fov, aspect);
    assert.ok(Number.isFinite(projection[0]) && projection[0] > 0);
    assert.ok(Number.isFinite(projection[5]) && projection[5] > 0);

    const sourceArm = buildPlayerSkinPartGeometry("rightArm", "wide");
    const socketedArm = buildSocketedFirstPersonSkinArmGeometry("wide", projection, neutralArmTuning);
    const wristSamples = new Map<string, number[]>();
    for (let offset = 0; offset < 36 * PLAYER_SKIN_VERTEX_STRIDE; offset += PLAYER_SKIN_VERTEX_STRIDE) {
      if (Math.abs(sourceArm[offset + 1] - 0.75) < 1e-8) {
        wristSamples.set(`${sourceArm[offset]}:${sourceArm[offset + 2]}`, [
          socketedArm[offset], socketedArm[offset + 1], socketedArm[offset + 2],
        ]);
      }
    }
    assert.equal(wristSamples.size, 4);
    const wristCenter = [...wristSamples.values()].reduce(
      (sum, point) => sum.map((value, index) => value + point[index]),
      [0, 0, 0],
    ).map((value) => value / wristSamples.size) as [number, number, number];
    assert.ok(Math.hypot(
      wristCenter[0] - pose.socket[0],
      wristCenter[1] - pose.socket[1],
      wristCenter[2] - pose.socket[2],
    ) < 1e-6, `skin wrist center is the item socket at FOV ${fovDegrees}, aspect ${aspect}`);

    const action = writeSocketedViewmodelActionMatrix(
      new Float32Array(16), [0, 0, 0, -0.4, 0.2, 0.1], pose,
    );
    const transformedShoulder = [
      action[0] * pose.shoulder[0] + action[4] * pose.shoulder[1] + action[8] * pose.shoulder[2] + action[12],
      action[1] * pose.shoulder[0] + action[5] * pose.shoulder[1] + action[9] * pose.shoulder[2] + action[13],
      action[2] * pose.shoulder[0] + action[6] * pose.shoulder[1] + action[10] * pose.shoulder[2] + action[14],
    ];
    assert.ok(Math.hypot(
      transformedShoulder[0] - pose.shoulder[0],
      transformedShoulder[1] - pose.shoulder[1],
      transformedShoulder[2] - pose.shoulder[2],
    ) < 1e-6, "swing rotates around the shoulder instead of floating the whole rig");
  }
}

assert.deepEqual(MINECRAFT_HANDHELD_FIRST_PERSON.rotationDegrees, [0, -90, 25]);
assert.deepEqual(MINECRAFT_BLOCK_FIRST_PERSON.rotationDegrees, [0, 315, 0]);
assert.deepEqual(minecraftDisplayTranslation(MINECRAFT_HANDHELD_FIRST_PERSON), [1.13 / 16, 3.2 / 16, 1.13 / 16]);
assert.deepEqual(minecraftDisplayTranslation(MINECRAFT_BLOCK_FIRST_PERSON), [0, 0, 0]);

console.log("socketed viewmodel rig remains attached across FOV and aspect ratios");
