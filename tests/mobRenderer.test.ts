import assert from "node:assert/strict";
import { MOB_MESH_INTERVAL_MS, createMobRenderer, mobVertexCountForKind } from "../client/game/mobRenderer.ts";
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
    sheared: false,
    fuseProgress: kind === "creeper" ? 0.7 : 0,
    sunBurning: false,
    deathFall: 0,
  };
}

const gl = new FakeWebGl();
const renderer = createMobRenderer(gl as unknown as WebGLRenderingContext);
assert.equal(gl.createBufferCalls, 1, "all mobs should share one WebGL buffer");
assert.ok(gl.allocationBytes > 0);
assert.equal(
  gl.allocationBytes,
  817_920,
  "64 mobs, 24 projectiles, and 32 four-side-labeled primed TNT visuals share one fixed 798.75 KiB allocation",
);
assert.ok(gl.allocationBytes <= 800 * 1024, "the complete 64-mob/projectile/TNT batch stays under 800 KiB");

const kinds: MobKind[] = ["pig", "cow", "sheep", "chicken", "zombie", "skeleton", "creeper", "spider"];
const poses = kinds.map((kind, index) => pose(kind, index * 2 - 3, 8 + index, index));
const stats = renderer.rebuild(poses, 0, 0, 0, 1, 0.5, 2);
const expectedVertexCount = kinds.reduce((total, kind) => total + mobVertexCountForKind(kind), 0);
assert.equal(stats.totalMobCount, 8);
assert.equal(stats.visibleMobCount, 8);
assert.equal(stats.vertexCount, expectedVertexCount);
assert.equal(gl.uploadCalls, 1, "one rebuild should issue one batched geometry upload");
assert.ok(gl.uploaded);

const deathZombie = pose("zombie", 0, 6, 44);
deathZombie.behavior = "idle";
deathZombie.previousX = deathZombie.x;
deathZombie.previousY = deathZombie.y;
deathZombie.previousZ = deathZombie.z;
deathZombie.previousYaw = deathZombie.yaw = 0;
renderer.rebuild([deathZombie], 0, 0, 0, 1, 1, 2.1);
const uprightDeathGeometry = gl.uploaded!.slice(0, mobVertexCountForKind("zombie") * 6);
renderer.rebuild([{ ...deathZombie, health: 0, deathFall: 1 }], 0, 0, 0, 1, 1, 2.2);
const fallenDeathGeometry = gl.uploaded!.slice(0, mobVertexCountForKind("zombie") * 6);
assert.notDeepEqual(fallenDeathGeometry, uprightDeathGeometry, "death progress rotates the retained whole-mob mesh");
const verticalRange = (geometry: Float32Array) => {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let offset = 1; offset < geometry.length; offset += 6) {
    minimum = Math.min(minimum, geometry[offset]);
    maximum = Math.max(maximum, geometry[offset]);
  }
  return maximum - minimum;
};
assert.ok(verticalRange(fallenDeathGeometry) < verticalRange(uprightDeathGeometry), "the completed pose lies flatter on the ground");
assert.equal(gl.createBufferCalls, 1, "death animation reuses the original fixed GPU buffer");

renderer.rebuild([deathZombie], 0, 0, 0, 1, 1, 3);
const ordinarySunGeometry = gl.uploaded!.slice(0, mobVertexCountForKind("zombie") * 6);
renderer.rebuild([{ ...deathZombie, sunBurning: true }], 0, 0, 0, 1, 1, 3.1);
const burningSunGeometry = gl.uploaded!.slice(0, mobVertexCountForKind("zombie") * 6);
assert.notDeepEqual(burningSunGeometry, ordinarySunGeometry, "direct-sky burning receives retained warm visual feedback");

const woollySheep = pose("sheep", 0, 8, 50);
renderer.rebuild([woollySheep], 0, 0, 0, 1, 1, 3);
const woollyGeometry = gl.uploaded!.slice(0, mobVertexCountForKind("sheep") * 6);
renderer.rebuild([{ ...woollySheep, sheared: true }], 0, 0, 0, 1, 1, 3);
const shearedGeometry = gl.uploaded!.slice(0, mobVertexCountForKind("sheep") * 6);
assert.notDeepEqual(shearedGeometry, woollyGeometry, "authority shearing must visibly narrow and recolor the retained sheep mesh");
assert.equal(shearedGeometry.length, woollyGeometry.length, "sheared sheep keep the fixed batched vertex budget");

