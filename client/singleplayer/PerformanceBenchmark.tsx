import { useEffect, useRef, useState } from "preact/hooks";
import { BLOCK, createVoxelEngine, type VoxelEngine, type VoxelPerformanceStats } from "../game";
import {
  PERFORMANCE_BENCHMARK_DURATION_MS,
  PERFORMANCE_BENCHMARK_IDLE_MS,
  PERFORMANCE_BENCHMARK_TURN_MS,
  PERFORMANCE_BENCHMARK_WARMUP_MS,
  performanceBenchmarkPhase,
  summarizePerformanceEngine,
  summarizePerformanceFrames,
  type PerformanceBenchmarkPhase,
  type PerformanceEngineSample,
  type PerformanceFrameSample,
} from "../game/performanceBenchmark.ts";

const BENCHMARK_SEED = 7319;

function benchmarkKey(code: string, down: boolean): void {
  window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { bubbles: true, code }));
}

function startCreativeFlight(): void {
  benchmarkKey("Space", true);
  benchmarkKey("Space", false);
  window.setTimeout(() => {
    benchmarkKey("Space", true);
    benchmarkKey("Space", false);
  }, 80);
}

function benchmarkRenderer(canvas: HTMLCanvasElement): { vendor: string; renderer: string } {
  const gl = canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return {
    vendor: String(gl && extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : "unavailable"),
    renderer: String(gl && extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : "unavailable"),
  };
}

function phaseFrames(samples: readonly PerformanceFrameSample[], phase: PerformanceFrameSample["phase"]) {
  return summarizePerformanceFrames(samples.filter((sample) => sample.phase === phase));
}

function phaseEngine(samples: readonly PerformanceEngineSample[], phase: PerformanceEngineSample["phase"]) {
  return summarizePerformanceEngine(samples.filter((sample) => sample.phase === phase));
}

