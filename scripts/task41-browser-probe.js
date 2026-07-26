(() => {
  "use strict";

  const GLOBAL_KEY = "__lakecraftTask41Probe";
  const TASK_ID = "jx7a5mshjv8ktdk1922wnm0xq58akz0w";
  const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
  const RUN_ID_PATTERN = /^[0-9a-f]{32}$/;
  const VIEWPORTS = Object.freeze({
    desktop: Object.freeze({ width: 1280, height: 720 }),
    narrow: Object.freeze({ width: 800, height: 720 }),
  });
  const SCENES = new Set([
    "surface-day",
    "roofed-cave-day",
    "open-shaft-day",
    "surface-night",
    "roofed-cave-night",
    "open-shaft-night",
  ]);
  const existing = window[GLOBAL_KEY];
  if (existing && typeof existing.stop === "function") existing.stop();

  const samples = [];
  const restorers = [];
  const patchedContexts = new Set();
  const usedSequences = new Set();
  let binding = null;
  let animationFrame = 0;
  let frameDrawCalls = 0;
  let lastFrameAt = null;
  let stopped = false;

  function patchMethod(contextName, prototype, methodName) {
    if (!prototype) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
    if (!descriptor || typeof descriptor.value !== "function" || descriptor.configurable !== true) return;
    const original = descriptor.value;
    Object.defineProperty(prototype, methodName, {
      ...descriptor,
      value(...args) {
        frameDrawCalls += 1;
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
      samples.push({
        frameMs: Number((now - lastFrameAt).toFixed(3)),
        drawCalls: frameDrawCalls,
      });
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

  function summarize(capture) {
    if (!capture || capture.schemaVersion !== 2 || !Array.isArray(capture.frames)) {
      throw new TypeError("Pass a Task 41 schema-version 2 performance capture.");
    }
    const frameTimes = capture.frames.map(({ frameMs }) => frameMs).sort((left, right) => left - right);
    const drawCalls = capture.frames.map(({ drawCalls }) => drawCalls).sort((left, right) => left - right);
    const durationMs = frameTimes.reduce((total, value) => total + value, 0);
    return {
      sampleCount: capture.frames.length,
      fps: durationMs > 0 ? rounded(capture.frames.length * 1_000 / durationMs) : 0,
      p95FrameMs: rounded(percentile(frameTimes, 0.95)),
      drawCallsPerFrameP95: percentile(drawCalls, 0.95),
      drawCallsPerFrameMax: drawCalls.at(-1) ?? 0,
      totalDrawCalls: drawCalls.reduce((total, value) => total + value, 0),
      durationMs: rounded(durationMs),
      patchedContexts: capture.patchedContexts,
    };
  }

  function bind({ runId, appCommit } = {}) {
    if (stopped) throw new Error("The Task 41 probe is stopped.");
    if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
      throw new TypeError("runId must be exactly 128 bits of lowercase hexadecimal.");
    }
    if (typeof appCommit !== "string" || !COMMIT_PATTERN.test(appCommit)) {
      throw new TypeError("appCommit must be a full lowercase Git commit.");
    }
    if (binding && (binding.runId !== runId || binding.appCommit !== appCommit)) {
      throw new Error("The installed probe is already bound to another run.");
    }
    binding = Object.freeze({ runId, appCommit });
    return binding;
  }

  function snapshot(label, sequence) {
    if (!binding) throw new Error("Bind the probe to the run ID and trusted commit before capture.");
    if (typeof label !== "string") throw new TypeError("A viewport/scene label is required.");
    const [viewportName, scene, extra] = label.split("/");
    const viewport = VIEWPORTS[viewportName];
    if (!viewport || !SCENES.has(scene) || extra !== undefined) {
      throw new TypeError("Use an exact Task 41 viewport/performance-scene label.");
    }
    if ((Number.isFinite(window.innerWidth) && window.innerWidth !== viewport.width)
      || (Number.isFinite(window.innerHeight) && window.innerHeight !== viewport.height)) {
      throw new Error(`Browser viewport does not match ${viewportName} (${viewport.width}x${viewport.height}).`);
    }
    if (!Number.isSafeInteger(sequence) || sequence < 1 || usedSequences.has(sequence)) {
      throw new TypeError("sequence must be a unique positive integer for this probe installation.");
    }
    usedSequences.add(sequence);
    return {
      schemaVersion: 2,
      taskId: TASK_ID,
      runId: binding.runId,
      appCommit: binding.appCommit,
      capturedAt: new Date().toISOString(),
      sequence,
      label,
      patchedContexts: patchedContexts.size,
      frames: samples.map(({ frameMs, drawCalls }) => ({ frameMs, drawCalls })),
    };
  }

  function reset() {
    samples.length = 0;
    frameDrawCalls = 0;
    lastFrameAt = null;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    while (restorers.length) restorers.pop()();
    if (window[GLOBAL_KEY] === api) delete window[GLOBAL_KEY];
  }

  const api = Object.freeze({ bind, reset, snapshot, summarize, stop });
  window[GLOBAL_KEY] = api;
  animationFrame = window.requestAnimationFrame(frame);
  window.console.info("[Lakecraft Task 41 probe installed]", { patchedContexts: patchedContexts.size });
})();
