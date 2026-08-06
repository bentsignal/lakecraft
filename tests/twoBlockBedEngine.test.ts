import assert from "node:assert/strict";
import { createBedStructure } from "../client/game/localBeds.ts";
import { createVoxelEngine } from "../client/game/voxelEngine.ts";
import { BLOCK, type VoxelEngine, type VoxelEngineOptions, type WorldEdit } from "../client/game/types.ts";
import { respawnPointForBed, structuredBedForRespawnPoint } from "../client/singleplayer/localBed.ts";

type Frame = (now: number) => void;
type Listener = EventListenerOrEventListenerObject;

let clock = 1_000;
let nextFrameId = 1;
const frames = new Map<number, Frame>();

function requestFrame(callback: Frame): number {
  const id = nextFrameId++;
  frames.set(id, callback);
  return id;
}

function driveFrame(now: number): void {
  assert.equal(frames.size, 1, "one live engine owns one RAF heartbeat");
  const [id, callback] = frames.entries().next().value as [number, Frame];
  frames.delete(id);
  clock = now;
  callback(now);
}

function eventTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, listener: Listener) {
      let group = listeners.get(type);
      if (!group) listeners.set(type, group = new Set());
      group.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, event: Record<string, unknown>) {
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === "function") listener(event as unknown as Event);
        else listener.handleEvent(event as unknown as Event);
      }
    },
  };
}

const noop = () => undefined;
const object = () => ({});
const glMethods: Record<string, (...args: any[]) => any> = {
  createBuffer: object,
  createProgram: object,
  createShader: object,
  createTexture: object,
  getAttribLocation: () => 0,
  getUniformLocation: object,
  getParameter: () => 8,
  getProgramParameter: () => true,
  getShaderParameter: () => true,
  getProgramInfoLog: () => "",
  getShaderInfoLog: () => "",
};
for (const method of [
  "activeTexture", "attachShader", "bindBuffer", "bindTexture", "blendFunc", "bufferData", "bufferSubData",
  "clear", "clearColor", "compileShader", "deleteBuffer", "deleteProgram", "deleteShader", "deleteTexture", "depthMask",
  "disable", "disableVertexAttribArray", "drawArrays", "enable", "enableVertexAttribArray", "lineWidth",
  "linkProgram", "pixelStorei", "shaderSource", "texImage2D", "texParameteri", "uniform1f", "uniform1i",
  "uniform2fv", "uniform3f", "uniform3fv", "uniform4fv", "uniformMatrix4fv", "useProgram", "vertexAttribPointer", "viewport",
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

const windowEvents = eventTarget();
const documentEvents = eventTarget();
const fakeDocument = {
  ...documentEvents,
  pointerLockElement: null as Element | null,
  visibilityState: "visible",
  exitPointerLock() { fakeDocument.pointerLockElement = null; },
};
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });
Object.assign(globalThis, {
  requestAnimationFrame: requestFrame,
  cancelAnimationFrame: (id: number) => { frames.delete(id); },
  window: {
    ...windowEvents,
    devicePixelRatio: 1,
    setTimeout: () => 1,
    clearTimeout: noop,
  },
  document: fakeDocument,
});

function createLiveEngine(options: VoxelEngineOptions): {
  engine: VoxelEngine;
  canvas: HTMLCanvasElement;
  mouseDown(): void;
} {
  const canvasEvents = eventTarget();
  const canvas = {
    ...canvasEvents,
    width: 0,
    height: 0,
    clientWidth: 320,
    clientHeight: 180,
    getContext: () => gl,
    requestPointerLock() { fakeDocument.pointerLockElement = canvas as unknown as Element; },
  } as unknown as HTMLCanvasElement;
  const engine = createVoxelEngine(canvas, options);
  return {
    engine,
    canvas,
    mouseDown() {
      canvasEvents.dispatch("mousedown", { button: 0, preventDefault: noop });
    },
  };
}

const bed = createBedStructure({ x: 0, y: 90, z: 0 }, "east");
const baseEdits: WorldEdit[] = [
  { x: 0, y: 89, z: 0, block: BLOCK.STONE },
  { x: 1, y: 89, z: 0, block: BLOCK.STONE },
  { ...bed.foot, block: BLOCK.BED },
  { ...bed.head, block: BLOCK.BED },
  { x: 0, y: 91, z: 0, block: BLOCK.SAND },
  { x: 1, y: 91, z: 0, block: BLOCK.GRAVEL },
];

