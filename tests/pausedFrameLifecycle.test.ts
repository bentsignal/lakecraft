import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAUSED_RENDER_INTERVAL_MS, createVoxelEngine } from "../client/game/voxelEngine.ts";
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
  "compileShader", "deleteBuffer", "deleteProgram", "deleteShader", "deleteTexture", "depthMask", "disable",
  "disableVertexAttribArray", "enable", "enableVertexAttribArray", "lineWidth", "linkProgram", "pixelStorei",
  "shaderSource", "texImage2D", "texParameteri", "uniform1f", "uniform1i", "uniform2fv", "uniform3f", "uniform3fv",
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
let rangedChargeStarts = 0;
let rangedChargeCancels = 0;
let rangedReleases = 0;
let allowUnlockedKeyboardInput = false;
const engine = createVoxelEngine(canvas, {
  seed: 91,
  worldRadius: 8,
  onPerformanceStats: () => { performanceCallbacks += 1; },
  isRangedWeaponSelected: () => true,
  onRangedChargeChange: (charging) => {
    if (charging) rangedChargeStarts += 1;
  },
  onRangedCancel: () => { rangedChargeCancels += 1; },
  onRangedRelease: () => { rangedReleases += 1; },
  allowUnlockedKeyboardInput: () => allowUnlockedKeyboardInput,
});
engine.start();
assert.equal(frames.size, 1);

driveFrame(1_016);
assert.ok(glCalls.clear > 0 && glCalls.drawArrays > 0 && glCalls.viewport > 0,
  "an active frame performs the real resize and WebGL render lifecycle");
const activeSnapshot = engine.exportRuntimeSnapshot();

(document as unknown as { pointerLockElement: Element | null }).pointerLockElement = canvas;
for (const listener of listeners.get("mousedown") ?? []) {
  listener({ button: 2, preventDefault: noop } as unknown as MouseEvent);
}
assert.equal(rangedChargeStarts, 1, "a locked secondary press begins exactly one bow draw");
assert.equal(engine.cancelRangedActionForEscape(), true, "Escape cancels an active bow draw");
assert.equal(engine.cancelRangedActionForEscape(), false, "the cancellation is idempotent after the draw clears");
assert.equal(rangedChargeCancels, 1, "the active draw emits exactly one cancellation");
for (const listener of listeners.get("mouseup") ?? []) {
  listener({ button: 2, preventDefault: noop } as unknown as MouseEvent);
}
assert.equal(rangedReleases, 0, "the matching mouseup cannot fire a cancelled bow shot");
(document as unknown as { pointerLockElement: Element | null }).pointerLockElement = null;

const beforeSilentRecaptureMove = engine.getPose();
allowUnlockedKeyboardInput = true;
for (const listener of listeners.get("keydown") ?? []) {
  listener({ code: "KeyW", repeat: false, preventDefault: noop } as unknown as KeyboardEvent);
}
driveFrame(1_032);
driveFrame(1_048);
for (const listener of listeners.get("keyup") ?? []) {
  listener({ code: "KeyW" } as unknown as KeyboardEvent);
}
allowUnlockedKeyboardInput = false;
assert.notDeepEqual(engine.getPose(), beforeSilentRecaptureMove,
  "the gameplay key that silently requests pointer capture still moves immediately while unlocked");

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

driveFrame(1_051);
assert.ok(glCalls.clear > pausedCalls.clear && glCalls.drawArrays > pausedCalls.drawArrays,
  "the first paused heartbeat redraws the retained world and held viewmodel after menu paint");
assert.equal(glCalls.bufferSubData, pausedCalls.bufferSubData,
  "paused redraws reuse retained mob, TNT, projectile, drop, and particle geometry");
const firstPausedPreview = { ...glCalls };
driveFrame(1_149);
assert.deepEqual(glCalls, firstPausedPreview,
  "paused heartbeats below the render interval do no WebGL work");
driveFrame(1_151);
assert.ok(glCalls.clear > firstPausedPreview.clear,
  "the bounded paused cadence redraws after its interval");
const boundedPreview = { ...glCalls };
for (let index = 1; index <= 600; index += 1) driveFrame(1_151 + index * 16);
const pausedRenderCount = (glCalls.clear - boundedPreview.clear) / 2;
assert.ok(Number.isInteger(pausedRenderCount) && pausedRenderCount > 0 && pausedRenderCount <= 96,
  "ten seconds of paused heartbeats redraw at no more than the 10 Hz compositor-safe cadence");
assert.equal(PAUSED_RENDER_INTERVAL_MS, 100, "the paused preview cadence remains explicitly bounded at 10 Hz");
assert.equal(glCalls.bufferSubData, pausedCalls.bufferSubData,
  "the sustained paused cadence performs no dynamic geometry uploads");
assert.equal(performanceCallbacks, pausedPerformanceCallbacks, "paused heartbeats emit no performance samples");
assert.deepEqual(engine.exportRuntimeSnapshot(), pausedSnapshot,
  "world time, mobs, player state, and accumulators remain frozen while paused");

engine.setFirstPersonFeedbackHidden(true);
const hiddenPreview = { ...glCalls };
driveFrame(11_000);
assert.deepEqual(glCalls, hiddenPreview, "blocking UI performs zero paused GL work");
engine.setFirstPersonFeedbackHidden(false);
(document as unknown as { visibilityState: DocumentVisibilityState }).visibilityState = "hidden";
const backgroundPreview = { ...glCalls };
driveFrame(11_200);
assert.deepEqual(glCalls, backgroundPreview, "a backgrounded tab performs zero paused GL work");
(document as unknown as { visibilityState: DocumentVisibilityState }).visibilityState = "visible";
driveFrame(11_201);
assert.ok(glCalls.clear > backgroundPreview.clear,
  "a visible unblocked paused scene resumes its bounded compositor refresh");
assert.deepEqual(engine.exportRuntimeSnapshot(), pausedSnapshot,
  "paused visibility and blocker transitions do not advance runtime state");

const beforePauseToggles = { ...glCalls };
for (let index = 0; index < 100; index += 1) {
  assert.equal(engine.setPaused(false), false);
  assert.equal(engine.setPaused(true), true);
  assert.equal(frames.size, 1, "pause toggles cannot duplicate the RAF loop");
}
assert.deepEqual(glCalls, beforePauseToggles, "pause toggles do not render synchronously");

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
assert.equal(appSource.match(/singlePlayerGameplayPaused\(\{/g)?.length, 4,
  "startup, UI, visibility, and active-play accounting share one pause predicate");
assert.equal(appSource.match(/engineRef\.current\?\.setPaused\(paused\)/g)?.length, 2,
  "both UI-state and visibility transitions preserve the pause contract");

console.log("paused voxel frame lifecycle tests passed");
