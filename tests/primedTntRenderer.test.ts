import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_PRIMED_TNT_VISUALS,
  PRIMED_TNT_VERTICES_PER_ENTITY,
  createMobRenderer,
  primedTntBufferBytes,
  samplePrimedTntVisual,
  type PrimedTntVisualSample,
} from "../client/game/mobRenderer.ts";
import { TNT_MAX_ACTIVE_FUSES } from "../shared/tntAuthority.ts";

const early: PrimedTntVisualSample = { progress: 0, scale: 0, flashMix: 0 };
const late: PrimedTntVisualSample = { progress: 0, scale: 0, flashMix: 0 };
assert.equal(samplePrimedTntVisual(1_000, 5_000, 1_000, early), early);
samplePrimedTntVisual(1_000, 5_000, 4_950, late);
assert.ok(late.progress > 0.98 && late.flashMix > 0.8, "the final fuse beat flashes close to white");
assert.ok(late.scale > early.scale && late.scale <= 1.08, "the final beat swells subtly");
assert.equal(MAX_PRIMED_TNT_VISUALS, TNT_MAX_ACTIVE_FUSES, "visual and Lakebed row ceilings cannot drift");
assert.equal(PRIMED_TNT_VERTICES_PER_ENTITY, 4 * 36, "body, cream band, cap, and fuse use four boxes");
assert.equal(primedTntBufferBytes(), 110_592, "the maximum fuse geometry stays near 100 KiB");

let allocatedBytes = 0;
let uploadCalls = 0;
let uploaded: Float32Array | null = null;
const buffer = {} as WebGLBuffer;
const gl = {
  ARRAY_BUFFER: 0x8892,
  DYNAMIC_DRAW: 0x88e8,
  createBuffer: () => buffer,
  bindBuffer() {},
  bufferData(_target: number, size: number) { allocatedBytes = size; },
  bufferSubData(_target: number, _offset: number, data: Float32Array) {
    uploadCalls += 1;
    uploaded = data;
  },
  deleteBuffer() {},
} as unknown as WebGLRenderingContext;
const renderer = createMobRenderer(gl);
assert.ok(allocatedBytes > primedTntBufferBytes(), "the existing mob batch reserves the bounded fuse tail once");
const base = Date.now();
const fuses = Array.from({ length: MAX_PRIMED_TNT_VISUALS + 8 }, (_, index) => ({
  eventId: `tnt_${index}`,
  x: index === 1 ? 100 : index % 4,
  y: 7,
  z: Math.floor(index / 4),
  ignitedAt: base,
  dueAt: base + 4_000,
}));
assert.equal(renderer.setPrimedTntFuses(fuses, base), MAX_PRIMED_TNT_VISUALS);
const stats = renderer.rebuild([], 0, 0, 0, 1, 1, 0);
assert.equal(stats.visiblePrimedTntCount, MAX_PRIMED_TNT_VISUALS - 1, "far fuses are culled");
assert.equal(stats.primedTntVertexCount, (MAX_PRIMED_TNT_VISUALS - 1) * PRIMED_TNT_VERTICES_PER_ENTITY);
assert.equal(stats.vertexCount, stats.primedTntVertexCount);
assert.equal(uploadCalls, 1, "mobs and every fuse retain one upload and one draw batch");
assert.ok(uploaded && uploaded.byteLength <= allocatedBytes);

renderer.setPrimedTntFuses([], base);
assert.equal(renderer.setLocalPrimedTnt(2, 4, 2, true, base), true);
assert.equal(renderer.rebuild([], 2, 2, 0, 1, 1, 0).primedTntVertexCount, PRIMED_TNT_VERTICES_PER_ENTITY);
assert.equal(renderer.setLocalPrimedTnt(2, 4, 2, false), true);
assert.equal(renderer.rebuild([], 2, 2, 0, 1, 1, 0).primedTntVertexCount, 0);

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../client/game/mobRenderer.ts", import.meta.url), "utf8");
assert.match(engine, /setPrimedTntFuses\(fuses:/, "multiplayer has a compact snapshot API");
assert.match(engine, /block === BLOCK\.TNT && primedTnt\.has\(key\)\) continue/, "the static source cube is hidden while primed");
assert.match(engine, /setPrimedTnt\(x, y, z, primed\)/, "single-player retains its local fuse entrypoint");
const rebuild = rendererSource.slice(rendererSource.indexOf("rebuild(poses"), rendererSource.indexOf("destroy()"));
assert.doesNotMatch(rebuild, /new (?:Float32Array|Int32Array|Float64Array|Array|Map|Set)/, "the frame rebuild allocates no fuse storage");
assert.doesNotMatch(rendererSource, /lakebed\/(?:client|server)|setInterval|setTimeout/, "visuals cannot create Lakebed traffic or timers");

console.log("primed TNT retained-batch renderer tests passed");