const hurtSheep = pose("sheep", 0, 6, 60);
hurtSheep.behavior = "idle";
hurtSheep.previousX = hurtSheep.x;
hurtSheep.previousY = hurtSheep.y;
hurtSheep.previousZ = hurtSheep.z;
hurtSheep.previousYaw = hurtSheep.yaw;
renderer.rebuild([hurtSheep], 0, 0, 0, 1, 1, 10);
const calmHurtTestGeometry = gl.uploaded!.slice(0, mobVertexCountForKind("sheep") * 6);
hurtSheep.health -= 1;
renderer.rebuild([hurtSheep], 0, 0, 0, 1, 1, 10);
const freshHurtGeometry = gl.uploaded!.slice(0, mobVertexCountForKind("sheep") * 6);
assert.equal(freshHurtGeometry[0], calmHurtTestGeometry[0], "hurt feedback cannot move retained mob geometry");
assert.ok(freshHurtGeometry[3] > calmHurtTestGeometry[3], "damage flashes the mob toward red");
assert.ok(freshHurtGeometry[4] < calmHurtTestGeometry[4], "damage removes green from the hurt palette");
assert.ok(freshHurtGeometry[5] < calmHurtTestGeometry[5], "damage removes blue from the hurt palette");
renderer.rebuild([hurtSheep], 0, 0, 0, 1, 1, 10.49);
assert.deepEqual(
  gl.uploaded!.slice(0, mobVertexCountForKind("sheep") * 6),
  freshHurtGeometry,
  "equal health keeps the original flash deadline without extending or changing its tint",
);
renderer.rebuild([hurtSheep], 0, 0, 0, 1, 1, 10.5);
assert.deepEqual(
  gl.uploaded!.slice(0, mobVertexCountForKind("sheep") * 6),
  calmHurtTestGeometry,
  "the retained hurt flash expires exactly after half a second",
);

hurtSheep.health -= 1;
renderer.rebuild([hurtSheep], 0, 0, 0, 1, 1, 20);
assert.ok(gl.uploaded![3] > calmHurtTestGeometry[3], "a later health decrease starts a fresh flash");
hurtSheep.health += 1;
renderer.rebuild([hurtSheep], 0, 0, 0, 1, 1, 20.1);
assert.deepEqual(
  gl.uploaded!.slice(0, mobVertexCountForKind("sheep") * 6),
  calmHurtTestGeometry,
  "healing or respawn clears an active hurt flash",
);

const initiallyDamagedSheep = { ...hurtSheep, id: "sheep-initially-damaged", health: 1 };
renderer.rebuild([initiallyDamagedSheep], 0, 0, 0, 1, 1, 30);
assert.deepEqual(
  gl.uploaded!.slice(0, mobVertexCountForKind("sheep") * 6),
  calmHurtTestGeometry,
  "the first observation initializes health silently even when a mob is already hurt",
);

const tintIsolationSheep = { ...hurtSheep, id: "sheep-tint-isolation", health: 8 };
renderer.rebuild([tintIsolationSheep], 0, 0, 0, 1, 1, 40);
tintIsolationSheep.health = 7;
const calmCow = pose("cow", 2, 6, 61);
calmCow.behavior = "idle";
calmCow.previousX = calmCow.x;
calmCow.previousY = calmCow.y;
calmCow.previousZ = calmCow.z;
calmCow.previousYaw = calmCow.yaw;
renderer.rebuild([tintIsolationSheep, calmCow], 0, 0, 0, 1, 1, 40);
const cowFloatOffset = mobVertexCountForKind("sheep") * 6;
const cowAfterHurt = gl.uploaded!.slice(cowFloatOffset, cowFloatOffset + mobVertexCountForKind("cow") * 6);
renderer.rebuild([calmCow], 0, 0, 0, 1, 1, 40);
assert.deepEqual(
  cowAfterHurt,
  gl.uploaded!.slice(0, mobVertexCountForKind("cow") * 6),
  "hurt tint is reset before the next mob in the shared batch",
);

