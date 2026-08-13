import assert from "node:assert/strict";
import { createRemoteAvatarMotion, resolveRemoteAvatarRigPose, type RemoteAvatarMotion } from "../client/game/avatar.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";
import type { RemotePlayer } from "../client/game/types.ts";
import { BOX_VERTEX_COORDINATES } from "../client/game/generated/renderGeometry.ts";
import { writePlayerRigPartMatrix, type PlayerRigPart } from "../client/game/playerRig.ts";
import {
  AVATAR_VERTICES_PER_PLAYER,
  BASE_AVATAR_VERTICES_PER_PLAYER,
  MAX_ARMOR_VERTICES_PER_PLAYER,
  MAX_HELD_ITEM_VERTICES_PER_PLAYER,
  REMOTE_MESH_INTERVAL_MS,
  createRemotePlayerRenderer,
  remotePlayerBufferCapacity,
  remoteHeldItemGeometry,
  remoteHeldItemVertexCount,
  writeRemotePlayerGeometry,
  type RemoteGeometryStats,
} from "../client/game/remotePlayerRenderer.ts";

const basePlayer: RemotePlayer = {
  id: "gear-test",
  name: "Gear Test",
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
};

function geometry(overrides: Partial<RemotePlayer> = {}, motionOverrides: Partial<RemoteAvatarMotion> = {}) {
  const state = createRemoteAvatarMotion({ ...basePlayer, ...overrides }, 0);
  Object.assign(state, motionOverrides);
  const states = new Map<string, RemoteAvatarMotion>([[state.id, state]]);
  const capacity = remotePlayerBufferCapacity(1);
  const avatar = new Float32Array(capacity.avatarFloats);
  const names = new Float32Array(capacity.nameplateFloats);
  const stats: RemoteGeometryStats = { avatarVertexCount: 0, skinVertexCount: 0, nameplateVertexCount: 0, visiblePlayerCount: 0 };
  writeRemotePlayerGeometry(states, [0, 2, -4], avatar, names, stats);
  return { avatar, names, state, stats, capacity };
}

const bare = geometry();
assert.equal(bare.stats.avatarVertexCount, 0);
assert.equal(bare.stats.skinVertexCount, BASE_AVATAR_VERTICES_PER_PLAYER);
assert.equal(bare.stats.visiblePlayerCount, 1);
assert.ok(bare.stats.nameplateVertexCount > 0, "nameplate geometry remains present on ungeared Steve");
assert.ok(BASE_AVATAR_VERTICES_PER_PLAYER > 400, "the complete canonical base and overlay skin mesh is preserved");

const heldBlock = geometry({ heldItem: "sand" });
const heldMaterial = geometry({ heldItem: "coal" });
const heldTool = geometry({ heldItem: "iron_pickaxe" });
const hurtTool = geometry({ heldItem: "iron_pickaxe" }, { hurtFlash: true });
assert.equal(heldBlock.stats.avatarVertexCount, remoteHeldItemVertexCount("sand"));
assert.equal(heldMaterial.stats.avatarVertexCount, remoteHeldItemVertexCount("coal"));
assert.equal(heldTool.stats.avatarVertexCount, remoteHeldItemVertexCount("iron_pickaxe"));
assert.ok(remoteHeldItemVertexCount("sand") > remoteHeldItemVertexCount("coal"),
  "remote blocks retain every authored 16x16 face texel from the same local F5 geometry path");
assert.ok(remoteHeldItemVertexCount("sand") > 36,
  "remote held blocks retain a bounded authored-atlas texture mosaic instead of one flat color per face");
assert.ok(hurtTool.avatar[3] > heldTool.avatar[3] && hurtTool.avatar[4] < heldTool.avatar[4],
  "remote held gear flashes red with the damaged player instead of visually detaching");
const sandColors = new Set<string>();
for (let offset = 0; offset < remoteHeldItemGeometry("sand").length; offset += 6) {
  sandColors.add(Array.from(remoteHeldItemGeometry("sand").slice(offset + 3, offset + 6)).join(":"));
}
assert.ok(sandColors.size > 6, "held block faces preserve visible per-cell texture variation");
assert.equal(heldBlock.stats.nameplateVertexCount, bare.stats.nameplateVertexCount, "held gear cannot disturb names");

for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  const canonical = remoteHeldItemGeometry(itemId);
  assert.ok(canonical.length > 0, `${itemId} has non-empty canonical third-person geometry`);
  assert.equal(canonical.length / 6, remoteHeldItemVertexCount(itemId));
  assert.ok(remoteHeldItemVertexCount(itemId) <= MAX_HELD_ITEM_VERTICES_PER_PLAYER);
}

