import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  MAX_RENDERED_PLAYER_PROJECTILES,
  PLAYER_PROJECTILE_LIFETIME_MS,
  PLAYER_PROJECTILE_MESH_INTERVAL_MS,
  PLAYER_PROJECTILE_RENDER_DISTANCE,
  PLAYER_PROJECTILE_VERTICES,
  createPlayerProjectileRenderer,
  playerProjectileBufferCapacity,
  samplePlayerProjectile,
  type BallisticSample,
  type PlayerProjectileVisual,
} from "../client/game/playerProjectileRenderer.ts";
import { bowChargeProgress, bowChargeStage } from "../client/components/FirstPersonBow.tsx";

function projectile(index: number, overrides: Partial<PlayerProjectileVisual> = {}): PlayerProjectileVisual {
  return {
    projectileId: `player-arrow-${index}`,
    originX: 0,
    originY: 10,
    originZ: 0,
    velocityX: 2,
    velocityY: 8,
    velocityZ: 16,
    launchedAt: 1_000,
    ...overrides,
  };
}

const sample: BallisticSample = { x: 0, y: 0, z: 0, velocityX: 0, velocityY: 0, velocityZ: 0, ageSeconds: 0 };
assert.equal(samplePlayerProjectile(projectile(0), 500, sample), false, "a future launch is not visible");
assert.equal(samplePlayerProjectile(projectile(0), 2_000, sample), true);
assert.deepEqual(sample, {
  x: 2,
  y: 8,
  z: 16,
  velocityX: 2,
  velocityY: -12,
  velocityZ: 16,
  ageSeconds: 1,
});
const repeated = { ...sample };
assert.equal(samplePlayerProjectile(projectile(0), 2_000, repeated), true);
assert.deepEqual(repeated, sample, "identical snapshot/time inputs have byte-stable numeric output");
assert.equal(samplePlayerProjectile(projectile(0), 1_000 + PLAYER_PROJECTILE_LIFETIME_MS + 1, sample), false);
assert.equal(samplePlayerProjectile(projectile(0, { expiresAt: 1_500 }), 1_501, sample), false);

assert.equal(bowChargeProgress(-1), 0);
assert.equal(bowChargeProgress(500), 0.5);
assert.equal(bowChargeProgress(2_000), 1);
assert.equal(bowChargeStage(0.54), 0);
assert.equal(bowChargeStage(0.55), 1);
assert.equal(bowChargeStage(0.9), 2);

const capacity = playerProjectileBufferCapacity();
assert.equal(capacity.projectileCount, MAX_RENDERED_PLAYER_PROJECTILES);
assert.equal(capacity.vertexCount, MAX_RENDERED_PLAYER_PROJECTILES * PLAYER_PROJECTILE_VERTICES);
assert.equal(capacity.totalBytes, 248_832, "the fixed worst-case player-arrow batch stays under 250 KiB");
assert.deepEqual(playerProjectileBufferCapacity(-1), { projectileCount: 0, vertexCount: 0, floatCount: 0, totalBytes: 0 });
assert.equal(playerProjectileBufferCapacity(1_000).projectileCount, MAX_RENDERED_PLAYER_PROJECTILES);

let createdBuffers = 0;
let deletedBuffers = 0;
let capacityBytes = 0;
const uploadBytes: number[] = [];
const fakeBuffer = {} as WebGLBuffer;
const fakeGl = {
  ARRAY_BUFFER: 0x8892,
  DYNAMIC_DRAW: 0x88e8,
  createBuffer() {
    createdBuffers += 1;
    return fakeBuffer;
  },
  bindBuffer() {},
  bufferData(_target: number, size: number) {
    capacityBytes = size;
  },
  bufferSubData(_target: number, _offset: number, data: Float32Array) {
    uploadBytes.push(data.byteLength);
  },
  deleteBuffer(buffer: WebGLBuffer) {
    assert.equal(buffer, fakeBuffer);
    deletedBuffers += 1;
  },
} as unknown as WebGLRenderingContext;

const renderer = createPlayerProjectileRenderer(fakeGl);
assert.equal(createdBuffers, 1);
assert.equal(capacityBytes, capacity.totalBytes, "GPU capacity is allocated exactly once");

renderer.setProjectiles([
  projectile(0),
  projectile(1, { originX: PLAYER_PROJECTILE_RENDER_DISTANCE + 10 }),
  projectile(2, { launchedAt: 10_000 }),
]);
let stats = renderer.update(2_000, [0, 10, 0]);
assert.equal(stats.totalProjectileCount, 3);
assert.equal(stats.activeProjectileCount, 2);
assert.equal(stats.visibleProjectileCount, 1);
assert.equal(stats.vertexCount, PLAYER_PROJECTILE_VERTICES);
assert.equal(stats.uploadBytes, PLAYER_PROJECTILE_VERTICES * 6 * Float32Array.BYTES_PER_ELEMENT);
assert.equal(uploadBytes.length, 1, "all visible player arrows use one upload");

stats = renderer.update(2_000 + PLAYER_PROJECTILE_MESH_INTERVAL_MS / 2, [0, 10, 0]);
assert.equal(stats.updated, false, "duplicate high-refresh updates are capped at 60 Hz");
assert.equal(uploadBytes.length, 1);

renderer.setProjectiles(Array.from({ length: 160 }, (_, index) => projectile(index, { velocityX: 0, velocityY: 0, velocityZ: 0 })));
stats = renderer.update(2_000 + PLAYER_PROJECTILE_MESH_INTERVAL_MS, [0, 0, 0]);
assert.equal(stats.totalProjectileCount, MAX_RENDERED_PLAYER_PROJECTILES);
assert.equal(stats.visibleProjectileCount, MAX_RENDERED_PLAYER_PROJECTILES);
assert.equal(stats.uploadBytes, capacity.totalBytes);
assert.equal(uploadBytes.length, 2, "the worst case is still one bounded upload");

renderer.setProjectiles([projectile(0, { expiresAt: 1_100 })]);
stats = renderer.update(2_100, [0, 0, 0]);
assert.equal(stats.activeProjectileCount, 0);
assert.equal(stats.uploadBytes, 0);
assert.equal(uploadBytes.length, 2, "an empty batch does not upload stale geometry");

const benchmarkProjectiles = Array.from({ length: MAX_RENDERED_PLAYER_PROJECTILES }, (_, index) => projectile(index, {
  originX: (index % 8) - 4,
  originZ: Math.floor(index / 8) - 6,
  velocityX: (index % 3) - 1,
}));
const benchmarkStart = performance.now();
for (let frame = 0; frame < 2_000; frame += 1) {
  renderer.setProjectiles(benchmarkProjectiles);
  renderer.update(1_000 + (frame % 240) * 16, [0, 8, 0]);
}
const benchmarkMs = performance.now() - benchmarkStart;
assert.ok(benchmarkMs < 650, `192,000 arrow samples/meshes took ${benchmarkMs.toFixed(1)}ms (budget: 650ms)`);

renderer.destroy();
assert.equal(deletedBuffers, 1);

console.log(JSON.stringify({
  benchmark: "fixed player-projectile pool",
  projectileSamples: MAX_RENDERED_PLAYER_PROJECTILES * 2_000,
  gpuCapacityBytes: capacity.totalBytes,
  elapsedMs: Number(benchmarkMs.toFixed(2)),
}));
console.log("player projectile renderer tests passed");
