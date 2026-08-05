import assert from "node:assert/strict";
import { createVoxelEngine, TERRAIN_VERTEX_SHADER, VERTEX_SHADER } from "../client/game/voxelEngine.ts";
import { BLOCK, type WorldEdit } from "../client/game/types.ts";

type Frame = (now: number) => void;
type UniformLocation = { program: number; name: string };

let clock = 1_000;
let nextFrameId = 1;
let nextProgramId = 1;
let nextBufferId = 1;
const frames = new Map<number, Frame>();
const scalarCalls: Array<{ location: UniformLocation; value: number }> = [];
const vectorCalls: Array<{ location: UniformLocation; value: Float32Array }> = [];
const uploads: Float32Array[] = [];

const requestFrame = (callback: Frame): number => {
  const id = nextFrameId++;
  frames.set(id, callback);
  return id;
};
const noop = () => undefined;
const object = () => ({});
const glMethods: Record<string, (...args: any[]) => any> = {
  createBuffer: () => ({ id: nextBufferId++ }),
  createProgram: () => ({ id: nextProgramId++ }),
  createShader: object,
  createTexture: object,
  getAttribLocation: () => 0,
  getUniformLocation: (program: { id: number }, name: string): UniformLocation => ({ program: program.id, name }),
  getParameter: () => 8,
  getProgramParameter: () => true,
  getShaderParameter: () => true,
  getProgramInfoLog: () => "",
  getShaderInfoLog: () => "",
  uniform1f: (location: UniformLocation, value: number) => scalarCalls.push({ location, value }),
  uniform3f: (location: UniformLocation, x: number, y: number, z: number) =>
    vectorCalls.push({ location, value: new Float32Array([x, y, z]) }),
  uniform3fv: (location: UniformLocation, value: Float32Array) =>
    vectorCalls.push({ location, value: new Float32Array(value) }),
  uniform4fv: (location: UniformLocation, value: Float32Array) =>
    vectorCalls.push({ location, value: new Float32Array(value) }),
  bufferSubData: (_target: number, _offset: number, value: Float32Array) => uploads.push(new Float32Array(value)),
};
for (const method of [
  "activeTexture", "attachShader", "bindBuffer", "bindTexture", "blendFunc", "bufferData", "clear",
  "clearColor", "compileShader", "deleteBuffer", "deleteProgram", "deleteShader", "deleteTexture", "depthMask", "disable",
  "disableVertexAttribArray", "drawArrays", "enable", "enableVertexAttribArray", "lineWidth", "linkProgram",
  "pixelStorei", "shaderSource", "texImage2D", "texParameteri", "uniform1i", "uniform2fv",
  "uniformMatrix4fv", "useProgram", "vertexAttribPointer", "viewport",
]) glMethods[method] = noop;

let nextConstant = 1;
const constants = new Map<string, number>();
const gl = new Proxy(glMethods, {
  get(target, property: string) {
    if (property in target) return target[property];
    if (!constants.has(property)) constants.set(property, nextConstant++);
    return constants.get(property);
  },
}) as unknown as WebGLRenderingContext;

const listeners = new Map<string, Set<EventListener>>();
const eventTarget = {
  addEventListener(type: string, listener: EventListener) {
    let group = listeners.get(type);
    if (!group) listeners.set(type, group = new Set());
    group.add(listener);
  },
  removeEventListener(type: string, listener: EventListener) {
    listeners.get(type)?.delete(listener);
  },
};
const fakeDocument = {
  ...eventTarget,
  pointerLockElement: null,
  visibilityState: "visible",
  exitPointerLock: noop,
};
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });
Object.assign(globalThis, {
  requestAnimationFrame: requestFrame,
  cancelAnimationFrame: (id: number) => { frames.delete(id); },
  window: {
    ...eventTarget,
    devicePixelRatio: 1,
    setTimeout: () => 1,
    clearTimeout: noop,
  },
  document: fakeDocument,
});

function driveFrame(): void {
  assert.equal(frames.size, 1, "one exposure fixture owns one RAF heartbeat");
  const [id, callback] = frames.entries().next().value as [number, Frame];
  frames.delete(id);
  clock += 16;
  callback(clock);
}

type ExposureFixture = {
  exposure: number[];
  ambient: number[];
  torchRadius: number[];
  armLight: Float32Array[];
  heldCube: Float32Array;
};

