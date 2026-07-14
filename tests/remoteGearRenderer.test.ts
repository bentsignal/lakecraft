import assert from "node:assert/strict";
import { createRemoteAvatarMotion, type RemoteAvatarMotion } from "../client/game/avatar.ts";
import type { RemotePlayer } from "../client/game/types.ts";
import {
  AVATAR_VERTICES_PER_PLAYER,
  BASE_AVATAR_VERTICES_PER_PLAYER,
  MAX_ARMOR_VERTICES_PER_PLAYER,
  MAX_HELD_ITEM_VERTICES_PER_PLAYER,
  REMOTE_MESH_INTERVAL_MS,
  createRemotePlayerRenderer,
  remotePlayerBufferCapacity,
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

function geometry(overrides: Partial<RemotePlayer> = {}) {
  const state = createRemoteAvatarMotion({ ...basePlayer, ...overrides }, 0);
  const states = new Map<string, RemoteAvatarMotion>([[state.id, state]]);
  const capacity = remotePlayerBufferCapacity(1);
  const avatar = new Float32Array(capacity.avatarFloats);
  const names = new Float32Array(capacity.nameplateFloats);
  const stats: RemoteGeometryStats = { avatarVertexCount: 0, nameplateVertexCount: 0, visiblePlayerCount: 0 };
  writeRemotePlayerGeometry(states, [0, 2, -4], avatar, names, stats);
  return { avatar, names, state, stats, capacity };
}

const bare = geometry();
assert.equal(bare.stats.avatarVertexCount, BASE_AVATAR_VERTICES_PER_PLAYER);
assert.equal(bare.stats.visiblePlayerCount, 1);
assert.ok(bare.stats.nameplateVertexCount > 0, "nameplate geometry remains present on ungeared Steve");
assert.ok(BASE_AVATAR_VERTICES_PER_PLAYER > 500, "the recognizable detailed Steve base is preserved");

const heldBlock = geometry({ heldItem: "sand" });
const heldMaterial = geometry({ heldItem: "coal" });
const heldTool = geometry({ heldItem: "iron_pickaxe" });
assert.equal(heldBlock.stats.avatarVertexCount, BASE_AVATAR_VERTICES_PER_PLAYER + 36);
assert.equal(heldMaterial.stats.avatarVertexCount, BASE_AVATAR_VERTICES_PER_PLAYER + 36);
assert.equal(heldTool.stats.avatarVertexCount, BASE_AVATAR_VERTICES_PER_PLAYER + MAX_HELD_ITEM_VERTICES_PER_PLAYER);
assert.equal(heldBlock.stats.nameplateVertexCount, bare.stats.nameplateVertexCount, "held gear cannot disturb names");

const heldToolStart = BASE_AVATAR_VERTICES_PER_PLAYER * 6;
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
assert.ok(heldToolMinX > 0.25 && heldToolMaxX > 0.6, "held tool is attached at Steve's right hand");
assert.ok(ironToolVertices > 0 && woodenHandleVertices > 0, "pickaxe has a readable iron head and wooden handle");

const headOnly = geometry({ armorHead: "iron_helmet" });
const chestOnly = geometry({ armorChest: "iron_chestplate" });
const legsOnly = geometry({ armorLegs: "iron_leggings" });
const feetOnly = geometry({ armorFeet: "iron_boots" });
assert.equal(headOnly.stats.avatarVertexCount - BASE_AVATAR_VERTICES_PER_PLAYER, 3 * 36);
assert.equal(chestOnly.stats.avatarVertexCount - BASE_AVATAR_VERTICES_PER_PLAYER, 3 * 36);
assert.equal(legsOnly.stats.avatarVertexCount - BASE_AVATAR_VERTICES_PER_PLAYER, 2 * 36);
assert.equal(feetOnly.stats.avatarVertexCount - BASE_AVATAR_VERTICES_PER_PLAYER, 2 * 36);
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
assert.equal(fullyIron.stats.avatarVertexCount, AVATAR_VERTICES_PER_PLAYER);
assert.equal(fullyLeather.stats.avatarVertexCount, AVATAR_VERTICES_PER_PLAYER);
assert.equal(fullyIron.capacity.avatarFloats, AVATAR_VERTICES_PER_PLAYER * 6);

function gearBrightness(sample: ReturnType<typeof geometry>): number {
  let total = 0;
  let count = 0;
  for (let offset = BASE_AVATAR_VERTICES_PER_PLAYER * 6; offset < sample.stats.avatarVertexCount * 6; offset += 6) {
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
