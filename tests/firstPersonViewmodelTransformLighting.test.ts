import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PERSON_MODEL_SCALE,
  FIRST_PERSON_MODEL_PIVOT,
  createFirstPersonRenderer,
  firstPersonBufferCapacity,
  writeFirstPersonModelMatrix,
} from "../client/game/firstPersonRenderer.ts";
import { BLOCK } from "../client/game/types.ts";
import { FIRST_PERSON_TUNING } from "../client/game/firstPersonTuning.ts";

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
assert.equal([...gl.allocations.values()].reduce((total, bytes) => total + bytes, 0), 16_416);

const colorBuffer = renderer[0] as unknown as object;
const texturedBuffer = renderer[1] as unknown as object;
const mvp = new Float32Array(16);
const viewportBounds: Array<{ viewport: string; width: number; height: number }> = [];
for (const [width, height] of [[1_920, 1_080], [800, 720], [390, 844]] as const) {
  renderer[3](null, BLOCK.AIR);
  renderer[6](mvp, perspective(width / height), 0, false);
  const emptyBounds = ndcBounds(gl.uploads.get(colorBuffer)!, mvp);
  assert.ok(emptyBounds.minX > 0.25 && emptyBounds.maxY < -0.25,
    `${width}x${height} empty hand stays wholly below/right of the crosshair`);
  assert.ok(emptyBounds.maxX < 1.05 && emptyBounds.minY > -1.35,
    `${width}x${height} empty hand remains mostly inside the viewport: ${JSON.stringify(emptyBounds)}`);

  renderer[3]("dirt", BLOCK.DIRT);
  renderer[6](mvp, perspective(width / height), 0, false);
  const armBounds = ndcBounds(gl.uploads.get(colorBuffer)!, mvp);
  const blockBounds = ndcBounds(gl.uploads.get(texturedBuffer)!, mvp);
  assert.ok(Math.min(armBounds.minX, blockBounds.minX) > 0.06,
    `${width}x${height} held block leaves the crosshair's vertical lane clear: ${JSON.stringify({ armBounds, blockBounds })}`);
  assert.ok(Math.max(armBounds.maxY, blockBounds.maxY) < -0.08,
    `${width}x${height} held block leaves the crosshair's horizontal lane clear`);
  assert.ok(blockBounds.maxX < 0.82 && blockBounds.minY > -0.95,
    `${width}x${height} held atlas cube stays clear of the right and bottom screen edges`);
  assert.ok(blockBounds.maxX - blockBounds.minX < 0.58
    && blockBounds.maxY - blockBounds.minY < 0.62,
  `${width}x${height} held atlas cube cannot cover most of the world: ${JSON.stringify(blockBounds)}`);
  viewportBounds.push({
    viewport: `${width}x${height}`,
    width: Number((blockBounds.maxX - blockBounds.minX).toFixed(6)),
    height: Number((blockBounds.maxY - blockBounds.minY).toFixed(6)),
  });
}
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
assert.ok(engine.includes("updateFirstPersonSkyExposure(eye)")
  && engine.includes("skyExposureLevel(skyOccluderColumns, blockX, blockY, blockZ)"),
  "the retained eye-cell signal comes from cached scene sky-occluder columns");
const exposureUpdate = engine.slice(
  engine.indexOf("function updateFirstPersonSkyExposure"),
  engine.indexOf("function getPerformanceStats"),
);
assert.equal(exposureUpdate.includes("getBlock("), false, "viewmodel exposure never scans terrain blocks");
assert.equal(exposureUpdate.includes("new "), false, "unchanged per-frame exposure sampling allocates no objects");
assert.ok(viewmodelPass.includes("terrainSkyExposureLocation, viewmodelSkyExposure")
  && viewmodelPass.includes("skyExposureLocation, viewmodelSkyExposure"),
  "textured blocks and solid arms/tools receive the same bounded viewmodel exposure");
assert.ok(viewmodelPass.includes("gl.uniform4fv(torchLightsLocation, firstPersonTorchUniforms)")
  && viewmodelPass.includes("gl.uniform1f(lightingLocation, 1)"),
  "solid arm and item geometry enables scene lighting with camera-local torches");
assert.equal(viewmodelPass.includes("terrainAmbientColorLocation, 1, 1, 1"), false,
  "held atlas blocks no longer use full-bright white ambient");
assert.equal(viewmodelPass.includes("gl.uniform1f(lightingLocation, 0)"), false,
  "solid viewmodel geometry no longer bypasses night lighting");

renderer[7]();
console.log("first-person viewmodel transform, lighting, and retained-budget tests passed");
