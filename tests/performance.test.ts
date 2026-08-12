import assert from "node:assert/strict";
import {
  WORLD_CHUNK_SIZE,
  MAX_STREAMING_CHUNK_COUNT,
  chunkBounds,
  chunkCoordinate,
  chunkKeyForBlock,
  dirtyChunkKeysForEdit,
  dirtyChunkKeysForEdits,
  chunkWindow,
  planChunkWindow,
} from "../client/game/chunks.ts";
import { createTerrain, createTerrainChunk } from "../client/game/terrain.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";
import {
  MAX_PLAYER_NAME_LENGTH,
  MAX_REMOTE_PLAYERS,
  createRemoteAvatarMotion,
  type RemoteAvatarMotion,
} from "../client/game/avatar.ts";
import { NAMEPLATE_FONT } from "../client/game/generated/renderGeometry.ts";
import {
  AVATAR_VERTICES_PER_PLAYER,
  BASE_AVATAR_VERTICES_PER_PLAYER,
  MAX_ARMOR_VERTICES_PER_PLAYER,
  MAX_HELD_ITEM_VERTICES_PER_PLAYER,
  REMOTE_MESH_INTERVAL_MS,
  createRemotePlayerRenderer,
  remotePlayerBufferCapacity,
  remoteHeldItemVertexCount,
  writeRemotePlayerGeometry,
  type RemoteGeometryStats,
} from "../client/game/remotePlayerRenderer.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";

assert.equal(chunkCoordinate(0), 0);
assert.equal(chunkCoordinate(7), 0);
assert.equal(chunkCoordinate(8), 1);
assert.equal(chunkCoordinate(-1), -1);
assert.equal(chunkCoordinate(-8), -1);
assert.equal(chunkCoordinate(-9), -2);
assert.deepEqual(dirtyChunkKeysForEdit(2, 3).sort(), ["0,0"]);
assert.deepEqual(dirtyChunkKeysForEdit(0, 3).sort(), ["-1,0", "0,0"]);
assert.deepEqual(dirtyChunkKeysForEdit(-1, -1).sort(), ["-1,-1", "-1,0", "0,-1"]);
assert.deepEqual(
  dirtyChunkKeysForEdits([{ x: 7, z: 2 }, { x: 8, z: 2 }]).sort(),
  ["0,0", "1,0"],
  "batch planning should deduplicate both sides of a shared chunk boundary",
);

const blocks = createTerrain(7319, 20);
const chunks = new Map<string, string[]>();
for (const key of blocks.keys()) {
  const [x, , z] = key.split(",").map(Number);
  const owner = chunkKeyForBlock(x, z);
  const owned = chunks.get(owner) ?? [];
  owned.push(key);
  chunks.set(owner, owned);
}

function exposedVertexCount(keys: readonly string[], world: ReadonlyMap<string, BlockId>): number {
  const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  let faces = 0;
  for (const key of keys) {
    const block = world.get(key) ?? BLOCK.AIR;
    if (block === BLOCK.AIR) continue;
    const [x, y, z] = key.split(",").map(Number);
    for (const [dx, dy, dz] of neighbors) {
      if ((world.get(`${x + dx},${y + dy},${z + dz}`) ?? BLOCK.AIR) === BLOCK.AIR) faces += 1;
    }
  }
  return faces * 6;
}

const edit = { x: 2, z: 2 };
const dirtyKeys = dirtyChunkKeysForEdit(edit.x, edit.z);
const dirtyBlocks = dirtyKeys.flatMap((key) => chunks.get(key) ?? []);
const allKeys = [...blocks.keys()];
const fullVertices = exposedVertexCount(allKeys, blocks);
const dirtyVertices = exposedVertexCount(dirtyBlocks, blocks);
const scanReduction = allKeys.length / dirtyBlocks.length;
const uploadReduction = fullVertices / dirtyVertices;

