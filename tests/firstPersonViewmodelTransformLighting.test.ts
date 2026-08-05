import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PERSON_MODEL_SCALE,
  FIRST_PERSON_MODEL_PIVOT,
  createFirstPersonRenderer,
  firstPersonBufferCapacity,
  sampleFirstPersonAction,
  writeFirstPersonModelMatrix,
} from "../client/game/firstPersonRenderer.ts";
import { writeMatrixProduct } from "../client/game/matrixProduct.ts";
import { BLOCK } from "../client/game/types.ts";
import { FIRST_PERSON_TUNING } from "../client/game/firstPersonTuning.ts";
import {
  FIRST_PERSON_SKIN_ARM_BUFFER_BYTES,
  FIRST_PERSON_SKIN_SLEEVE_INFLATE,
  buildFirstPersonSkinArmGeometry,
  writeResponsiveFirstPersonSkinMvp,
} from "../client/game/firstPersonSkinRenderer.ts";
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

const colorBuffer = renderer[0] as unknown as object;
const texturedBuffer = renderer[1] as unknown as object;
const skinArm = buildFirstPersonSkinArmGeometry("wide", FIRST_PERSON_TUNING.arm);
const sourceSkinArm = buildPlayerSkinPartGeometry("rightArm", "wide", FIRST_PERSON_SKIN_SLEEVE_INFLATE);
const mvp = new Float32Array(16);
const skinMvp = new Float32Array(16);
const attackMvp = new Float32Array(16);
const attackSkinMvp = new Float32Array(16);
const attackPose = sampleFirstPersonAction([0, 0, 0, 0, 0, 0], "attack", 110, false, false);
const attackModel = writeFirstPersonModelMatrix(new Float32Array(16), attackPose);
const viewportBounds: Array<{ viewport: string; width: number; height: number }> = [];
for (const [width, height] of [[1_920, 1_080], [800, 720], [390, 844]] as const) {
  renderer[3](null, BLOCK.AIR);
  renderer[6](mvp, perspective(width / height), 0, false);
  writeResponsiveFirstPersonSkinMvp(skinMvp, mvp);
  const emptyBounds = ndcBounds(skinArm, skinMvp);
  const armScreen = screenPercent(emptyBounds);
  assert.ok(emptyBounds.minX > 0.25 && emptyBounds.maxY < -0.25,
    `${width}x${height} empty hand stays wholly below/right of the crosshair`);
  assert.ok(armScreen.left >= 74.5 && armScreen.left <= 75.75,
    `${width}x${height} arm begins at the reviewed lower-right anchor: ${JSON.stringify(armScreen)}`);
  assert.ok(armScreen.right >= 93.25 && armScreen.right <= 94.75,
    `${width}x${height} arm remains visible inside the right edge: ${JSON.stringify(armScreen)}`);
  assert.ok(armScreen.top >= 65.5 && armScreen.top <= 67,
    `${width}x${height} visible hand begins near two-thirds viewport height: ${JSON.stringify(armScreen)}`);
  assert.ok(armScreen.bottom >= 99 && armScreen.bottom <= 100.75,
    `${width}x${height} shoulder exits cleanly through the bottom edge: ${JSON.stringify(armScreen)}`);
  const shoulder = jointCentroid(skinArm, sourceSkinArm, skinMvp, 1.5);
  const hand = jointCentroid(skinArm, sourceSkinArm, skinMvp, 0.75);
  assert.ok(shoulder[0] > hand[0] + 7 && shoulder[1] > hand[1] + 15,
    `${width}x${height} idle arm enters at the lower-right shoulder and reaches the upper-left hand: ${JSON.stringify({ shoulder, hand })}`);

  writeMatrixProduct(attackMvp, perspective(width / height), attackModel);
  writeResponsiveFirstPersonSkinMvp(attackSkinMvp, attackMvp);
  const attackScreen = screenPercent(ndcBounds(skinArm, attackSkinMvp));
  assert.ok(attackScreen.left >= 67.5 && attackScreen.left <= 69.25
    && attackScreen.right >= 87 && attackScreen.right <= 89,
  `${width}x${height} mid-attack arm remains horizontally visible: ${JSON.stringify(attackScreen)}`);
  assert.ok(attackScreen.top >= 65 && attackScreen.top <= 67
    && attackScreen.bottom >= 93 && attackScreen.bottom <= 95,
  `${width}x${height} mid-attack arm remains vertically visible: ${JSON.stringify(attackScreen)}`);
  const attackShoulder = jointCentroid(skinArm, sourceSkinArm, attackSkinMvp, 1.5);
  const attackHand = jointCentroid(skinArm, sourceSkinArm, attackSkinMvp, 0.75);
  assert.ok(attackShoulder[0] > attackHand[0] + 7 && attackShoulder[1] > attackHand[1] + 15,
    `${width}x${height} mid-attack preserves lower-right shoulder to upper-left hand order: ${JSON.stringify({ attackShoulder, attackHand })}`);

  renderer[3]("dirt", BLOCK.DIRT);
  renderer[6](mvp, perspective(width / height), 0, false);
  writeResponsiveFirstPersonSkinMvp(skinMvp, mvp);
  const armBounds = ndcBounds(skinArm, skinMvp);
  const blockBounds = ndcBounds(gl.uploads.get(texturedBuffer)!, mvp);
  assert.ok(Math.min(armBounds.minX, blockBounds.minX) > 0.3,
    `${width}x${height} held block leaves the crosshair's vertical lane clear: ${JSON.stringify({ armBounds, blockBounds })}`);
  assert.ok(Math.max(armBounds.maxY, blockBounds.maxY) < -0.2,
    `${width}x${height} held block leaves the crosshair's horizontal lane clear`);
  assert.ok(blockBounds.maxX > 0.84 && blockBounds.maxX < 0.92
    && blockBounds.minY < -0.88 && blockBounds.minY > -0.96,
  `${width}x${height} held atlas cube occupies the reviewed lower-right socket`);
  assert.ok(blockBounds.maxX - blockBounds.minX < 0.55
    && blockBounds.maxY - blockBounds.minY < 0.64,
  `${width}x${height} held atlas cube cannot cover most of the world: ${JSON.stringify(blockBounds)}`);
  viewportBounds.push({
    viewport: `${width}x${height}`,
    width: Number((blockBounds.maxX - blockBounds.minX).toFixed(6)),
    height: Number((blockBounds.maxY - blockBounds.minY).toFixed(6)),
  });
}
assert.equal(new Set(viewportBounds.map(({ width, height }) => `${width}:${height}`)).size, 1,
  "the HUD-like viewmodel projection preserves reviewed screen occupancy at every viewport aspect");
console.log(JSON.stringify({ benchmark: "held atlas cube NDC bounds", samples: viewportBounds }));

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
  && engine.includes("firstPersonSkinRenderer.draw(firstPersonMvpMatrix, firstPersonSkinLight)"),
  "solid item geometry and the textured standard-skin arm both use scene-derived light");
assert.equal(viewmodelPass.includes("terrainAmbientColorLocation, 1, 1, 1"), false,
  "held atlas blocks no longer use full-bright white ambient");
assert.equal(viewmodelPass.includes("gl.uniform1f(lightingLocation, 0)"), false,
  "solid viewmodel geometry no longer bypasses night lighting");

renderer[7]();
console.log("first-person viewmodel transform, lighting, and retained-budget tests passed");
