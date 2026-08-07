import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PERSON_CUBE_ROTATION,
  createFirstPersonRenderer,
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

function spatialBounds(data: Float32Array, vertexCount: number): readonly [number, number, number, number, number, number] {
  let minimumX = Infinity; let maximumX = -Infinity; let minimumY = Infinity;
  let maximumY = -Infinity; let minimumZ = Infinity; let maximumZ = -Infinity;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 6;
    minimumX = Math.min(minimumX, data[offset]); maximumX = Math.max(maximumX, data[offset]);
    minimumY = Math.min(minimumY, data[offset + 1]); maximumY = Math.max(maximumY, data[offset + 1]);
    minimumZ = Math.min(minimumZ, data[offset + 2]); maximumZ = Math.max(maximumZ, data[offset + 2]);
  }
  return [minimumX, maximumX, minimumY, maximumY, minimumZ, maximumZ];
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
for (const [index, expected] of [28.648, -37.815, 2.292].map((value) => value * Math.PI / 180).entries()) {
  assert.ok(Math.abs(FIRST_PERSON_CUBE_ROTATION[index] - expected) < 0.00001,
    "human-readable tuning degrees preserve the prior live-reviewed held-block pose");
}
const cubeCenters = Array.from({ length: 6 }, (_, face) => center(cube, face * 6, 6));
assert.ok(cubeCenters.every((point) => point.every(Number.isFinite)),
  "all six installed block-model faces remain finite around the wrist socket");
const readableAreas = Array.from({ length: 6 }, (_, face) => projectedFaceArea(cube, face));
assert.ok(readableAreas.filter((area) => area > 0.0001).length >= 3,
  "the perspective-held cube retains at least three readable faces");

renderer[3]("iron_pickaxe", BLOCK.AIR);
const pickaxe = capture.uploads.get(1);
if (!pickaxe) throw new Error("pickaxe upload missing");
const pickBounds = spatialBounds(pickaxe, renderer[2][0]);
assert.ok(pickBounds[1] - pickBounds[0] > 0.25 && pickBounds[3] - pickBounds[2] > 0.35,
  "the canonical pickaxe pixels retain a tall handle and broad head in hand");
const pickDepth = pickBounds[5] - pickBounds[4];
assert.ok(pickDepth > 0.01 && pickDepth < 0.5,
  "the pickaxe stays thin and face-readable instead of a chunky edge-on block sculpture");

renderer[3]("iron_axe", BLOCK.AIR);
const axe = capture.uploads.get(1);
if (!axe) throw new Error("axe upload missing");
const axeBounds = spatialBounds(axe, renderer[2][0]);
assert.ok(axeBounds[1] - axeBounds[0] > 0.2 && axeBounds[3] - axeBounds[2] > 0.35,
  `the canonical axe pixels retain a long grip and distinct broad blade: ${JSON.stringify(axeBounds)}`);
assert.ok(axeBounds[5] - axeBounds[4] > 0.01,
  "the opaque-edge axe has a readable three-dimensional cant");

renderer[3]("bow", BLOCK.AIR);
renderer[4](true, 1);
const bow = capture.uploads.get(1);
if (!bow) throw new Error("bow upload missing");
assert.equal(renderer[2][0], 1_500, "the full-draw bow is its exact installed staged sprite without an unrelated arm");
const bowSpatialBounds = spatialBounds(bow, renderer[2][0]);
assert.ok(bowSpatialBounds[3] - bowSpatialBounds[2] > 0.3,
  "the full-draw bow retains its tall familiar silhouette");
const portraitProjection = new Float32Array(16);
portraitProjection[0] = 2;
portraitProjection[5] = 1;
portraitProjection[10] = -1;
portraitProjection[11] = -1;
portraitProjection[14] = -0.2;
const portraitMvp = renderer[6](new Float32Array(16), portraitProjection, 0, false);
const portraitBow = capture.uploads.get(1);
if (!portraitBow) throw new Error("portrait bow upload missing");
const bowBounds = clipBounds(portraitBow, portraitMvp);
assert.ok(bowBounds[0] >= -1 && bowBounds[1] <= 1.01 && bowBounds[2] >= -1 && bowBounds[3] <= 1,
  `the complete drawn bow stays visible at a portrait two-to-one projection: ${JSON.stringify(bowBounds)}`);

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const viewmodelDraw = engine.slice(
  engine.indexOf("if (cameraMode === \"first_person\" && !firstPersonFeedbackHidden && playerHealth > 0)"),
  engine.indexOf("function frame(now"),
);
assert.ok(engine.indexOf("sampleDayNight(worldTimeMs") < engine.indexOf("if (cameraMode === \"first_person\""),
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
