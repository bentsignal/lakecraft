import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PERSON_MODEL_SCALE,
  FIRST_PERSON_MODEL_PIVOT,
  createFirstPersonRenderer,
  firstPersonBufferCapacity,
  sampleFirstPersonAction,
  writeFirstPersonModelMatrix,
  writeSocketedViewmodelActionMatrix,
} from "../client/game/firstPersonRenderer.ts";
import { writeMatrixProduct } from "../client/game/matrixProduct.ts";
import { BLOCK } from "../client/game/types.ts";
import { FIRST_PERSON_TUNING } from "../client/game/firstPersonTuning.ts";
import {
  FIRST_PERSON_SKIN_ARM_BUFFER_BYTES,
  FIRST_PERSON_SKIN_SLEEVE_INFLATE,
  buildFirstPersonSkinArmGeometry,
  buildSocketedFirstPersonSkinArmGeometry,
  writeResponsiveFirstPersonSkinMvp,
} from "../client/game/firstPersonSkinRenderer.ts";
import {
  createViewmodelRigPoseFromProjection,
  projectViewmodelPoint,
  viewmodelProjectionParameters,
} from "../client/game/viewmodelRig.ts";
import {
  PLAYER_SKIN_BOX_FLOATS,
  PLAYER_SKIN_VERTEX_STRIDE,
  buildPlayerSkinPartGeometry,
} from "../client/game/playerSkinGeometry.ts";

class CapturingWebGl {
  readonly ARRAY_BUFFER = 0x8892;
  readonly DYNAMIC_DRAW = 0x88e8;
  readonly buffers: object[] = [];
  readonly allocations = new Map<object, number>();
  readonly uploads = new Map<object, Float32Array>();
  bound: object | null = null;

  createBuffer() {
    const buffer = { id: this.buffers.length };
    this.buffers.push(buffer);
    return buffer;
  }

  bindBuffer(_target: number, buffer: object) {
    this.bound = buffer;
  }

  bufferData(_target: number, bytes: number, usage: number) {
    assert.equal(usage, this.DYNAMIC_DRAW, "both retained buffers use the fixed dynamic-draw allocation");
    assert.ok(this.bound);
    this.allocations.set(this.bound, bytes);
  }

  bufferSubData(_target: number, _offset: number, data: Float32Array) {
    assert.ok(this.bound);
    this.uploads.set(this.bound, new Float32Array(data));
  }

  deleteBuffer() {}
}

function perspective(aspect: number): Float32Array {
  const output = new Float32Array(16);
  const near = 0.05;
  const far = 90;
  const f = 1 / Math.tan((70 * Math.PI / 180) / 2);
  output[0] = f / aspect;
  output[5] = f;
  output[10] = (far + near) / (near - far);
  output[11] = -1;
  output[14] = (2 * far * near) / (near - far);
  return output;
}

function ndcBounds(data: Float32Array, matrix: Float32Array) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let offset = 0; offset < data.length; offset += 6) {
    const x = data[offset];
    const y = data[offset + 1];
    const z = data[offset + 2];
    const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    assert.ok(clipW > 0, "every retained viewmodel vertex remains in front of the camera");
    bounds.minX = Math.min(bounds.minX, clipX / clipW);
    bounds.maxX = Math.max(bounds.maxX, clipX / clipW);
    bounds.minY = Math.min(bounds.minY, clipY / clipW);
    bounds.maxY = Math.max(bounds.maxY, clipY / clipW);
  }
  return bounds;
}

function screenPercent(bounds: ReturnType<typeof ndcBounds>) {
  return {
    left: (bounds.minX + 1) * 50,
    right: (bounds.maxX + 1) * 50,
    top: (1 - bounds.maxY) * 50,
    bottom: (1 - bounds.minY) * 50,
  };
}

function screenPoint(data: Float32Array, offset: number, matrix: Float32Array): readonly [number, number] {
  const x = data[offset]; const y = data[offset + 1]; const z = data[offset + 2];
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return [(clipX / clipW + 1) * 50, (1 - clipY / clipW) * 50];
}