export function SinglePlayerPerformanceBenchmark({ renderDistance }: { renderDistance: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const latestStatsRef = useRef<VoxelPerformanceStats | null>(null);
  const [phase, setPhase] = useState<PerformanceBenchmarkPhase>("warmup");
  const [output, setOutput] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let canceled = false;
    let sampleFrame = 0;
    let lastSampleAt = 0;
    let benchmarkStartedAt = 0;
    let sprinting = false;
    const frameSamples: PerformanceFrameSample[] = [];
    const engineSamples: PerformanceEngineSample[] = [];
    const constructionStartedAt = performance.now();
    const engine = createVoxelEngine(canvas, {
      seed: BENCHMARK_SEED,
      streamingChunkRadius: renderDistance,
      initialPose: { x: 0.5, y: 100, z: 0.5, yaw: 0, pitch: -0.18 },
      preserveInitialPose: true,
      selectedBlock: BLOCK.STONE,
      selectedItem: "diamond_pickaxe",
      canCreativeFly: () => true,
      canMobsTargetPlayer: () => false,
      canTakePlayerDamage: () => false,
      allowUnlockedKeyboardInput: () => true,
      getFieldOfViewRadians: () => Math.PI / 2,
      onPerformanceStats: (stats) => {
        latestStatsRef.current = stats;
        if (!benchmarkStartedAt) return;
        const currentPhase = performanceBenchmarkPhase(performance.now() - benchmarkStartedAt);
        if (currentPhase === "idle" || currentPhase === "turn" || currentPhase === "sprint") {
          engineSamples.push({ phase: currentPhase, stats: { ...stats } });
        }
      },
    });
    const constructMs = performance.now() - constructionStartedAt;
    engineRef.current = engine;
    engine.start();
    startCreativeFlight();

    const complete = () => {
      benchmarkKey("KeyW", false);
      benchmarkKey("ControlLeft", false);
      const canvasRect = canvas.getBoundingClientRect();
      const renderer = benchmarkRenderer(canvas);
      const result = {
        schemaVersion: 1,
        seed: BENCHMARK_SEED,
        renderDistance,
        durationMs: PERFORMANCE_BENCHMARK_DURATION_MS,
        warmupMs: PERFORMANCE_BENCHMARK_WARMUP_MS,
        constructMs: Number(constructMs.toFixed(3)),
        viewport: {
          cssWidth: Math.round(canvasRect.width),
          cssHeight: Math.round(canvasRect.height),
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          devicePixelRatio: window.devicePixelRatio,
        },
        renderer,
        userAgent: navigator.userAgent,
        finalPose: engine.getPose(),
        frames: {
          all: summarizePerformanceFrames(frameSamples),
          idle: phaseFrames(frameSamples, "idle"),
          turn: phaseFrames(frameSamples, "turn"),
          sprint: phaseFrames(frameSamples, "sprint"),
        },
        engine: {
          all: summarizePerformanceEngine(engineSamples),
          idle: phaseEngine(engineSamples, "idle"),
          turn: phaseEngine(engineSamples, "turn"),
          sprint: phaseEngine(engineSamples, "sprint"),
          final: latestStatsRef.current,
        },
      };
      const json = JSON.stringify(result, null, 2);
      (window as unknown as { __lakecraftPerformanceResult: unknown }).__lakecraftPerformanceResult = result;
      document.documentElement.dataset.lakecraftBenchmark = "complete";
      console.log("LAKECRAFT_PERFORMANCE_RESULT", JSON.stringify(result));
      setOutput(json);
      setPhase("complete");
      // The final framebuffer and JSON remain visible, but the benchmark must
      // release its RAF loop, listeners, buffers, and CPU/GPU work once sampled.
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };

    const sample = (now: number) => {
      if (canceled) return;
      if (!benchmarkStartedAt) {
        if (now - constructionStartedAt < constructMs + PERFORMANCE_BENCHMARK_WARMUP_MS) {
          sampleFrame = requestAnimationFrame(sample);
          return;
        }
        benchmarkStartedAt = now;
        lastSampleAt = now;
      }
      const elapsed = now - benchmarkStartedAt;
      const currentPhase = performanceBenchmarkPhase(elapsed);
      setPhase((previous) => previous === currentPhase ? previous : currentPhase);
      if (currentPhase === "complete") {
        complete();
        return;
      }
      if (lastSampleAt > 0) frameSamples.push({ phase: currentPhase, frameTimeMs: now - lastSampleAt });
      lastSampleAt = now;
      if (currentPhase === "turn") {
        const turnElapsed = elapsed - PERFORMANCE_BENCHMARK_IDLE_MS;
        engine.setBenchmarkLook?.(turnElapsed / PERFORMANCE_BENCHMARK_TURN_MS * Math.PI * 2, -0.18);
      } else if (currentPhase === "sprint") {
        engine.setBenchmarkLook?.(0, -0.18);
        if (!sprinting) {
          sprinting = true;
          benchmarkKey("KeyW", true);
          benchmarkKey("ControlLeft", true);
        }
      }
      sampleFrame = requestAnimationFrame(sample);
    };
    sampleFrame = requestAnimationFrame(sample);
    return () => {
      canceled = true;
      cancelAnimationFrame(sampleFrame);
      benchmarkKey("KeyW", false);
      benchmarkKey("ControlLeft", false);
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [renderDistance]);

  return (
    <main data-performance-benchmark>
      <style>{`[data-performance-benchmark]{background:#111;color:#fff;font:14px/1.45 monospace;inset:0;overflow:hidden;position:fixed}[data-performance-benchmark] canvas{display:block;height:100%;width:100%}[data-performance-benchmark] aside{background:rgba(0,0,0,.78);left:12px;max-height:calc(100% - 24px);max-width:min(620px,calc(100% - 24px));overflow:auto;padding:12px;position:absolute;top:12px;z-index:2}[data-performance-benchmark] strong{color:#8cff9b}[data-performance-benchmark] pre{font:11px/1.35 monospace;margin:8px 0 0;white-space:pre-wrap}`}</style>
      <canvas aria-label="Automated Lakecraft performance benchmark" ref={canvasRef} />
      <aside><strong>Lakecraft benchmark · distance {renderDistance} · {phase}</strong>{output ? <pre>{output}</pre> : <p>Autonomously measuring idle, turning, and sprinting frame pacing…</p>}</aside>
    </main>
  );
}
