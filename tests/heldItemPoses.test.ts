import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PERSON_BOW_ARROW_TIP,
  FIRST_PERSON_CUBE_ROTATION,
  createFirstPersonRenderer,
  writeFirstPersonModelMatrix,
} from "../client/game/firstPersonRenderer.ts";
import { BLOCK } from "../client/game/types.ts";

type CapturedBuffer = { id: number };

function captureGl(): { gl: WebGLRenderingContext; uploads: Map<number, Float32Array> } {
  let nextId = 0;
  let bound: CapturedBuffer | null = null;
  const uploads = new Map<number, Float32Array>();
  return {
    uploads,
    gl: {
      ARRAY_BUFFER: 0x8892,
      DYNAMIC_DRAW: 0x88e8,
      createBuffer: () => ({ id: ++nextId }),
      bindBuffer: (_target, buffer) => { bound = buffer as unknown as CapturedBuffer | null; },
      bufferData: () => undefined,
      bufferSubData: (_target, _offset, data) => {
        if (!bound) throw new Error("capture buffer was not bound");
        uploads.set(bound.id, new Float32Array(data as ArrayLike<number>));
      },
      deleteBuffer: () => undefined,
    } as unknown as WebGLRenderingContext,
  };
}

function center(data: Float32Array, firstVertex: number, vertexCount: number): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (let vertex = firstVertex; vertex < firstVertex + vertexCount; vertex += 1) {
    const offset = vertex * 6;
    result[0] += data[offset];
    result[1] += data[offset + 1];
    result[2] += data[offset + 2];
  }
  return result.map((value) => value / vertexCount) as [number, number, number];
}

function projectedFaceArea(data: Float32Array, face: number): number {
  const point = (vertex: number): readonly [number, number] => {
    const offset = (face * 6 + vertex) * 6;
    return [data[offset], data[offset + 1]];
  };
  const triangle = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]) => (
    Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * 0.5
  );
  return triangle(point(0), point(1), point(2)) + triangle(point(3), point(4), point(5));
}

function zSpan(data: Float32Array, box: number): number {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let vertex = box * 36; vertex < (box + 1) * 36; vertex += 1) {
    minimum = Math.min(minimum, data[vertex * 6 + 2]);
    maximum = Math.max(maximum, data[vertex * 6 + 2]);
  }
  return maximum - minimum;
}

function clipBounds(data: Float32Array, mvp: Float32Array): readonly [number, number, number, number] {
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (let offset = 0; offset < data.length; offset += 6) {
    const x = data[offset];
    const y = data[offset + 1];
    const z = data[offset + 2];
    const clipX = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
    const clipY = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
    const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    minimumX = Math.min(minimumX, clipX / clipW);
    maximumX = Math.max(maximumX, clipX / clipW);
    minimumY = Math.min(minimumY, clipY / clipW);
    maximumY = Math.max(maximumY, clipY / clipW);
  }
  return [minimumX, maximumX, minimumY, maximumY];
}

const capture = captureGl();
const renderer = createFirstPersonRenderer(capture.gl);

renderer[3]("dirt", BLOCK.DIRT);
const cube = capture.uploads.get(2);
if (!cube) throw new Error("textured cube upload missing");
for (const [index, expected] of [0.5, -0.66, 0.04].entries()) {
  assert.ok(Math.abs(FIRST_PERSON_CUBE_ROTATION[index] - expected) < 0.00001,
    "human-readable tuning degrees preserve the reviewed authored radian pose");
}
const cubeCenters = Array.from({ length: 6 }, (_, face) => center(cube, face * 6, 6));
assert.ok(cubeCenters[2][2] > cubeCenters[3][2] + 0.2, "the top face points visibly toward the camera");
assert.ok(cubeCenters[0][2] > cubeCenters[1][2] + 0.35, "the right vertical face remains readable");
assert.ok(cubeCenters[4][2] > cubeCenters[5][2] + 0.4, "the left vertical face remains readable");
const readableAreas = [0, 2, 4].map((face) => projectedFaceArea(cube, face));
assert.ok(Math.min(...readableAreas) / Math.max(...readableAreas) > 0.5,
  "top, left, and right cube faces retain a balanced isometric silhouette");

renderer[3]("iron_pickaxe", BLOCK.AIR);
const pickaxe = capture.uploads.get(1);
if (!pickaxe) throw new Error("pickaxe upload missing");
const pickHandle = center(pickaxe, 0, 36);
const pickHead = center(pickaxe, 36, 36);
const pickTip = center(pickaxe, 72, 36);
assert.ok(pickHead[0] < pickHandle[0] - 0.25 && pickHead[1] > pickHandle[1] + 0.4,
  "the pickaxe head meets a lower-right to upper-left handle");