function jointCentroid(
  transformed: Float32Array,
  source: Float32Array,
  matrix: Float32Array,
  sourceY: number,
): readonly [number, number] {
  let x = 0; let y = 0; let count = 0;
  for (let offset = 0; offset < PLAYER_SKIN_BOX_FLOATS; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    if (Math.abs(source[offset + 1] - sourceY) > 1e-7) continue;
    const point = screenPoint(transformed, offset, matrix);
    x += point[0]; y += point[1]; count += 1;
  }
  assert.ok(count > 0, `joint y=${sourceY} has representative vertices`);
  return [x / count, y / count];
}

function jointScreenPoints(
  transformed: Float32Array,
  source: Float32Array,
  matrix: Float32Array,
  sourceY: number,
): ReadonlyArray<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [];
  for (let offset = 0; offset < PLAYER_SKIN_BOX_FLOATS; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    if (Math.abs(source[offset + 1] - sourceY) <= 1e-7) points.push(screenPoint(transformed, offset, matrix));
  }
  assert.ok(points.length > 0, `joint y=${sourceY} has screen-space vertices`);
  return points;
}

const model = writeFirstPersonModelMatrix(new Float32Array(16), [0, 0, 0, 0, 0, 0]);
assert.deepEqual(Object.keys(FIRST_PERSON_TUNING), ["rig", "arm", "tool", "bow", "otherItem", "block"],
  "every first-person pose class has one obvious tuning entry point");
assert.ok(Math.abs(model[0] - FIRST_PERSON_MODEL_SCALE) < 0.000001);
assert.ok(Math.abs(model[5] - FIRST_PERSON_MODEL_SCALE) < 0.000001);
assert.ok(Math.abs(model[10] - FIRST_PERSON_MODEL_SCALE) < 0.000001);
const pivot = FIRST_PERSON_MODEL_PIVOT;
assert.deepEqual(
  [
    model[0] * pivot[0] + model[4] * pivot[1] + model[8] * pivot[2] + model[12],
    model[1] * pivot[0] + model[5] * pivot[1] + model[9] * pivot[2] + model[13],
    model[2] * pivot[0] + model[6] * pivot[1] + model[10] * pivot[2] + model[14],
  ].map((value) => Number(value.toFixed(6))),
  [...pivot],
  "the compact base scale preserves the lower-right action pivot",
);
const armProjection = perspective(16 / 9);
const defaultSocketedArm = buildSocketedFirstPersonSkinArmGeometry("wide", armProjection, FIRST_PERSON_TUNING.arm);
const movedSocketedArm = buildSocketedFirstPersonSkinArmGeometry("wide", armProjection, {
  ...FIRST_PERSON_TUNING.arm,
  position: [FIRST_PERSON_TUNING.arm.position[0] + 0.25, ...FIRST_PERSON_TUNING.arm.position.slice(1)] as [number, number, number],
});
assert.equal(Number((movedSocketedArm[0] - defaultSocketedArm[0]).toFixed(6)), 0.25,
  "empty-hand Pose Lab tuning changes the live socketed arm geometry directly");

const gl = new CapturingWebGl();
const renderer = createFirstPersonRenderer(gl as unknown as WebGLRenderingContext);
const capacity = firstPersonBufferCapacity();
assert.deepEqual([...gl.allocations.values()], [
  capacity[0] * 6 * Float32Array.BYTES_PER_ELEMENT,
  capacity[1] * 6 * Float32Array.BYTES_PER_ELEMENT,
]);
assert.equal([...gl.allocations.values()].reduce((total, bytes) => total + bytes, 0), capacity[2]);
assert.ok(capacity[2] + FIRST_PERSON_SKIN_ARM_BUFFER_BYTES < 120 * 1_024,
  "the complete canonical-sprite and standard-skin viewmodel stays below 120 KiB");

