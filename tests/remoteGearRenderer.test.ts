import assert from "node:assert/strict";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { createRemoteAvatarMotion, type RemoteAvatarMotion } from "../client/game/avatar.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";
import type { RemotePlayer } from "../client/game/types.ts";
import {
  AVATAR_VERTICES_PER_PLAYER,
  BASE_AVATAR_VERTICES_PER_PLAYER,
  MAX_ARMOR_VERTICES_PER_PLAYER,
  MAX_HELD_ITEM_VERTICES_PER_PLAYER,
  REMOTE_HELD_ITEM_LOGICAL_SIZE,
  REMOTE_HELD_ITEM_MAX_RECTS,
  REMOTE_MESH_INTERVAL_MS,
  createRemotePlayerRenderer,
  remotePlayerBufferCapacity,
  remoteHeldItemRects,
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
assert.equal(heldBlock.stats.avatarVertexCount, BASE_AVATAR_VERTICES_PER_PLAYER + remoteHeldItemVertexCount("sand"));
assert.equal(heldMaterial.stats.avatarVertexCount, BASE_AVATAR_VERTICES_PER_PLAYER + remoteHeldItemVertexCount("coal"));
assert.equal(heldTool.stats.avatarVertexCount, BASE_AVATAR_VERTICES_PER_PLAYER + remoteHeldItemVertexCount("iron_pickaxe"));
assert.ok(remoteHeldItemVertexCount("sand") > remoteHeldItemVertexCount("coal"),
  "dense block texture and loose coal retain distinct canonical silhouettes");
assert.equal(heldBlock.stats.nameplateVertexCount, bare.stats.nameplateVertexCount, "held gear cannot disturb names");

function canonicalMipOccupiedCells(itemId: ItemId): number {
  const occupied = Array.from({ length: 16 }, () => Array<boolean>(16).fill(false));
  for (const run of getItemIconArt(itemId).runs) {
    for (let x = run.x; x < run.x + run.width; x += 1) occupied[run.y][x] = true;
  }
  let cells = 0;
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    if (occupied[y * 2][x * 2] || occupied[y * 2][x * 2 + 1]
      || occupied[y * 2 + 1][x * 2] || occupied[y * 2 + 1][x * 2 + 1]) cells += 1;
  }
  return cells;
}

for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  const canonicalColors = new Set(getItemIconArt(itemId).runs.map((run) => run.color.toLowerCase()));
  const rectangles = remoteHeldItemRects(itemId);
  assert.ok(rectangles.length > 0 && rectangles.length <= REMOTE_HELD_ITEM_MAX_RECTS,
    `${itemId} has a non-empty bounded remote sprite`);
  for (const rectangle of rectangles) {
    assert.ok(rectangle.x >= 0 && rectangle.y >= 0
      && rectangle.x + rectangle.width <= REMOTE_HELD_ITEM_LOGICAL_SIZE
      && rectangle.y + rectangle.height <= REMOTE_HELD_ITEM_LOGICAL_SIZE);
    const color = `#${rectangle.color.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
    assert.ok(canonicalColors.has(color), `${itemId} remote mip uses only exact canonical palette colors`);
  }
  const retainedCells = rectangles.reduce((total, rectangle) => total + rectangle.width * rectangle.height, 0);
  const retainedRatio = retainedCells / canonicalMipOccupiedCells(itemId);
  assert.ok(retainedRatio >= 0.85 || rectangles.length === REMOTE_HELD_ITEM_MAX_RECTS,
    `${itemId} retains at least 85% of its occupied distance mip or consumes the full bounded rectangle budget`);
  if (retainedRatio < 0.85) assert.ok(retainedCells >= REMOTE_HELD_ITEM_MAX_RECTS,
    `${itemId} budget-capped mip still preserves at least one occupied cell per retained rectangle`);
}
assert.equal(MAX_HELD_ITEM_VERTICES_PER_PLAYER, REMOTE_HELD_ITEM_MAX_RECTS * 6);

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
assert.ok(heldToolMinX > 0.18 && heldToolMaxX > 0.6, "held tool is attached at Steve's right hand");
assert.ok(ironToolVertices > 0 && woodenHandleVertices > 0, "pickaxe has a readable iron head and wooden handle");

function heldCentroid(sample: ReturnType<typeof geometry>): readonly [number, number, number] {
  const start = BASE_AVATAR_VERTICES_PER_PLAYER * 6;
  const end = sample.stats.avatarVertexCount * 6;
  const count = (end - start) / 6;
  let x = 0; let y = 0; let z = 0;
  for (let offset = start; offset < end; offset += 6) {
    x += sample.avatar[offset]; y += sample.avatar[offset + 1]; z += sample.avatar[offset + 2];
  }
  return [x / count, y / count, z / count];
}
const idlePickaxeCenter = heldCentroid(heldTool);
const swungPickaxe = geometry({ heldItem: "iron_pickaxe" }, { armActionPhase: 0.5 });
const swungPickaxeCenter = heldCentroid(swungPickaxe);
assert.notDeepEqual(swungPickaxeCenter, idlePickaxeCenter, "canonical sprite follows the animated right-arm pitch");
assert.ok(swungPickaxeCenter[2] > idlePickaxeCenter[2] + 0.1,
  "swinging rotates the held sprite through the same anatomical shoulder joint as the hand");

const idleBow = geometry({ heldItem: "bow" });
const drawnBow = geometry({ heldItem: "bow" }, { bowDrawing: true });
assert.equal(idleBow.stats.avatarVertexCount - BASE_AVATAR_VERTICES_PER_PLAYER, remoteHeldItemVertexCount("bow", false));
assert.equal(drawnBow.stats.avatarVertexCount - BASE_AVATAR_VERTICES_PER_PLAYER, remoteHeldItemVertexCount("bow", true));
assert.notDeepEqual(remoteHeldItemRects("bow", false), remoteHeldItemRects("bow", true),
  "remote draw state swaps to the canonical drawn-bow artwork");

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
assert.equal(fullyIron.stats.avatarVertexCount,
  BASE_AVATAR_VERTICES_PER_PLAYER + MAX_ARMOR_VERTICES_PER_PLAYER + remoteHeldItemVertexCount("iron_sword"));
assert.equal(fullyLeather.stats.avatarVertexCount,
  BASE_AVATAR_VERTICES_PER_PLAYER + MAX_ARMOR_VERTICES_PER_PLAYER + remoteHeldItemVertexCount("wooden_sword"));
assert.ok(fullyIron.stats.avatarVertexCount <= AVATAR_VERTICES_PER_PLAYER);
assert.ok(fullyLeather.stats.avatarVertexCount <= AVATAR_VERTICES_PER_PLAYER);
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