assert.equal(WORLD_CHUNK_SIZE, 8);
assert.deepEqual(chunkBounds(-1, 2), { x: -1, z: 2, minX: -8, maxX: -1, minZ: 16, maxZ: 23 });
const initialWindow = chunkWindow(0, 0);
assert.equal(initialWindow.length, MAX_STREAMING_CHUNK_COUNT);
assert.deepEqual(initialWindow[0], { x: 0, z: 0 }, "near-first loading should prioritize the player's chunk");
assert.equal(chunkWindow(0, 0, 999).length, MAX_STREAMING_CHUNK_COUNT, "view work must remain bounded");
const shiftedPlan = planChunkWindow(8, 0, new Set(initialWindow.map(({ x, z }) => `${x},${z}`)));
assert.equal(shiftedPlan.load.length, 7);
assert.equal(shiftedPlan.unload.length, 7);
assert.equal(shiftedPlan.active.length, MAX_STREAMING_CHUNK_COUNT);
assert.equal(dirtyKeys.length, 1);
assert.ok(scanReduction > 20, `expected >20x candidate scan reduction, got ${scanReduction.toFixed(1)}x`);
assert.ok(uploadReduction > 15, `expected >15x vertex upload reduction, got ${uploadReduction.toFixed(1)}x`);

console.log(JSON.stringify({
  benchmark: "single interior block edit",
  worldBlocks: allKeys.length,
  dirtyChunkBlocks: dirtyBlocks.length,
  fullVertices,
  dirtyChunkVertices: dirtyVertices,
  scanReduction: Number(scanReduction.toFixed(1)),
  uploadReduction: Number(uploadReduction.toFixed(1)),
}));

const windowStartedAt = performance.now();
const deepWindow = chunkWindow(8 * 25_000, 8 * -25_000)
  .map(({ x, z }) => createTerrainChunk(7319, x, z));
const windowGenerationMs = performance.now() - windowStartedAt;
const deepWindowBlocks = deepWindow.reduce((total, chunk) => total + chunk.size, 0);
assert.equal(deepWindow.length, MAX_STREAMING_CHUNK_COUNT);
assert.ok(deepWindowBlocks > 180_000 && deepWindowBlocks < 230_000, `unexpected 7x7 deep-window size ${deepWindowBlocks}`);
assert.ok(windowGenerationMs < 350, `far 7x7 deep window took ${windowGenerationMs.toFixed(1)}ms (budget: 350ms)`);
console.log(JSON.stringify({
  benchmark: "far-coordinate 7x7 deep streaming window",
  generationMs: Number(windowGenerationMs.toFixed(2)),
  chunks: deepWindow.length,
  blockCount: deepWindowBlocks,
}));

function remoteStates(
  count: number,
  geared = false,
  heldItem: ItemId = "iron_pickaxe",
  name = "WWWWWWWWWWWWWWWW",
): Map<string, RemoteAvatarMotion> {
  const states = new Map<string, RemoteAvatarMotion>();
  for (let index = 0; index < count; index += 1) {
    const id = `remote-${index}`;
    states.set(id, createRemoteAvatarMotion({
      id,
      name,
      x: (index % 8) + 1,
      y: 8,
      z: Math.floor(index / 8) + 1,
      yaw: index * 0.1,
      pitch: 0,
      heldItem: geared ? heldItem : null,
      armorHead: geared ? "iron_helmet" : null,
      armorChest: geared ? "iron_chestplate" : null,
      armorLegs: geared ? "iron_leggings" : null,
      armorFeet: geared ? "iron_boots" : null,
    }, 0));
  }
  return states;
}

const remoteBenchmarks: Array<Record<string, number>> = [];
for (const playerCount of [1, 8, 32]) {
  const capacity = remotePlayerBufferCapacity(playerCount);
  const avatarData = new Float32Array(capacity.avatarFloats);
  const nameplateData = new Float32Array(capacity.nameplateFloats);
  const remoteStats: RemoteGeometryStats = { avatarVertexCount: 0, skinVertexCount: 0, nameplateVertexCount: 0, visiblePlayerCount: 0 };
  writeRemotePlayerGeometry(remoteStates(playerCount), [0, 9, 0], avatarData, nameplateData, remoteStats);
  assert.equal(remoteStats.visiblePlayerCount, playerCount);
  assert.equal(remoteStats.avatarVertexCount, 0);
  assert.equal(remoteStats.skinVertexCount, playerCount * BASE_AVATAR_VERTICES_PER_PLAYER);
  assert.equal(remoteStats.nameplateVertexCount, playerCount * 1_638);
  const uploadBytes = (remoteStats.skinVertexCount + remoteStats.avatarVertexCount + remoteStats.nameplateVertexCount) * 6 * Float32Array.BYTES_PER_ELEMENT;
  assert.ok(uploadBytes <= capacity.totalBytes);
  remoteBenchmarks.push({ playerCount, uploadBytes, capacityBytes: capacity.totalBytes });
}