const texturedBuffer = renderer[1] as unknown as object;
const mvp = new Float32Array(16);
const viewportBounds: Array<{ viewport: string; pixelWidth: number; pixelHeight: number }> = [];
const blockGripSamples: Array<{ viewport: string; block: ReturnType<typeof screenPercent>; hand: readonly [number, number] }> = [];
for (const [width, height] of [[1_920, 1_080], [800, 720], [390, 844]] as const) {
  const projection = perspective(width / height);
  const pose = createViewmodelRigPoseFromProjection(projection);
  const parameters = viewmodelProjectionParameters(projection);
  const skinArm = buildSocketedFirstPersonSkinArmGeometry("wide", projection, FIRST_PERSON_TUNING.arm);
  renderer[3](null, BLOCK.AIR);
  renderer[6](mvp, projection, 0, false);
  const emptyBounds = ndcBounds(skinArm, mvp);
  const armScreen = screenPercent(emptyBounds);
  assert.ok(emptyBounds.maxX > 0.2 && emptyBounds.maxY < 0 && emptyBounds.minY < -0.7,
    `${width}x${height} empty hand stays anchored to the lower-right viewport: ${JSON.stringify(emptyBounds)}`);
  assert.ok(armScreen.right > 60 && armScreen.top > 50 && armScreen.bottom > 85,
    `${width}x${height} arm enters from the lower-right edge: ${JSON.stringify(armScreen)}`);
  const handNdc = projectViewmodelPoint(pose.socket, parameters.verticalFovRadians, parameters.aspect);
  const shoulderNdc = projectViewmodelPoint(pose.shoulder, parameters.verticalFovRadians, parameters.aspect);
  assert.ok(Math.abs(handNdc[0] - 0.66) < 1e-12 && Math.abs(handNdc[1] + 0.64) < 1e-12,
    `${width}x${height} wrist stays at the shared item socket`);
  assert.ok(shoulderNdc[0] > 1 && shoulderNdc[1] < -1,
    `${width}x${height} shoulder root stays outside the lower-right frame`);
  const attackPose = sampleFirstPersonAction([0, 0, 0, 0, 0, 0], "attack", 110, false, false);
  const attackModel = writeSocketedViewmodelActionMatrix(new Float32Array(16), attackPose, pose);
  const attackMvp = writeMatrixProduct(new Float32Array(16), projection, attackModel);
  const attackBounds = ndcBounds(skinArm, attackMvp);
  assert.ok(attackBounds.maxX > 0.2 && attackBounds.maxY < 0.2,
    `${width}x${height} socketed swing remains in the hand quadrant: ${JSON.stringify(attackBounds)}`);

  renderer[3]("dirt", BLOCK.DIRT);
  renderer[6](mvp, projection, 0, false);
  const armBounds = ndcBounds(skinArm, mvp);
  const blockBounds = ndcBounds(gl.uploads.get(texturedBuffer)!, mvp);
  const blockScreen = screenPercent(blockBounds);
  assert.ok(blockBounds.minX > 0.05,
    `${width}x${height} held block leaves the crosshair's vertical lane clear: ${JSON.stringify({ armBounds, blockBounds })}`);
  assert.ok(blockBounds.maxY < 0,
    `${width}x${height} held block leaves the crosshair's horizontal lane clear: ${JSON.stringify({ armBounds, blockBounds })}`);
  assert.ok(blockBounds.maxX - blockBounds.minX < 1.55
    && blockBounds.maxY - blockBounds.minY < 1.8,
  `${width}x${height} held atlas cube stays confined to the lower-right presentation: ${JSON.stringify(blockBounds)}`);
  const blockAnchor = [85, 88] as const;
  assert.ok(blockAnchor[0] >= blockScreen.left && blockAnchor[0] <= blockScreen.right
    && blockAnchor[1] >= blockScreen.top && blockAnchor[1] <= blockScreen.bottom,
    `${width}x${height} cube surrounds its independent screen anchor: ${JSON.stringify({ blockScreen, blockAnchor })}`);
  blockGripSamples.push({ viewport: `${width}x${height}`, block: blockScreen, hand: blockAnchor });
  viewportBounds.push({
    viewport: `${width}x${height}`,
    pixelWidth: Number(((blockBounds.maxX - blockBounds.minX) * width / 2).toFixed(3)),
    pixelHeight: Number(((blockBounds.maxY - blockBounds.minY) * height / 2).toFixed(3)),
  });
}
for (const sample of viewportBounds) {
  assert.ok(sample.pixelWidth > 55 && sample.pixelHeight > 55
    && sample.pixelWidth / sample.pixelHeight > 0.55
    && sample.pixelWidth / sample.pixelHeight < 1.45,
  `the held cube uses real perspective without horizontal stretching: ${JSON.stringify(sample)}`);
}
console.log(JSON.stringify({ benchmark: "held atlas cube NDC bounds", samples: viewportBounds, blockGripSamples }));

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const viewmodelPassStart = engine.indexOf("if (!firstPersonFeedbackHidden && playerHealth > 0)");
const viewmodelPass = engine.slice(
  viewmodelPassStart,
  engine.indexOf("\n    }\n\n  }\n\n  function frame", viewmodelPassStart),
);
const activeLightingPass = engine.slice(
  engine.indexOf("gl.useProgram(terrainProgram);", engine.indexOf("function render(")),
  viewmodelPassStart,
);
assert.ok(engine.includes("firstPersonTorchUniforms[3] = activeTorchUniforms[3] / 2"),
  "the selected world torch activates a bounded camera-local viewmodel light without an allocation");
