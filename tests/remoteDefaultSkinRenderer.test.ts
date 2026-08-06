import assert from "node:assert/strict";
import { createRemoteAvatarMotion, type RemoteAvatarMotion } from "../client/game/avatar.ts";
import {
  BASE_AVATAR_VERTICES_PER_PLAYER,
  REMOTE_DEFAULT_PLAYER_BOX_COUNT,
  REMOTE_DEFAULT_PLAYER_HEIGHT,
  createRemotePlayerRenderer,
  remotePlayerBufferCapacity,
  writeRemotePlayerGeometry,
  type RemoteGeometryStats,
} from "../client/game/remotePlayerRenderer.ts";
import { LAKECRAFT_DEFAULT_SKIN_PALETTE } from "../client/game/playerSkin.ts";
import type { RemotePlayer } from "../client/game/types.ts";

const player: RemotePlayer = {
  id: "default-skin-distance-rig",
  name: "Explorer",
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
};
const state = createRemoteAvatarMotion(player, 0);
const states = new Map<string, RemoteAvatarMotion>([[state.id, state]]);
const capacity = remotePlayerBufferCapacity(1);
const avatar = new Float32Array(capacity.avatarFloats);
const names = new Float32Array(capacity.nameplateFloats);
const stats: RemoteGeometryStats = { avatarVertexCount: 0, nameplateVertexCount: 0, visiblePlayerCount: 0 };
writeRemotePlayerGeometry(states, [0, 2, -4], avatar, names, stats);

assert.equal(REMOTE_DEFAULT_PLAYER_BOX_COUNT, 17);
assert.equal(BASE_AVATAR_VERTICES_PER_PLAYER, 17 * 36);
assert.equal(stats.avatarVertexCount, BASE_AVATAR_VERTICES_PER_PLAYER);
assert.equal(stats.visiblePlayerCount, 1);

const body = avatar.subarray(0, stats.avatarVertexCount * 6);
const epsilon = 1e-5;
const normalized = (rgb: readonly [number, number, number]) => rgb.map((channel) => channel / 255);
function verticesWithColor(rgb: readonly [number, number, number]): number[] {
  const target = normalized(rgb);
  const offsets: number[] = [];
  for (let offset = 0; offset < body.length; offset += 6) {
    if (Math.abs(body[offset + 3] - target[0]) < epsilon
      && Math.abs(body[offset + 4] - target[1]) < epsilon
      && Math.abs(body[offset + 5] - target[2]) < epsilon) offsets.push(offset);
  }
  return offsets;
}

for (const [name, color] of Object.entries({
  skin: LAKECRAFT_DEFAULT_SKIN_PALETTE.skin,
  jacket: LAKECRAFT_DEFAULT_SKIN_PALETTE.jacket,
  trousers: LAKECRAFT_DEFAULT_SKIN_PALETTE.trousers,
  boots: LAKECRAFT_DEFAULT_SKIN_PALETTE.boots,
  hair: LAKECRAFT_DEFAULT_SKIN_PALETTE.hair,
  eyes: LAKECRAFT_DEFAULT_SKIN_PALETTE.eyes,
  scarf: LAKECRAFT_DEFAULT_SKIN_PALETTE.scarf,
  mouth: LAKECRAFT_DEFAULT_SKIN_PALETTE.skinShade,
})) {
  assert.ok(verticesWithColor(color).length > 0, `remote explorer contains the canonical ${name} color`);
}

assert.equal(
  verticesWithColor([13, 135, 140]).length,
  0,
  "the old approximation color is absent from the installed standard palette",
);

let minX = Infinity; let maxX = -Infinity;
let minY = Infinity; let maxY = -Infinity;
for (let offset = 0; offset < body.length; offset += 6) {
  minX = Math.min(minX, body[offset]); maxX = Math.max(maxX, body[offset]);
  minY = Math.min(minY, body[offset + 1]); maxY = Math.max(maxY, body[offset + 1]);
}
assert.ok(Math.abs(minX + 0.505) < epsilon && Math.abs(maxX - 0.505) < epsilon,
  "wide default-skin arms preserve the standard 16-pixel body span");
assert.equal(minY, 0);
assert.ok(maxY >= REMOTE_DEFAULT_PLAYER_HEIGHT && maxY <= REMOTE_DEFAULT_PLAYER_HEIGHT + 0.006,
  "the distance rig preserves the standard 32-pixel / two-block player height");

const scarfOffsets = verticesWithColor(LAKECRAFT_DEFAULT_SKIN_PALETTE.scarf);
const scarfX = scarfOffsets.map((offset) => body[offset]);
const scarfY = scarfOffsets.map((offset) => body[offset + 1]);
assert.ok(Math.min(...scarfX) < -0.12 && Math.max(...scarfX) > 0.12,
  "the standard shirt accent crosses the chest");
assert.ok(Math.min(...scarfY) >= 1.36 && Math.max(...scarfY) <= 1.49,
  "the scarf remains at the collar rather than becoming anonymous body color");

const fullCapacity = remotePlayerBufferCapacity(32);
const expectedAvatarFloats = 32 * (BASE_AVATAR_VERTICES_PER_PLAYER + 10 * 36 + 24 * 6) * 6;
assert.equal(fullCapacity.avatarFloats, expectedAvatarFloats);
assert.equal(
  BASE_AVATAR_VERTICES_PER_PLAYER - 17 * 36,
  0,
  "default-skin fidelity adds zero vertices versus the previous fixed remote body budget",
);

const gpuAllocations: number[] = [];
let nextBuffer = 0;
const fixedCapacityGl = {
  ARRAY_BUFFER: 0x8892,
  DYNAMIC_DRAW: 0x88e8,
  createBuffer: () => ({ id: ++nextBuffer }) as unknown as WebGLBuffer,
  bindBuffer: () => undefined,
  bufferData: (_target: number, size: number) => gpuAllocations.push(size),
  deleteBuffer: () => undefined,
} as unknown as WebGLRenderingContext;
const fixedCapacityRenderer = createRemotePlayerRenderer(fixedCapacityGl);
assert.deepEqual(gpuAllocations, [
  fullCapacity.avatarFloats * Float32Array.BYTES_PER_ELEMENT,
  fullCapacity.nameplateFloats * Float32Array.BYTES_PER_ELEMENT,
], "the production renderer always allocates the one global 32-player fixed capacity");
fixedCapacityRenderer.destroy();

console.log(JSON.stringify({
  benchmark: "remote installed-default skin fidelity",
  baseBoxes: REMOTE_DEFAULT_PLAYER_BOX_COUNT,
  baseVerticesPerPlayer: BASE_AVATAR_VERTICES_PER_PLAYER,
  avatarCapacityBytes32: fullCapacity.avatarFloats * Float32Array.BYTES_PER_ELEMENT,
  baseCapacityDeltaBytes32: 0,
}));
