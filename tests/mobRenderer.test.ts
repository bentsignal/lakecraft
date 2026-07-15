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
    behavior: kind === "zombie" || kind === "skeleton" || kind === "creeper" || kind === "spider" ? "chase" : "wander",
    health: 8,
    maxHealth: kind === "zombie" || kind === "skeleton" || kind === "creeper" || kind === "spider" ? 20 : 10,
    hostileActive: kind === "zombie" || kind === "skeleton" || kind === "creeper" || kind === "spider",
    fuseProgress: kind === "creeper" ? 0.7 : 0,
  };
}

const gl = new FakeWebGl();
const renderer = createMobRenderer(gl as unknown as WebGLRenderingContext);
assert.equal(gl.createBufferCalls, 1, "all mobs should share one WebGL buffer");
assert.ok(gl.allocationBytes > 0);
assert.ok(gl.allocationBytes <= 800 * 1024, "the complete 64-mob/projectile/TNT batch stays under 800 KiB");

const kinds: MobKind[] = ["pig", "cow", "sheep", "zombie", "skeleton", "creeper", "spider"];
const poses = kinds.map((kind, index) => pose(kind, index * 2 - 3, 8 + index, index));
const stats = renderer.rebuild(poses, 0, 0, 0, 1, 0.5, 2);
const expectedVertexCount = kinds.reduce((total, kind) => total + mobVertexCountForKind(kind), 0);
assert.equal(stats.totalMobCount, 7);
assert.equal(stats.visibleMobCount, 7);
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

const spider = pose("spider", 0, 4, 0);
spider.previousX = spider.x;
spider.previousZ = spider.z;
spider.previousYaw = spider.yaw = 0;
const stillSpider = renderer.rebuild([spider], 0, 0, 0, 1, 1, 0);
const stillSpiderGeometry = gl.uploaded!.slice(0, stillSpider.vertexCount * 6);
let minimumX = Infinity;
let maximumX = -Infinity;
let minimumY = Infinity;
let maximumY = -Infinity;
let brightRedVertices = 0;
for (let offset = 0; offset < stillSpiderGeometry.length; offset += 6) {
  minimumX = Math.min(minimumX, stillSpiderGeometry[offset]);
  maximumX = Math.max(maximumX, stillSpiderGeometry[offset]);
  minimumY = Math.min(minimumY, stillSpiderGeometry[offset + 1]);
  maximumY = Math.max(maximumY, stillSpiderGeometry[offset + 1]);
  if (stillSpiderGeometry[offset + 3] > 0.6 && stillSpiderGeometry[offset + 4] < 0.1) brightRedVertices += 1;
}
assert.equal(stillSpider.vertexCount, 12 * 36, "a spider is exactly two body boxes, two eyes, and eight legs");
assert.ok(maximumX - minimumX > 2, "spider legs create a wide silhouette");
assert.ok(maximumY - minimumY < 0.7, "the spider stays recognizably low to the ground");
assert.ok(brightRedVertices >= 12, "the forward face includes two visible bright-red eye blocks");
renderer.rebuild([spider], 0, 0, 0, 1, 1, 0.1);
const walkingSpiderGeometry = gl.uploaded!.slice(0, stillSpider.vertexCount * 6);
assert.notDeepEqual(
  walkingSpiderGeometry.subarray(4 * 36 * 6),
  stillSpiderGeometry.subarray(4 * 36 * 6),
  "all eight leg boxes animate inside the same mob batch",
);

const calmCreeper = pose("creeper", 0, 4, 30);
calmCreeper.fuseProgress = 0;
renderer.rebuild([calmCreeper], 0, 0, 0, 1, 1, 0);
const calmColor = gl.uploaded![3];
calmCreeper.fuseProgress = 1;
renderer.rebuild([calmCreeper], 0, 0, 0, 1, 1, 0);
assert.ok(gl.uploaded![3] > calmColor, "a completed creeper fuse visibly flashes toward white");

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
const uploadsBeforeCulling = gl.uploadCalls;
const cullingStats = renderer.rebuild([farAway, behindCamera, nearbyBehindCamera], 0, 0, 0, 1, 1, 3);
assert.equal(cullingStats.totalMobCount, 3);
assert.equal(cullingStats.visibleMobCount, 1, "distance and rear-view culling should retain only the nearby mob");
assert.equal(cullingStats.vertexCount, mobVertexCountForKind("sheep"));
assert.equal(gl.uploadCalls, uploadsBeforeCulling + 1, "the culled mob set still uses one batch upload");

const projectileStats = renderer.rebuild(
  [],
  0,
  0,
  0,
  1,
  1,
  3,
  Array.from({ length: 24 }, (_, id) => ({
    id,
    x: id % 4,
    y: 2,
    z: 4 + Math.floor(id / 4),
    previousX: id % 4,
    previousY: 2,
    previousZ: 4 + Math.floor(id / 4),
    yaw: 0,
    pitch: 0,
  })),
);
assert.equal(projectileStats.projectileCount, 24);
assert.equal(projectileStats.projectileVertexCount, 24 * 36);
assert.equal(projectileStats.vertexCount, 24 * 36, "the fixed arrow pool must fit in the shared batch allocation");

const reusedStats = renderer.rebuild([], 0, 0, 0, 1, 0, 0);
assert.equal(reusedStats, stats, "renderer stats should be reused rather than allocated every frame");
assert.equal(reusedStats.vertexCount, 0);
renderer.destroy();
assert.equal(gl.deleted, true);

console.log("lakecraft mob renderer geometry tests: ok");