const heldToolStart = 0;
let heldToolMinX = Infinity;
let heldToolMaxX = -Infinity;
let ironToolVertices = 0;
let woodenHandleVertices = 0;
for (let offset = heldToolStart; offset < heldTool.stats.avatarVertexCount * 6; offset += 6) {
  heldToolMinX = Math.min(heldToolMinX, heldTool.avatar[offset]);
  heldToolMaxX = Math.max(heldToolMaxX, heldTool.avatar[offset]);
  const red = heldTool.avatar[offset + 3];
  const green = heldTool.avatar[offset + 4];
  if (red > 0.52 && green > 0.52) ironToolVertices += 1;
  if (red > green * 1.3) woodenHandleVertices += 1;
}
assert.ok(heldToolMinX > 0.25 && heldToolMaxX < 0.6, "held tool is attached at the canonical right hand");
assert.ok(ironToolVertices > 0 && woodenHandleVertices > 0, "pickaxe has a readable iron head and wooden handle");
const pickaxeGeometry = remoteHeldItemGeometry("iron_pickaxe");
let minDepth = Infinity; let maxDepth = -Infinity;
for (let offset = 2; offset < pickaxeGeometry.length; offset += 6) {
  minDepth = Math.min(minDepth, pickaxeGeometry[offset]);
  maxDepth = Math.max(maxDepth, pickaxeGeometry[offset]);
}
assert.ok(maxDepth - minDepth > 0.02, "remote pickaxe keeps the canonical extruded front, back, and edge faces");

function heldCentroid(sample: ReturnType<typeof geometry>): readonly [number, number, number] {
  const start = 0;
  const end = sample.stats.avatarVertexCount * 6;
  const count = (end - start) / 6;
  let x = 0; let y = 0; let z = 0;
  for (let offset = start; offset < end; offset += 6) {
    x += sample.avatar[offset]; y += sample.avatar[offset + 1]; z += sample.avatar[offset + 2];
  }
  return [x / count, y / count, z / count];
}
const idlePickaxeCenter = heldCentroid(heldTool);
const swungPickaxe = geometry({ heldItem: "iron_pickaxe" }, { armActionProgress: 0.5 });
const swungPickaxeCenter = heldCentroid(swungPickaxe);
assert.notDeepEqual(swungPickaxeCenter, idlePickaxeCenter, "canonical sprite follows the animated right-arm pitch");
assert.ok(Math.abs(swungPickaxeCenter[2] - idlePickaxeCenter[2]) > 0.05,
  "swinging rotates the held sprite through the same anatomical shoulder joint as the hand");

function canonicalWorldPoint(
  state: RemoteAvatarMotion,
  part: PlayerRigPart,
  remap: boolean,
  local: readonly [number, number, number],
): readonly [number, number, number] {
  const matrix = new Float32Array(16);
  writePlayerRigPartMatrix(matrix, part, resolveRemoteAvatarRigPose(state), "wide", remap, new Float32Array(16));
  const x = matrix[0] * local[0] + matrix[4] * local[1] + matrix[8] * local[2] + matrix[12];
  const y = matrix[1] * local[0] + matrix[5] * local[1] + matrix[9] * local[2] + matrix[13];
  const z = matrix[2] * local[0] + matrix[6] * local[1] + matrix[10] * local[2] + matrix[14];
  const angle = Math.PI - state.bodyYaw;
  return [
    state.rendered.x + Math.cos(angle) * x + Math.sin(angle) * z,
    state.rendered.y + y,
    state.rendered.z - Math.sin(angle) * x + Math.cos(angle) * z,
  ];
}

function assertPointClose(actual: ArrayLike<number>, expected: readonly number[], message: string): void {
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-5, `${message}, axis ${axis}`);
  }
}

const actionCrouchPickaxe = geometry(
  { heldItem: "iron_pickaxe" },
  { armActionProgress: 0.5, crouching: true },
);
const firstPickaxePoint = remoteHeldItemGeometry("iron_pickaxe");
const expectedHeldPoint = canonicalWorldPoint(actionCrouchPickaxe.state, "rightArm", true, [
  firstPickaxePoint[0], firstPickaxePoint[1], firstPickaxePoint[2],
]);
assertPointClose(actionCrouchPickaxe.avatar, expectedHeldPoint,
  "held item uses the exact canonical action+crouch right-arm matrix");

const idleBow = geometry({ heldItem: "bow" });
const drawnBow = geometry({ heldItem: "bow" }, { bowDrawing: true });
assert.equal(idleBow.stats.avatarVertexCount, remoteHeldItemVertexCount("bow", false));
assert.equal(drawnBow.stats.avatarVertexCount, remoteHeldItemVertexCount("bow", true));
assert.notDeepEqual(remoteHeldItemGeometry("bow", false), remoteHeldItemGeometry("bow", true),
  "remote draw state swaps to the canonical drawn-bow artwork");