const futureFuseNow = Date.now();
renderer.setPrimedTntFuses([{
  x: 0,
  y: 7,
  z: 5,
  ignitedAt: futureFuseNow + 10_000,
  dueAt: futureFuseNow + 14_000,
}], futureFuseNow);
renderer.rebuild([tintIsolationSheep], 0, 0, 0, 1, 1, 40.1);
const hurtWithTntStats = renderer.rebuild(
  [{ ...tintIsolationSheep, health: 6 }],
  0, 0, 0, 1, 1, 40.2,
);
const primedFloatOffset = (hurtWithTntStats.vertexCount - hurtWithTntStats.primedTntVertexCount) * 6;
const tntAfterHurt = gl.uploaded!.slice(primedFloatOffset, hurtWithTntStats.vertexCount * 6);
const tntOnlyStats = renderer.rebuild([], 0, 0, 0, 1, 1, 40.2);
assert.deepEqual(
  tntAfterHurt,
  gl.uploaded!.slice(0, tntOnlyStats.vertexCount * 6),
  "mob hurt tint cannot bleed into primed TNT geometry sharing the writer",
);
renderer.setPrimedTntFuses([]);

const used = gl.uploaded!.subarray(0, stats.vertexCount * 6);
assert.equal(used.length, stats.vertexCount * 6, "positions and colors should be interleaved as six floats per vertex");
for (let offset = 0; offset < used.length; offset += 6) {
  assert.ok(Number.isFinite(used[offset]) && Number.isFinite(used[offset + 1]) && Number.isFinite(used[offset + 2]));
  assert.ok(used[offset + 3] >= 0 && used[offset + 3] <= 1);
  assert.ok(used[offset + 4] >= 0 && used[offset + 4] <= 1);
  assert.ok(used[offset + 5] >= 0 && used[offset + 5] <= 1);
}

