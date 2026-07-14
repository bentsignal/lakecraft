import assert from "node:assert/strict";
import { createMobRenderer, mobVertexCountForKind } from "../client/game/mobRenderer.ts";
import type { MobKind, MobPoseSnapshot } from "../client/game/mobs.ts";

class FakeWebGl {
  readonly ARRAY_BUFFER = 0x8892;
  readonly DYNAMIC_DRAW = 0x88e8;
  readonly buffer = { kind: "mob-batch" };
  createBufferCalls = 0;
  allocationBytes = 0;
  uploadCalls = 0;
  uploaded: Float32Array | null = null;
  deleted = false;

  createBuffer() {
    this.createBufferCalls += 1;
    return this.buffer;
  }

  bindBuffer(_target: number, buffer: unknown) {
    assert.equal(buffer, this.buffer);
  }

  bufferData(_target: number, bytes: number, _usage: number) {
    this.allocationBytes = bytes;
  }

  bufferSubData(_target: number, _offset: number, data: Float32Array) {
    this.uploadCalls += 1;
    this.uploaded = data;
  }

  deleteBuffer(buffer: unknown) {
    assert.equal(buffer, this.buffer);
    this.deleted = true;
  }
}

function pose(kind: MobKind, x: number, z: number, index: number): MobPoseSnapshot {
  return {
    id: `${kind}-${index}`,
    kind,
    x,
    y: 7,
    z,
    yaw: Math.PI * 0.2,
    previousX: x - 0.5,
    previousY: 7,
    previousZ: z - 0.25,
    previousYaw: 0,
    behavior: kind === "zombie" ? "chase" : "wander",
    health: 8,
    maxHealth: kind === "zombie" ? 20 : 10,
    hostileActive: kind === "zombie",
  };
}

const gl = new FakeWebGl();
const renderer = createMobRenderer(gl as unknown as WebGLRenderingContext);
assert.equal(gl.createBufferCalls, 1, "all mobs should share one WebGL buffer");
assert.ok(gl.allocationBytes > 0);

const kinds: MobKind[] = ["pig", "cow", "sheep", "zombie"];
const poses = kinds.map((kind, index) => pose(kind, index * 2 - 3, 8 + index, index));
const stats = renderer.rebuild(poses, 0, 0, 0, 1, 0.5, 2);
const expectedVertexCount = kinds.reduce((total, kind) => total + mobVertexCountForKind(kind), 0);
assert.equal(stats.totalMobCount, 4);
assert.equal(stats.visibleMobCount, 4);
assert.equal(stats.vertexCount, expectedVertexCount);
assert.equal(gl.uploadCalls, 1, "one rebuild should issue one batched geometry upload");
assert.ok(gl.uploaded);

const used = gl.uploaded!.subarray(0, stats.vertexCount * 6);
assert.equal(used.length, stats.vertexCount * 6, "positions and colors should be interleaved as six floats per vertex");
for (let offset = 0; offset < used.length; offset += 6) {
  assert.ok(Number.isFinite(used[offset]) && Number.isFinite(used[offset + 1]) && Number.isFinite(used[offset + 2]));
  assert.ok(used[offset + 3] >= 0 && used[offset + 3] <= 1);
  assert.ok(used[offset + 4] >= 0 && used[offset + 4] <= 1);
  assert.ok(used[offset + 5] >= 0 && used[offset + 5] <= 1);
}

for (const kind of kinds) {
  assert.equal(mobVertexCountForKind(kind) % 36, 0, `${kind} geometry should contain complete boxes`);
  assert.ok(mobVertexCountForKind(kind) >= 6 * 36, `${kind} should have a recognizable multipart silhouette`);
}

const colorSignatures = new Set<string>();
for (let index = 0; index < kinds.length; index += 1) {
  const kindStats = renderer.rebuild([pose(kinds[index], 0, 4, index)], 0, 0, 0, 1, 1, 0);
  const kindData = gl.uploaded!;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let offset = 0; offset < kindStats.vertexCount * 6; offset += 6) {
    red += kindData[offset + 3];
    green += kindData[offset + 4];
    blue += kindData[offset + 5];
  }
  colorSignatures.add(`${red.toFixed(2)},${green.toFixed(2)},${blue.toFixed(2)}`);
}
assert.equal(colorSignatures.size, kinds.length, "each mob kind should have a distinct color palette");

const interpolatedPose = pose("pig", 2, 4, 20);
interpolatedPose.previousX = 0;
interpolatedPose.previousYaw = interpolatedPose.yaw;
renderer.rebuild([interpolatedPose], 0, 0, 0, 1, 0, 0);
const previousFirstX = gl.uploaded![0];
renderer.rebuild([interpolatedPose], 0, 0, 0, 1, 1, 0);
const currentFirstX = gl.uploaded![0];
assert.ok(Math.abs((currentFirstX - previousFirstX) - 2) < 0.0001, "geometry should interpolate snapshot movement");

const farAway = pose("pig", 31, 0, 9);
const behindCamera = pose("zombie", 0, -20, 10);
const nearbyBehindCamera = pose("sheep", 0, -5, 11);
const cullingStats = renderer.rebuild([farAway, behindCamera, nearbyBehindCamera], 0, 0, 0, 1, 1, 3);
assert.equal(cullingStats.totalMobCount, 3);
assert.equal(cullingStats.visibleMobCount, 1, "distance and rear-view culling should retain only the nearby mob");
assert.equal(cullingStats.vertexCount, mobVertexCountForKind("sheep"));
assert.equal(gl.uploadCalls, 8);

const reusedStats = renderer.rebuild([], 0, 0, 0, 1, 0, 0);
assert.equal(reusedStats, stats, "renderer stats should be reused rather than allocated every frame");
assert.equal(reusedStats.vertexCount, 0);
renderer.destroy();
assert.equal(gl.deleted, true);

console.log("lakecraft mob renderer geometry tests: ok");
