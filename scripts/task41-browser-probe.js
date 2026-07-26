(() => {
  "use strict";

  const GLOBAL_KEY = "__lakecraftTask41Probe";
  const existing = window[GLOBAL_KEY];
  if (existing && typeof existing.stop === "function") existing.stop();

  const samples = [];
  const restorers = [];
  const patchedContexts = new Set();
  let animationFrame = 0;
  let frameDrawCalls = 0;
  let lastFrameAt = null;
  let stopped = false;
  let totalDrawCalls = 0;

  function patchMethod(contextName, prototype, methodName) {
    if (!prototype) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
    if (!descriptor || typeof descriptor.value !== "function" || descriptor.configurable !== true) return;
    const original = descriptor.value;
    Object.defineProperty(prototype, methodName, {
      ...descriptor,
      value(...args) {
        frameDrawCalls += 1;
        totalDrawCalls += 1;
        return original.apply(this, args);
      },
    });
    patchedContexts.add(contextName);
    restorers.push(() => Object.defineProperty(prototype, methodName, descriptor));
  }

  for (const [contextName, constructor] of [
    ["webgl", window.WebGLRenderingContext],
    ["webgl2", window.WebGL2RenderingContext],
  ]) {
    patchMethod(contextName, constructor?.prototype, "drawArrays");
    patchMethod(contextName, constructor?.prototype, "drawElements");
  }

  function frame(now) {
    if (stopped) return;
    if (lastFrameAt !== null && now > lastFrameAt) {
      samples.push({ drawCalls: frameDrawCalls, frameMs: now - lastFrameAt });
      if (samples.length > 3_600) samples.shift();
    }
    frameDrawCalls = 0;
    lastFrameAt = now;
    animationFrame = window.requestAnimationFrame(frame);
  }

  function percentile(sorted, ratio) {
    if (!sorted.length) return 0;
    return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
  }

  function rounded(value) {
    return Number(value.toFixed(3));
  }

  function snapshot(label) {
    const frameTimes = samples.map(({ frameMs }) => frameMs).sort((left, right) => left - right);
    const drawCalls = samples.map((sample) => sample.drawCalls).sort((left, right) => left - right);
    const durationMs = frameTimes.reduce((total, value) => total + value, 0);
    return {
      schemaVersion: 1,
      label: String(label ?? ""),
      sampleCount: samples.length,
      fps: durationMs > 0 ? rounded(samples.length * 1_000 / durationMs) : 0,
      p95FrameMs: rounded(percentile(frameTimes, 0.95)),
      drawCallsPerFrameP95: percentile(drawCalls, 0.95),
      drawCallsPerFrameMax: drawCalls.at(-1) ?? 0,
      totalDrawCalls,
      durationMs: rounded(durationMs),
      patchedContexts: patchedContexts.size,
    };
  }

  function reset() {
    samples.length = 0;
    frameDrawCalls = 0;
    lastFrameAt = null;
    totalDrawCalls = 0;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    while (restorers.length) restorers.pop()();
    if (window[GLOBAL_KEY] === api) delete window[GLOBAL_KEY];
  }

  const api = Object.freeze({ reset, snapshot, stop });
  window[GLOBAL_KEY] = api;
  animationFrame = window.requestAnimationFrame(frame);
  window.console.info("[Lakecraft Task 41 probe installed]", { patchedContexts: patchedContexts.size });
})();