for (const kind of kinds) {
  assert.equal(mobVertexCountForKind(kind) % 6, 0, `${kind} geometry should contain complete triangles`);
  assert.ok(mobVertexCountForKind(kind) >= 6 * 36, `${kind} should have a recognizable multipart silhouette`);
  assert.ok(mobVertexCountForKind(kind) <= 12 * 36, `${kind} must stay inside the retained twelve-box allowance`);
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

const baseBoxes: Readonly<Partial<Record<MobKind, number>>> = {
  pig: 9,
  cow: 9,
  sheep: 7,
  chicken: 9,
  zombie: 6,
  skeleton: 9,
  creeper: 6,
};
const detailQuads: Readonly<Partial<Record<MobKind, number>>> = {
  pig: 4,
  cow: 5,
  sheep: 5,
  chicken: 4,
  zombie: 6,
  skeleton: 3,
  creeper: 6,
};
for (const kind of kinds.slice(0, -1)) {
  const frontPose = pose(kind, 0, 4, 200);
  frontPose.previousX = frontPose.x;
  frontPose.previousY = frontPose.y;
  frontPose.previousZ = frontPose.z;
  frontPose.previousYaw = frontPose.yaw = 0;
  const detailStats = renderer.rebuild([frontPose], 0, 0, 0, 1, 1, 0);
  const boxCount = baseBoxes[kind]!;
  const quadCount = detailQuads[kind]!;
  assert.equal(detailStats.vertexCount, boxCount * 36 + quadCount * 6, `${kind} detail uses six-vertex quads`);
  const detailGeometry = gl.uploaded!.slice(boxCount * 36 * 6, detailStats.vertexCount * 6);
  for (let quad = 0; quad < quadCount; quad += 1) {
    const start = quad * 6 * 6;
    const z = detailGeometry[start + 2];
    for (let vertex = 0; vertex < 6; vertex += 1) {
      assert.equal(detailGeometry[start + vertex * 6 + 2], z, `${kind} patch ${quad} is a flat offset quad`);
    }
  }
  const leftEye = Array.from({ length: 6 }, (_, vertex) => detailGeometry[vertex * 6]);
  const rightEye = Array.from({ length: 6 }, (_, vertex) => detailGeometry[(6 + vertex) * 6]);
  assert.ok(Math.max(...leftEye) < Math.min(...rightEye), `${kind} keeps two separated front-facing eye pixels`);
}

const chicken = pose("chicken", 0, 4, 0);
chicken.previousX = chicken.x;
chicken.previousZ = chicken.z;
chicken.previousYaw = chicken.yaw = 0;
const stillChicken = renderer.rebuild([chicken], 0, 0, 0, 1, 1, 0);
const stillChickenGeometry = gl.uploaded!.slice(0, stillChicken.vertexCount * 6);
let whiteChickenVertices = 0;
let yellowChickenVertices = 0;
let redChickenVertices = 0;
for (let offset = 0; offset < stillChickenGeometry.length; offset += 6) {
  const red = stillChickenGeometry[offset + 3];
  const green = stillChickenGeometry[offset + 4];
  const blue = stillChickenGeometry[offset + 5];
  if (red > 0.65 && green > 0.65 && blue > 0.6) whiteChickenVertices += 1;
  if (red > 0.55 && green > 0.3 && blue < 0.1) yellowChickenVertices += 1;
  if (red > 0.45 && green < 0.12 && blue < 0.1) redChickenVertices += 1;
}
assert.equal(stillChicken.vertexCount, 9 * 36 + 4 * 6, "a chicken adds four flat face/feather pixels to nine bounded boxes");
assert.ok(whiteChickenVertices >= 72, "the chicken has a recognizable white body and head");
assert.ok(yellowChickenVertices >= 36, "the chicken has a visible yellow beak and legs");
assert.ok(redChickenVertices >= 12, "the chicken has a visible red wattle below its beak");
renderer.rebuild([chicken], 0, 0, 0, 1, 1, 0.1);
const walkingChickenGeometry = gl.uploaded!.slice(0, stillChicken.vertexCount * 6);
assert.notDeepEqual(
  walkingChickenGeometry.subarray(6 * 36 * 6, 8 * 36 * 6),
  stillChickenGeometry.subarray(6 * 36 * 6, 8 * 36 * 6),
  "both wing boxes animate inside the same mob batch",
);

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

const cadenceGl = new FakeWebGl();
const cadenceRenderer = createMobRenderer(cadenceGl as unknown as WebGLRenderingContext);
const cadenceSpider = pose("spider", 0, 4, 90);
const cadenceStats = cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0, [], 0);
const firstCadenceGeometry = cadenceGl.uploaded!.slice();
cadenceSpider.x = 2;
assert.equal(cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.016, [], 16), cadenceStats);
cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.032, [], 32);
assert.equal(cadenceGl.uploadCalls, 1, "16 and 32ms frames reuse the retained 30Hz mob batch");
assert.deepEqual(cadenceGl.uploaded, firstCadenceGeometry, "a skipped mesh frame cannot mutate retained GPU input");
cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.034, [], 34);
cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.05, [], 50);
cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.068, [], 68);
assert.equal(cadenceGl.uploadCalls, 3, "0, 34, and 68ms are the only due uploads");
cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.01, [], 10);
assert.equal(cadenceGl.uploadCalls, 4, "a backward frame clock rebuilds instead of stalling");
cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.02, [], 20);
cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.044, [], 44);
assert.equal(cadenceGl.uploadCalls, 5, "the cadence recovers from the rolled-back clock");
cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.05);
cadenceRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, 0.06, [], Number.NaN);
assert.equal(cadenceGl.uploadCalls, 7, "omitted and nonfinite clocks preserve immediate deterministic rebuilds");
cadenceRenderer.destroy();

const stressGl = new FakeWebGl();
const stressRenderer = createMobRenderer(stressGl as unknown as WebGLRenderingContext);
for (let frame = 0; frame < 600; frame += 1) {
  stressRenderer.rebuild([cadenceSpider], 0, 0, 0, 1, 1, frame / 60, [], frame * 1_000 / 60);
}
assert.ok(stressGl.uploadCalls >= 299 && stressGl.uploadCalls <= 301,
  `ten simulated seconds stay at 30Hz (received ${stressGl.uploadCalls} uploads)`);
assert.equal(stressGl.createBufferCalls, 1, "cadence limiting never reallocates the retained mob buffer");
assert.equal(MOB_MESH_INTERVAL_MS, 1_000 / 30);
stressRenderer.destroy();

console.log("lakecraft mob renderer geometry tests: ok");
