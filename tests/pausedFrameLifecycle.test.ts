import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createVoxelEngine } from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";

type Frame = (now: number) => void;

let clock = 1_000;
let nextFrameId = 1;
const frames = new Map<number, Frame>();
const glCalls = { clear: 0, drawArrays: 0, bufferSubData: 0, viewport: 0 };

function requestFrame(callback: Frame): number {
  const id = nextFrameId++;
  frames.set(id, callback);
  return id;
}

function cancelFrame(id: number): void {
  frames.delete(id);
}

function driveFrame(now: number): void {
  assert.equal(frames.size, 1, "the engine owns exactly one RAF heartbeat");
  const [id, callback] = frames.entries().next().value as [number, Frame];
  frames.delete(id);
  clock = now;
  callback(now);
}

const objects = () => ({});
const noop = () => undefined;
const glMethods: Record<string, (...args: any[]) => any> = {
  createBuffer: objects,
  createProgram: objects,
  createShader: objects,
  createTexture: objects,
  getAttribLocation: () => 0,
  getUniformLocation: objects,
  getParameter: () => 8,
  getProgramParameter: () => true,
  getShaderParameter: () => true,
  getProgramInfoLog: () => "",
  getShaderInfoLog: () => "",
  clear: () => { glCalls.clear += 1; },
  drawArrays: () => { glCalls.drawArrays += 1; },
  bufferSubData: () => { glCalls.bufferSubData += 1; },
  viewport: () => { glCalls.viewport += 1; },
};
for (const method of [
  "activeTexture", "attachShader", "bindBuffer", "bindTexture", "blendFunc", "bufferData", "clearColor",
  "compileShader", "deleteBuffer", "deleteProgram", "deleteTexture", "depthMask", "disable",
  "disableVertexAttribArray", "enable", "enableVertexAttribArray", "lineWidth", "linkProgram", "pixelStorei",
  "shaderSource", "texImage2D", "texParameteri", "uniform1f", "uniform1i", "uniform3f", "uniform3fv",
  "uniform4fv", "uniformMatrix4fv", "useProgram", "vertexAttribPointer",
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
const canvas = {
  ...eventTarget,
  width: 0,
  height: 0,
  clientWidth: 320,
  clientHeight: 180,
  getContext: () => gl,
  requestPointerLock: noop,
} as unknown as HTMLCanvasElement;

Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });
Object.assign(globalThis, {
  requestAnimationFrame: requestFrame,
  cancelAnimationFrame: cancelFrame,
  window: {
    ...eventTarget,
    devicePixelRatio: 1,
    setTimeout: () => 1,
    clearTimeout: noop,
  },
  document: {
    ...eventTarget,
    pointerLockElement: null,
    visibilityState: "visible",
    exitPointerLock: noop,
  },
});

let performanceCallbacks = 0;
const engine = createVoxelEngine(canvas, {
  seed: 91,
  worldRadius: 8,
  onPerformanceStats: () => { performanceCallbacks += 1; },
});
engine.start();
assert.equal(frames.size, 1);

driveFrame(1_016);
assert.ok(glCalls.clear > 0 && glCalls.drawArrays > 0 && glCalls.viewport > 0,
  "an active frame performs the real resize and WebGL render lifecycle");
const activeSnapshot = engine.exportRuntimeSnapshot();

engine.spawnBlockParticles({ action: "break", block: BLOCK.DIAMOND_ORE, x: 0, y: 12, z: 0 });
engine.applyWorldEdits([{ x: 1, y: 12, z: 1, block: BLOCK.TNT }]);
engine.setPrimedTntFuses([{
  eventId: "pause-fixture",
  x: 1,
  y: 12,
  z: 1,
  ignitedAt: Date.now(),
  dueAt: Date.now() + 4_000,
}]);
driveFrame(1_050);
const populatedStats = engine.getPerformanceStats();
assert.equal(populatedStats.activeParticleCount, 16);
assert.equal(populatedStats.primedTntVisibleCount, 1);
assert.ok(populatedStats.mobCount > 0, "the pause fixture contains live particles, TNT, and mobs");
engine.setPaused(true);
const pausedSnapshot = engine.exportRuntimeSnapshot();
assert.ok(pausedSnapshot.worldTimeMs > activeSnapshot.worldTimeMs,
  "active frames advance the live runtime before the pause boundary");
const pausedCalls = { ...glCalls };
const pausedPerformanceCallbacks = performanceCallbacks;

for (let index = 1; index <= 600; index += 1) driveFrame(1_050 + index * 16);
assert.deepEqual(glCalls, pausedCalls,
  "600 paused heartbeats perform no resize, clear, draw, mob/TNT upload, or particle upload work");
assert.equal(performanceCallbacks, pausedPerformanceCallbacks, "paused heartbeats emit no performance samples");
assert.deepEqual(engine.exportRuntimeSnapshot(), pausedSnapshot,
  "world time, mobs, player state, and accumulators remain frozen while paused");

for (let index = 0; index < 100; index += 1) {
  assert.equal(engine.setPaused(false), false);
  assert.equal(engine.setPaused(true), true);
  assert.equal(frames.size, 1, "pause toggles cannot duplicate the RAF loop");
}
assert.deepEqual(glCalls, pausedCalls, "pause toggles do not render synchronously");

clock = 40_000;
assert.equal(engine.setPaused(false), false);
canvas.clientWidth = 640;
canvas.clientHeight = 360;
driveFrame(40_016);
const resumedSnapshot = engine.exportRuntimeSnapshot();
const resumedStats = engine.getPerformanceStats();
assert.equal(canvas.width, 640);
assert.equal(canvas.height, 360, "the first resumed render applies the latest canvas dimensions");
assert.equal(resumedStats.activeParticleCount, populatedStats.activeParticleCount,
  "paused particle lifetime resumes from its frozen value");
assert.equal(resumedStats.primedTntVisibleCount, populatedStats.primedTntVisibleCount,
  "primed TNT remains retained across the paused interval");
assert.ok(resumedSnapshot.worldTimeMs - pausedSnapshot.worldTimeMs <= 17,
  "resume advances by one fresh frame instead of catching up paused wall time");
assert.ok(glCalls.clear > pausedCalls.clear && glCalls.drawArrays > pausedCalls.drawArrays,
  "rendering resumes on the existing heartbeat");
assert.notDeepEqual(resumedSnapshot, activeSnapshot, "the live runtime resumes after the frozen interval");

engine.destroy();
assert.equal(frames.size, 0, "destroy cancels the sole queued heartbeat");
const destroyedCalls = { ...glCalls };
assert.equal(engine.setPaused(true), true);
assert.equal(engine.setPaused(false), false);
assert.equal(frames.size, 0, "pause calls after destroy cannot restart the loop");
assert.deepEqual(glCalls, destroyedCalls, "destroyed engines remain render-inert");

const appSource = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const pausePredicate = "pauseOpen || inventoryOpen || worldModalOpen || deathScreenOpen || document.visibilityState !== \"visible\"";
assert.ok(appSource.includes(pausePredicate),
  "menu, inventory/crafting, container/sleep modal, death, and hidden-document states share the engine pause gate");
assert.equal(appSource.match(/engineRef\.current\?\.setPaused\(paused\)/g)?.length, 2,
  "both UI-state and visibility transitions preserve the pause contract");

console.log("paused voxel frame lifecycle tests passed");