const maximalHeldItem = (Object.keys(ITEMS) as ItemId[])
  .find((itemId) => remoteHeldItemVertexCount(itemId) === MAX_HELD_ITEM_VERTICES_PER_PLAYER);
assert.ok(maximalHeldItem, "the catalog contains a true 24-rectangle remote held-item fixture");
const printableGlyphs = Array.from({ length: 64 }, (_, index) => index + 32);
const glyphRects = (codePoint: number) => {
  let rectangles = 0;
  for (let row = 0; row < 7; row += 1) {
    const bits = NAMEPLATE_FONT[codePoint * 7 + row];
    let previous = false;
    for (let column = 0; column < 5; column += 1) {
      const lit = Boolean(bits & 1 << (4 - column));
      if (lit && !previous) rectangles += 1;
      previous = lit;
    }
  }
  return rectangles;
};
const maximalGlyphCodePoint = printableGlyphs.reduce((best, codePoint) => (
  glyphRects(codePoint) > glyphRects(best) ? codePoint : best
));
const maximalGlyphRects = glyphRects(maximalGlyphCodePoint);
assert.ok(maximalGlyphRects >= 17 && maximalGlyphRects <= 21, "5x7 row merging stays inside the fixed rectangle budget");
const maximalName = String.fromCharCode(maximalGlyphCodePoint).repeat(MAX_PLAYER_NAME_LENGTH);
assert.equal(maximalName.length, 16);

const gearedCapacity = remotePlayerBufferCapacity(MAX_REMOTE_PLAYERS);
const gearedAvatarData = new Float32Array(gearedCapacity.avatarFloats);
const gearedNameplateData = new Float32Array(gearedCapacity.nameplateFloats);
const gearedStats: RemoteGeometryStats = { avatarVertexCount: 0, skinVertexCount: 0, nameplateVertexCount: 0, visiblePlayerCount: 0 };
writeRemotePlayerGeometry(
  remoteStates(MAX_REMOTE_PLAYERS, true, maximalHeldItem, maximalName),
  [0, 9, 0],
  gearedAvatarData,
  gearedNameplateData,
  gearedStats,
);
assert.equal(gearedStats.visiblePlayerCount, MAX_REMOTE_PLAYERS);
const gearedVerticesPerPlayer = BASE_AVATAR_VERTICES_PER_PLAYER
  + MAX_ARMOR_VERTICES_PER_PLAYER + MAX_HELD_ITEM_VERTICES_PER_PLAYER;
assert.equal(gearedStats.skinVertexCount, MAX_REMOTE_PLAYERS * BASE_AVATAR_VERTICES_PER_PLAYER);
assert.equal(gearedStats.avatarVertexCount, MAX_REMOTE_PLAYERS * (gearedVerticesPerPlayer - BASE_AVATAR_VERTICES_PER_PLAYER));
assert.equal(gearedVerticesPerPlayer, AVATAR_VERTICES_PER_PLAYER);
const maximalNameplateVerticesPerPlayer = 6 + MAX_PLAYER_NAME_LENGTH * maximalGlyphRects * 6;
assert.equal(gearedStats.nameplateVertexCount, MAX_REMOTE_PLAYERS * maximalNameplateVerticesPerPlayer);
const gearedUploadBytes = (gearedStats.skinVertexCount + gearedStats.avatarVertexCount + gearedStats.nameplateVertexCount) * 6 * Float32Array.BYTES_PER_ELEMENT;
const base32UploadBytes = remoteBenchmarks[remoteBenchmarks.length - 1].uploadBytes;
const fixtureDeltaBytes = gearedUploadBytes - base32UploadBytes;
const gearDeltaBytes = MAX_REMOTE_PLAYERS
  * (gearedVerticesPerPlayer - BASE_AVATAR_VERTICES_PER_PLAYER)
  * 6 * Float32Array.BYTES_PER_ELEMENT;