assert.ok(pickTip[0] < pickHead[0] - 0.3, "the pick point extends from the far side of the head");
assert.ok(zSpan(pickaxe, 0) > 0.3 && zSpan(pickaxe, 1) > 0.3,
  "pickaxe handle and head pitch through real depth rather than lying flat");

renderer[3]("iron_axe", BLOCK.AIR);
const axe = capture.uploads.get(1);
if (!axe) throw new Error("axe upload missing");
const axeHandle = center(axe, 0, 36);
const axePoll = center(axe, 36, 36);
const axeBlade = center(axe, 72, 36);
assert.ok(axePoll[0] < axeHandle[0] - 0.2 && axePoll[1] > axeHandle[1] + 0.4,
  "the axe poll is seated above and left of its grip");
assert.ok(axeBlade[0] < axePoll[0] - 0.15 && axeBlade[1] < axePoll[1],
  "the broader axe blade fans outward and down instead of reading as a square mallet");
assert.ok(zSpan(axe, 1) > 0.25 && zSpan(axe, 2) > 0.3,
  "the axe poll and blade have a readable three-dimensional cant");

renderer[3]("bow", BLOCK.AIR);
renderer[4](true, 1);
const bow = capture.uploads.get(1);
if (!bow) throw new Error("bow upload missing");
assert.equal(renderer[2][0], 360, "the charged bow is ten boxes with no ordinary arm boxes");
const shaft = center(bow, 6 * 36, 36);
const tip = center(bow, 7 * 36, 36);
assert.ok(shaft[2] < -1.35 && tip[2] < shaft[2] - 0.25,
  "the arrow advances into view depth toward its crosshair tip");
assert.ok(Math.abs(tip[0] - FIRST_PERSON_BOW_ARROW_TIP[0]) < 0.001
  && Math.abs(tip[1] - FIRST_PERSON_BOW_ARROW_TIP[1]) < 0.001,
"arrowhead geometry is centered on the authored aiming point");
const idleMatrix = writeFirstPersonModelMatrix(new Float32Array(16), [0, 0, 0, 0, 0, 0]);
const cameraTipX = idleMatrix[0] * tip[0] + idleMatrix[4] * tip[1] + idleMatrix[8] * tip[2] + idleMatrix[12];
const cameraTipY = idleMatrix[1] * tip[0] + idleMatrix[5] * tip[1] + idleMatrix[9] * tip[2] + idleMatrix[13];
assert.ok(Math.abs(cameraTipX) < 0.003 && Math.abs(cameraTipY) < 0.001,
  "the visual arrowhead resolves to the camera crosshair without changing projectile authority");

const portraitProjection = new Float32Array(16);
portraitProjection[0] = 2;
portraitProjection[5] = 1;
portraitProjection[10] = -1;
portraitProjection[11] = -1;
portraitProjection[14] = -0.2;
const portraitMvp = renderer[6](new Float32Array(16), portraitProjection, 0, false);
const bowBounds = clipBounds(bow, portraitMvp);
assert.ok(bowBounds[0] >= -1 && bowBounds[1] <= 1 && bowBounds[2] >= -1 && bowBounds[3] <= 1,
  "the complete drawn bow stays visible at a portrait two-to-one projection");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const viewmodelDraw = engine.slice(
  engine.indexOf("if (!firstPersonFeedbackHidden && playerHealth > 0)"),
  engine.indexOf("function frame(now"),
);
assert.ok(engine.indexOf("sampleDayNight(worldTimeMs") < engine.indexOf("if (!firstPersonFeedbackHidden"),
  "the viewmodel inherits the sampled scene day/night uniforms");
assert.ok(engine.includes("firstPersonTorchUniforms[3] = activeTorchUniforms[3] / 2"),
  "nearby cave torch availability is derived from the scene light set");
assert.equal((viewmodelDraw.match(/firstPersonTorchUniforms/g) ?? []).length, 2,
  "textured and solid held geometry share the same scene-derived local light");
assert.ok(viewmodelDraw.includes("gl.uniform1f(lightingLocation, 1)"),
  "solid tools never bypass environmental lighting with a full-bright path");
const shotIntent = engine.slice(engine.indexOf("function rangedShotIntent"), engine.indexOf("function requestCanvasPointerLock"));
assert.ok(shotIntent.includes("const facing = direction()")
  && shotIntent.includes("direction: [facing[0], facing[1], facing[2]]"),
"projectile direction remains the camera ray and is independent of viewmodel geometry");

renderer[7]();
console.log("held cube, axe, pickaxe, bow, lighting, and aiming pose tests passed");