assert.ok(activeLightingPass.includes("dayNightState.ambientR")
  && activeLightingPass.includes("dayNightState.directionalR")
  && activeLightingPass.includes("terrainAmbientIntensityLocation")
  && activeLightingPass.includes("ambientIntensityLocation"),
  "both programs retain the active world daylight uniforms into the viewmodel pass");
assert.ok(activeLightingPass.includes("terrainSkyExposureLocation, 1")
  && activeLightingPass.includes("skyExposureLocation, 1"),
  "ordinary world geometry keeps its authored per-vertex exposure normalized");
assert.ok(engine.includes("function updateFirstPersonSkyExposure(eye: Vec3)")
  && engine.includes("skyExposureLevel(skyOccluderColumns, blockX, blockY, blockZ)"),
  "the retained eye-cell signal comes from cached scene sky-occluder columns");
const exposureUpdate = engine.slice(
  engine.indexOf("function updateFirstPersonSkyExposure"),
  engine.indexOf("function getPerformanceStats"),
);
assert.equal(exposureUpdate.includes("getBlock("), false, "viewmodel exposure never scans terrain blocks");
assert.equal(exposureUpdate.includes("new "), false, "unchanged per-frame exposure sampling allocates no objects");
assert.ok(engine.includes("terrainSkyExposureLocation, viewmodelSkyExposure")
  && engine.includes("skyExposureLocation, viewmodelSkyExposure"),
  "textured blocks and solid held sprites receive the same bounded viewmodel exposure");
assert.ok(engine.includes("gl.uniform4fv(torchLightsLocation, firstPersonTorchUniforms)")
  && engine.includes("gl.uniform1f(lightingLocation, 1)")
  && engine.includes("firstPersonSkinRenderer.draw(")
  && engine.includes("firstPersonMvpMatrix,")
  && engine.includes("firstPersonSkinLight,"),
  "solid item geometry and the textured standard-skin arm both use scene-derived light");
assert.equal(viewmodelPass.includes("terrainAmbientColorLocation, 1, 1, 1"), false,
  "held atlas blocks no longer use full-bright white ambient");
assert.equal(viewmodelPass.includes("gl.uniform1f(lightingLocation, 0)"), false,
  "solid viewmodel geometry no longer bypasses night lighting");

renderer[7]();
console.log("first-person viewmodel transform, lighting, and retained-budget tests passed");