const nameDeltaBytes = MAX_REMOTE_PLAYERS
  * (maximalNameplateVerticesPerPlayer - 1_638)
  * 6 * Float32Array.BYTES_PER_ELEMENT;
assert.equal(
  fixtureDeltaBytes,
  gearDeltaBytes + nameDeltaBytes,
);
assert.ok(gearedUploadBytes <= gearedCapacity.totalBytes, "32 fully geared players fit the one preallocated avatar buffer");
assert.equal(gearedUploadBytes, 3_432_960, "true maximum catalog gear/name fixture remains deterministic");
assert.ok(gearedUploadBytes < 3_500_000, `worst-case remote upload ${gearedUploadBytes} exceeded 3.5MB`);

const glCalls = { bufferData: 0, bufferSubData: 0, deleteBuffer: 0 };
let nextBufferId = 0;
const fakeGl = {
  ARRAY_BUFFER: 0x8892,
  DYNAMIC_DRAW: 0x88e8,
  createBuffer: () => ({ id: ++nextBufferId }),
  bindBuffer: () => undefined,
  bufferData: () => { glCalls.bufferData += 1; },
  bufferSubData: () => { glCalls.bufferSubData += 1; },
  deleteBuffer: () => { glCalls.deleteBuffer += 1; },
} as unknown as WebGLRenderingContext;
const remoteRenderer = createRemotePlayerRenderer(fakeGl);
assert.equal(glCalls.bufferData, 2, "GPU buffers should be allocated exactly once");
remoteRenderer.update(new Map(), 0, 0.016, [0, 9, 0]);
assert.equal(glCalls.bufferSubData, 0, "zero remotes must skip GPU uploads");
const oneRemote = remoteStates(1);
oneRemote.get("remote-0")!.target.x += 1;
assert.equal(remoteRenderer.update(oneRemote, 0, 0.016, [0, 9, 0]).updated, true);
assert.equal(glCalls.bufferSubData, 1, "a skin-only player uploads only the nameplate gear buffer here");
const firstInterpolatedX = oneRemote.get("remote-0")!.rendered.x;
assert.equal(remoteRenderer.update(oneRemote, REMOTE_MESH_INTERVAL_MS / 2, 0.016, [0, 9, 0]).updated, false);
assert.ok(oneRemote.get("remote-0")!.rendered.x > firstInterpolatedX, "interpolation should advance between capped mesh uploads");
assert.equal(glCalls.bufferSubData, 1);
assert.equal(
  remoteRenderer.update(remoteStates(2, true), REMOTE_MESH_INTERVAL_MS * 0.75, 0.016, [0, 9, 0]).updated,
  false,
  "even player-count and gear changes must respect the 30Hz upload cap",
);
assert.equal(glCalls.bufferSubData, 1);
assert.equal(remoteRenderer.update(oneRemote, REMOTE_MESH_INTERVAL_MS + 1, 0.016, [0, 9, 0]).updated, true);
assert.equal(glCalls.bufferSubData, 2);
remoteRenderer.destroy();
assert.equal(glCalls.deleteBuffer, 2);

console.log(JSON.stringify({
  benchmark: "remote player fixed-buffer scaling",
  samples: remoteBenchmarks,
  maximalGeared32: {
    heldItem: maximalHeldItem,
    nameGlyph: maximalName[0],
    uploadBytes: gearedUploadBytes,
    capacityBytes: gearedCapacity.totalBytes,
    gearDeltaBytes,
    nameDeltaBytes,
    fixtureDeltaBytes,
  },
}));
console.log("lakecraft chunk performance tests: ok");