const headOnly = geometry({ armorHead: "iron_helmet" });
const chestOnly = geometry({ armorChest: "iron_chestplate" });
const legsOnly = geometry({ armorLegs: "iron_leggings" });
const feetOnly = geometry({ armorFeet: "iron_boots" });
assert.equal(headOnly.stats.avatarVertexCount, 3 * 36);
assert.equal(chestOnly.stats.avatarVertexCount, 3 * 36);
assert.equal(legsOnly.stats.avatarVertexCount, 2 * 36);
assert.equal(feetOnly.stats.avatarVertexCount, 2 * 36);
const crouchedActionChest = geometry(
  { armorChest: "iron_chestplate" },
  { armActionProgress: 0.5, crouching: true },
);
const first = BOX_VERTEX_COORDINATES;
const expectedArmArmorPoint = canonicalWorldPoint(crouchedActionChest.state, "rightArm", false, [
  -0.52 + first[0] * 0.29,
  1.20 + first[1] * 0.32,
  -0.15 + first[2] * 0.30,
]);
assertPointClose(crouchedActionChest.avatar.subarray(36 * 6), expectedArmArmorPoint,
  "arm armor uses the exact canonical action+crouch right-arm matrix");
assert.equal(
  3 * 36 + 3 * 36 + 2 * 36 + 2 * 36,
  MAX_ARMOR_VERTICES_PER_PLAYER,
);

const fullyIron = geometry({
  heldItem: "iron_sword",
  armorHead: "iron_helmet",
  armorChest: "iron_chestplate",
  armorLegs: "iron_leggings",
  armorFeet: "iron_boots",
});
const fullyLeather = geometry({
  heldItem: "wooden_sword",
  armorHead: "leather_helmet",
  armorChest: "leather_chestplate",
  armorLegs: "leather_leggings",
  armorFeet: "leather_boots",
});
assert.equal(fullyIron.stats.avatarVertexCount,
  MAX_ARMOR_VERTICES_PER_PLAYER + remoteHeldItemVertexCount("iron_sword"));
assert.equal(fullyLeather.stats.avatarVertexCount,
  MAX_ARMOR_VERTICES_PER_PLAYER + remoteHeldItemVertexCount("wooden_sword"));
assert.ok(fullyIron.stats.avatarVertexCount <= AVATAR_VERTICES_PER_PLAYER - BASE_AVATAR_VERTICES_PER_PLAYER);
assert.ok(fullyLeather.stats.avatarVertexCount <= AVATAR_VERTICES_PER_PLAYER - BASE_AVATAR_VERTICES_PER_PLAYER);
assert.equal(fullyIron.capacity.avatarFloats, (AVATAR_VERTICES_PER_PLAYER - BASE_AVATAR_VERTICES_PER_PLAYER) * 6);

function gearBrightness(sample: ReturnType<typeof geometry>): number {
  let total = 0;
  let count = 0;
  for (let offset = 0; offset < sample.stats.avatarVertexCount * 6; offset += 6) {
    total += sample.avatar[offset + 3] + sample.avatar[offset + 4] + sample.avatar[offset + 5];
    count += 3;
  }
  return total / count;
}
assert.ok(gearBrightness(fullyIron) > gearBrightness(fullyLeather), "iron and leather overlays remain visually distinct");

// Stable geometry size must reuse the exact same upload views; all equipment
// remains in one preallocated avatar buffer and one bufferSubData call/update.
type Upload = { buffer: WebGLBuffer | null; data: Float32Array };
const uploads: Upload[] = [];
let boundBuffer: WebGLBuffer | null = null;
let nextBuffer = 0;
const fakeGl = {
  ARRAY_BUFFER: 0x8892,
  DYNAMIC_DRAW: 0x88e8,
  createBuffer: () => ({ id: ++nextBuffer }) as unknown as WebGLBuffer,
  bindBuffer: (_target: number, buffer: WebGLBuffer | null) => { boundBuffer = buffer; },
  bufferData: () => undefined,
  bufferSubData: (_target: number, _offset: number, data: Float32Array) => uploads.push({ buffer: boundBuffer, data }),
  deleteBuffer: () => undefined,
} as unknown as WebGLRenderingContext;
const renderer = createRemotePlayerRenderer(fakeGl);
const gearedStates = new Map([[fullyIron.state.id, fullyIron.state]]);
assert.equal(renderer.update(gearedStates, 0, 0.016, [0, 2, -4]).updated, true);
assert.equal(uploads.length, 2, "one avatar upload and one nameplate upload serve the whole remote batch");
assert.equal(uploads[0].buffer, renderer.avatarBuffer);
assert.equal(uploads[1].buffer, renderer.nameplateBuffer);
assert.equal(renderer.update(gearedStates, REMOTE_MESH_INTERVAL_MS + 1, 0.016, [0, 2, -4]).updated, true);
assert.equal(uploads.length, 4);
assert.equal(uploads[0].data, uploads[2].data, "steady avatar updates reuse the same typed-array view");
assert.equal(uploads[1].data, uploads[3].data, "steady nameplate updates reuse the same typed-array view");
renderer.destroy();

console.log("lakecraft remote gear renderer tests: ok");
