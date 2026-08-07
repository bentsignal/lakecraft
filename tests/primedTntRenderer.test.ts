import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_PRIMED_TNT_VISUALS,
  MOB_VERTEX_STRIDE,
  PRIMED_TNT_LABEL_VERTICES,
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
assert.equal(PRIMED_TNT_LABEL_VERTICES, 4 * 7 * 3, "seven open T-N-T glyph triangles label every TNT side");
assert.equal(PRIMED_TNT_VERTICES_PER_ENTITY, 174, "body, four side bands and labels, and five-face fuse cap stay bounded");
assert.equal(primedTntBufferBytes(), 178_176, "the labeled maximum fuse geometry stays below 175 KiB");

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
const originalDateNow = Date.now;
const earlyNow = base + 10;
const lateNow = base + 3_950;
try {
  Date.now = () => earlyNow;
  assert.equal(renderer.rebuild([], 2, 2, 0, 1, 1, 0).primedTntVertexCount, PRIMED_TNT_VERTICES_PER_ENTITY);
  const earlyGeometry = uploaded!.slice(0, PRIMED_TNT_VERTICES_PER_ENTITY * MOB_VERTEX_STRIDE);
  Date.now = () => lateNow;
  renderer.rebuild([], 2, 2, 0, 1, 1, 0);
  const lateGeometry = uploaded!.slice(0, PRIMED_TNT_VERTICES_PER_ENTITY * MOB_VERTEX_STRIDE);
  const earlyVisual = samplePrimedTntVisual(base, base + 4_000, earlyNow, { progress: 0, scale: 0, flashMix: 0 });
  const lateVisual = samplePrimedTntVisual(base, base + 4_000, lateNow, { progress: 0, scale: 0, flashMix: 0 });
  const center = [2.5, 4.5, 2.5] as const;
  const labelStarts = [42, 69, 96, 123] as const;
  const projectedLabels: Array<Array<readonly [number, number]>> = [];
  for (let side = 0; side < 4; side += 1) {
    const start = labelStarts[side];
    const projected: Array<readonly [number, number]> = [];
    for (let vertex = start; vertex < start + 21; vertex += 1) {
      const offset = vertex * MOB_VERTEX_STRIDE;
      const tangent = side < 2 ? 2 : 0;
      assert.ok(Math.abs((earlyGeometry[offset + 1] - center[1]) / earlyVisual.scale
        - (lateGeometry[offset + 1] - center[1]) / lateVisual.scale) < 1e-5,
      "fuse swelling preserves every label vertex's vertical orientation");
      assert.ok(Math.abs((earlyGeometry[offset + tangent] - center[tangent]) / earlyVisual.scale
        - (lateGeometry[offset + tangent] - center[tangent]) / lateVisual.scale) < 1e-5,
      "fuse swelling preserves every label vertex's horizontal orientation");
      const normal = side < 2 ? 0 : 2;
      const direction = side === 0 || side === 2 ? 1 : -1;
      assert.equal(Math.sign(earlyGeometry[offset + normal] - center[normal]), direction,
        "each label remains on its original outward-facing side");
      assert.equal(Math.sign(lateGeometry[offset + normal] - center[normal]), direction,
        "flashing and swelling cannot rotate a label onto another side");
      const u = side === 0 ? -(earlyGeometry[offset + 2] - center[2]) / earlyVisual.scale
        : side === 1 ? (earlyGeometry[offset + 2] - center[2]) / earlyVisual.scale
          : side === 2 ? (earlyGeometry[offset] - center[0]) / earlyVisual.scale
            : -(earlyGeometry[offset] - center[0]) / earlyVisual.scale;
      projected.push([u, (earlyGeometry[offset + 1] - center[1]) / earlyVisual.scale]);
    }
    const normal = side === 0 ? [1, 0, 0] as const : side === 1 ? [-1, 0, 0] as const
      : side === 2 ? [0, 0, 1] as const : [0, 0, -1] as const;
    for (let triangle = 0; triangle < 7; triangle += 1) {
      const offsets = [0, 1, 2].map((vertex) => (start + triangle * 3 + vertex) * MOB_VERTEX_STRIDE);
      const a = offsets.map((offset) => [
        earlyGeometry[offset] - center[0],
        earlyGeometry[offset + 1] - center[1],
        earlyGeometry[offset + 2] - center[2],
      ] as const);
      const ab = [a[1][0] - a[0][0], a[1][1] - a[0][1], a[1][2] - a[0][2]] as const;
      const ac = [a[2][0] - a[0][0], a[2][1] - a[0][1], a[2][2] - a[0][2]] as const;
      const outward = (ab[1] * ac[2] - ab[2] * ac[1]) * normal[0]
        + (ab[2] * ac[0] - ab[0] * ac[2]) * normal[1]
        + (ab[0] * ac[1] - ab[1] * ac[0]) * normal[2];
      assert.ok(outward > 0, "every TNT glyph triangle remains visible with back-face culling enabled");
    }
    projectedLabels.push(projected);
  }
  for (let side = 1; side < projectedLabels.length; side += 1) {
    for (let vertex = 0; vertex < projectedLabels[0].length; vertex += 1) {
      assert.ok(Math.abs(projectedLabels[side][vertex][0] - projectedLabels[0][vertex][0]) < 1e-5
        && Math.abs(projectedLabels[side][vertex][1] - projectedLabels[0][vertex][1]) < 1e-5,
      "all four outward views preserve the same unmirrored T-N-T letter order");
    }
  }
  assert.ok(Math.max(...projectedLabels[0].slice(0, 6).map(([u]) => u)) < 0
    && Math.min(...projectedLabels[0].slice(6, 15).map(([u]) => u)) >= -0.101
    && Math.max(...projectedLabels[0].slice(6, 15).map(([u]) => u)) <= 0.101
    && Math.min(...projectedLabels[0].slice(15).map(([u]) => u)) > 0,
  "the projected glyph reads left-to-right as T, centered open N, T");
  const nStart = (labelStarts[0] + 6) * MOB_VERTEX_STRIDE;
  let nArea = 0;
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let triangle = 0; triangle < 3; triangle += 1) {
    const vertices = [0, 1, 2].map((vertex) => nStart + (triangle * 3 + vertex) * MOB_VERTEX_STRIDE);
    const points = vertices.map((offset) => [earlyGeometry[offset + 2], earlyGeometry[offset + 1]] as const);
    for (const [u, v] of points) {
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    nArea += Math.abs((points[1][0] - points[0][0]) * (points[2][1] - points[0][1])
      - (points[2][0] - points[0][0]) * (points[1][1] - points[0][1])) * 0.5;
  }
  const nBoundsArea = (maxU - minU) * (maxV - minV);
  assert.ok(nArea > nBoundsArea * 0.2 && nArea < nBoundsArea * 0.6,
    "the center N keeps open negative space instead of filling into a solid rectangle");
  assert.notDeepEqual(lateGeometry, earlyGeometry, "late fuse flashing and swelling remain visibly animated");
} finally {
  Date.now = originalDateNow;
}
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