for (const selected of [bed.foot, bed.head]) {
  let acceptedBatch: readonly WorldEdit[] = [];
  const callbacks: Array<{ edit: WorldEdit; previous: number; settled: readonly WorldEdit[] }> = [];
  let miningActions = 0;
  const live = createLiveEngine({
    seed: 91,
    worldRadius: 8,
    initialEdits: baseEdits,
    initialBedStructures: [bed],
    twoBlockBeds: true,
    initialPose: { x: selected.x + 0.5, y: 90.02, z: 3.5, yaw: 0, pitch: -0.43 },
    preserveInitialPose: true,
    getMiningDuration: () => 0,
    acceptWorldEdits: (edits) => { acceptedBatch = edits.map((edit) => ({ ...edit })); return true; },
    onBlockEdit: (edit, previous, settled) => callbacks.push({ edit, previous, settled }),
    onHandAction: (action) => { if (action === "mine") miningActions += 1; },
  });
  live.engine.start();
  fakeDocument.pointerLockElement = live.canvas;
  driveFrame(clock + 16);
  assert.deepEqual(live.engine.getTarget()?.block, { ...selected, block: BLOCK.BED },
    "the live ray targets the selected bed half");
  live.mouseDown();

  assert.equal(callbacks.length, 1, "one accepted bed break pays and reports exactly once");
  assert.equal(miningActions, 1, "one accepted click emits one mining action");
  assert.deepEqual(callbacks[0]?.edit, { ...selected, block: BLOCK.AIR },
    "the semantic callback remains the original mined BED to AIR edit");
  assert.equal(callbacks[0]?.previous, BLOCK.BED);
  assert.equal(callbacks[0]?.settled.some((edit) => edit.x === selected.x && edit.y === selected.y
    && edit.z === selected.z && edit.block !== BLOCK.AIR), true,
  "the normalized journal batch is separate when a falling block replaces the semantic coordinate");
  assert.equal(new Set(acceptedBatch.map((edit) => `${edit.x}:${edit.y}:${edit.z}`)).size, acceptedBatch.length,
    "the accepted atomic batch is coordinate-unique after reconciliation");
  assert.equal(acceptedBatch.length, 4, "both removals and both falling sources reserve exactly four rows");
  assert.equal(live.engine.getBlockAt(bed.foot.x, bed.foot.y, bed.foot.z), BLOCK.SAND);
  assert.equal(live.engine.getBlockAt(bed.head.x, bed.head.y, bed.head.z), BLOCK.GRAVEL);
  assert.equal(live.engine.getBlockAt(bed.foot.x, bed.foot.y + 1, bed.foot.z), BLOCK.AIR);
  assert.equal(live.engine.getBlockAt(bed.head.x, bed.head.y + 1, bed.head.z), BLOCK.AIR);
  assert.equal(live.engine.getBedAt(selected.x, selected.y, selected.z), null);
  live.engine.destroy();
  assert.equal(frames.size, 0);
}

let rejectedBatch: readonly WorldEdit[] = [];
let rejectedCallbacks = 0;
const rejected = createLiveEngine({
  seed: 91,
  worldRadius: 8,
  initialEdits: baseEdits,
  initialBedStructures: [bed],
  twoBlockBeds: true,
  initialPose: { x: 0.5, y: 90.02, z: 3.5, yaw: 0, pitch: -0.43 },
  preserveInitialPose: true,
  getMiningDuration: () => 0,
  acceptWorldEdits: (edits) => { rejectedBatch = edits.map((edit) => ({ ...edit })); return false; },
  onBlockEdit: () => { rejectedCallbacks += 1; },
});
rejected.engine.start();
fakeDocument.pointerLockElement = rejected.canvas;
driveFrame(clock + 16);
rejected.mouseDown();
assert.equal(rejectedBatch.length, 4, "capacity preflight receives the exact complete four-coordinate transaction");
assert.equal(rejectedCallbacks, 0, "a rejected reservation performs no payment callback");
assert.equal(rejected.engine.getBlockAt(bed.foot.x, bed.foot.y, bed.foot.z), BLOCK.BED);
assert.equal(rejected.engine.getBlockAt(bed.head.x, bed.head.y, bed.head.z), BLOCK.BED);
assert.equal(rejected.engine.getBlockAt(bed.foot.x, bed.foot.y + 1, bed.foot.z), BLOCK.SAND);
assert.equal(rejected.engine.getBlockAt(bed.head.x, bed.head.y + 1, bed.head.z), BLOCK.GRAVEL);
assert.deepEqual(rejected.engine.getBedAt(bed.head.x, bed.head.y, bed.head.z), bed,
  "capacity rejection preserves terrain and pair metadata atomically");
rejected.engine.destroy();

const farBed = createBedStructure({ x: 240, y: 90, z: 240 }, "north");
const farEdits: WorldEdit[] = [
  { ...farBed.foot, block: BLOCK.BED },
  { ...farBed.head, block: BLOCK.BED },
];
const savedRespawn = respawnPointForBed(farBed.head.x, farBed.head.y, farBed.head.z, 0.7);
const saving = createLiveEngine({ seed: 91, initialEdits: farEdits, initialBedStructures: [farBed], twoBlockBeds: true });
saving.engine.setRespawnPoint(savedRespawn);
const runtime = saving.engine.exportRuntimeSnapshot();
saving.engine.destroy();

const reloaded = createLiveEngine({ seed: 91, initialEdits: farEdits, initialBedStructures: [farBed], twoBlockBeds: true });
assert.equal(reloaded.engine.getBlockAt(farBed.head.x, farBed.head.y, farBed.head.z), BLOCK.AIR,
  "the saved bed is outside the engine's loaded 7x7 chunk window");
assert.deepEqual(reloaded.engine.getBedAt(farBed.head.x, farBed.head.y, farBed.head.z), farBed,
  "global structure metadata remains queryable outside the rendered window");
assert.equal(reloaded.engine.importRuntimeSnapshot(runtime), true);
assert.deepEqual(structuredBedForRespawnPoint(
  reloaded.engine.getRespawnPoint(),
  (x, y, z) => reloaded.engine.getBedAt(x, y, z),
), farBed, "reload validation preserves a far but globally valid canonical bed anchor");
reloaded.engine.respawn();
assert.equal(reloaded.engine.getPose().x, savedRespawn.x);
assert.equal(reloaded.engine.getPose().z, savedRespawn.z,
  "death respawn streams to the preserved far bed instead of resetting to world spawn");
reloaded.engine.destroy();

const stale = createLiveEngine({ seed: 91, initialEdits: farEdits, twoBlockBeds: true });
assert.equal(structuredBedForRespawnPoint(savedRespawn, (x, y, z) => stale.engine.getBedAt(x, y, z)), null,
  "an unloaded BED-looking edit without valid pair metadata is safely rejected");
stale.engine.destroy();

console.log("live two-block bed engine transaction and far-respawn regressions passed");