function runExposureFixture(input: { roof: boolean; torch: boolean; phase: number }): ExposureFixture {
  scalarCalls.length = 0;
  vectorCalls.length = 0;
  uploads.length = 0;
  const edits: WorldEdit[] = [];
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -2; z <= 2; z += 1) {
      edits.push({ x, y: 20, z, block: BLOCK.AIR }, { x, y: 21, z, block: BLOCK.AIR });
      if (input.roof) edits.push({ x, y: 22, z, block: BLOCK.STONE });
    }
  }
  edits.push({ x: 0, y: 19, z: 0, block: BLOCK.STONE });
  if (input.torch) edits.push({ x: 1, y: 20, z: 0, block: BLOCK.TORCH });
  const canvas = {
    ...eventTarget,
    width: 0,
    height: 0,
    clientWidth: 960,
    clientHeight: 540,
    getContext: () => gl,
    requestPointerLock: noop,
  } as unknown as HTMLCanvasElement;
  const epochMs = Date.now();
  const engine = createVoxelEngine(canvas, {
    seed: 91,
    initialEdits: edits,
    initialPose: { x: 0.5, y: 20.02, z: 0.5, yaw: 0, pitch: 0 },
    preserveInitialPose: true,
    selectedItem: "dirt",
    selectedBlock: BLOCK.DIRT,
    dayNight: { cycleLengthMs: 1_000_000_000, epochMs, epochPhase: input.phase },
    serverTimeOffsetMs: epochMs - Date.now(),
  });
  const heldCube = uploads.find((upload) => upload.length === 36 * 6);
  if (!heldCube) throw new Error("the live engine did not upload its retained held-cube vertex data");
  engine.start();
  driveFrame();
  const exposure = scalarCalls.filter((call) => call.location.name === "uSkyExposure").map((call) => call.value);
  const ambient = scalarCalls.filter((call) => call.location.name === "uAmbientIntensity").map((call) => call.value);
  const torchRadius = vectorCalls.filter((call) => call.location.name === "uTorchLights[0]")
    .map((call) => call.value[3]);
  const armLight = vectorCalls.filter((call) => call.location.name === "uLight").map((call) => call.value);
  engine.destroy();
  assert.equal(frames.size, 0);
  return { exposure, ambient, torchRadius, armLight, heldCube };
}

function assertLight(actual: readonly Float32Array[], expected: readonly number[], message: string): void {
  assert.equal(actual.length, 1, `${message}: one first-person skin draw`);
  assert.equal(actual[0].length, expected.length, `${message}: vector width`);
  expected.forEach((value, index) => assert.ok(Math.abs(actual[0][index] - value) < 1e-5,
    `${message}: channel ${index} expected ${value}, received ${actual[0][index]}`));
}

assert.ok(TERRAIN_VERTEX_SHADER.includes("e*uSkyExposure"),
  "textured held vertices multiply their face exposure by the live eye-cell signal");
assert.ok(VERTEX_SHADER.includes("e*uSkyExposure"),
  "solid arms and tools use the same live eye-cell signal");

const openDay = runExposureFixture({ roof: false, torch: false, phase: 0.5 });
assert.deepEqual(openDay.exposure, [1, 1, 1],
  "world color/terrain and held-item terrain paths receive full exposure under open sky");
assertLight(openDay.armLight, [1.12, 1.12, 1.12],
  "the skin arm receives its separately clamped noon light");
assert.equal(openDay.heldCube.length, 216, "the actual atlas cube remains one retained 36-vertex upload");
assert.equal([...openDay.heldCube].filter((_value, index) => index % 6 === 5).every((shade) => shade > 0 && shade <= 1), true,
  "the actual textured vertex stream preserves six authored face shades for shader lighting");

const openNight = runExposureFixture({ roof: false, torch: false, phase: 0 });
assert.deepEqual(openNight.exposure, [1, 1, 1], "night changes ambient light, not open-sky occlusion");
assertLight(openNight.armLight, [0.32, 0.32, 0.32],
  "the open-sky skin arm retains the reviewed moonlit floor");
assert.ok(Math.max(...openNight.ambient) < Math.min(...openDay.ambient),
  "exposed night retains its real lower day/night ambient signal");

const caveDay = runExposureFixture({ roof: true, torch: false, phase: 0.5 });
assert.deepEqual(caveDay.exposure, [1, 1, 0],
  "world draws stay normalized while the held-item terrain path receives zero cave exposure");
assertLight(caveDay.armLight, [0.4484, 0.4522, 0.46018],
  "the skin arm receives the reviewed reduced noon light beneath a roof");
assert.deepEqual(caveDay.ambient, openDay.ambient,
  "cave darkness is supplied by occlusion rather than faked by changing day uniforms");
assert.deepEqual(caveDay.torchRadius, [0, 0, 0],
  "an unlit cave has no synthetic torch in either world path or the held-item terrain path");

const caveTorch = runExposureFixture({ roof: true, torch: true, phase: 0.5 });
assert.deepEqual(caveTorch.exposure, [1, 1, 0], "a cave torch does not erase roof occlusion");
assertLight(caveTorch.armLight, [0.4484, 0.4522, 0.46018],
  "nearby torch uniforms do not replace the arm's bounded sky/day light vector");
assert.deepEqual(caveTorch.torchRadius, [11, 11, 5.5],
  "world paths receive the full torch radius while the held-item terrain path receives its bounded half-radius");

console.log("live first-person sky, cave, night, and torch exposure uniforms passed");
