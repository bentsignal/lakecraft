import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockHasCollision } from "../client/game/voxelEngine.ts";
import {
  materializeTerrainChunk,
  planLocalCreeperExplosion,
  planLocalTntExplosion,
} from "../client/game/voxelEngine.ts";
import {
  TERRAIN_MIN_Y,
  blockKey,
  createTerrainChunk,
  raycastVoxels,
  terrainBaseBlock,
} from "../client/game/terrain.ts";
import { BLOCK } from "../client/game/types.ts";
import { creeperBlockIsProtected } from "../shared/creeperExplosion.ts";
import { resolveFallingBlocks } from "../shared/fallingBlocks.ts";
import { isBlockType } from "../shared/protocol.ts";
import {
  WORLD_EDIT_MIN_Y,
  applyWorldChunkEdit,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
  sampleWorldChunkSnapshot,
} from "../shared/worldChunks.ts";
import { parseWorldBlockOperation } from "../shared/worldBlockOperations.ts";
import {
  WORLD_TERRAIN_MIN_Y,
  naturalWorldBlockAt,
} from "../shared/worldTerrainAuthority.ts";

const SEED = 7319;

assert.equal(BLOCK.BEDROCK, 33, "bedrock appends without renumbering saved engine block IDs");
assert.equal(TERRAIN_MIN_Y, 0);
assert.equal(WORLD_TERRAIN_MIN_Y, 0);
assert.equal(WORLD_EDIT_MIN_Y, 0);
assert.equal(isBlockType("bedrock"), true);
assert.equal(creeperBlockIsProtected("bedrock"), true);
assert.equal(blockHasCollision(BLOCK.BEDROCK), true);

for (const [chunkX, chunkZ] of [[0, 0], [-7, 12], [1234, -4321]]) {
  const chunk = createTerrainChunk(SEED, chunkX, chunkZ);
  assert.deepEqual([...createTerrainChunk(SEED, chunkX, chunkZ)], [...chunk], "foundation generation is deterministic");
  for (let x = chunkX * 8; x < chunkX * 8 + 8; x += 1) {
    for (let z = chunkZ * 8; z < chunkZ * 8 + 8; z += 1) {
      assert.equal(chunk.get(blockKey(x, 0, z)), BLOCK.BEDROCK, `missing bedrock at ${x},0,${z}`);
      assert.equal(chunk.has(blockKey(x, -1, z)), false, "the finite world has no generated cells below y=0");
      assert.equal(terrainBaseBlock(x, 0, z, SEED), BLOCK.BEDROCK);
      assert.equal(naturalWorldBlockAt(x, 0, z, SEED), "bedrock");
      assert.equal(naturalWorldBlockAt(x, -1, z, SEED), "air");
    }
  }
}

const journalProtected = materializeTerrainChunk(SEED, 0, 0, [
  { x: 0, y: 0, z: 0, block: BLOCK.AIR },
  { x: 1, y: 0, z: 0, block: BLOCK.STONE },
  { x: 2, y: 1, z: 0, block: BLOCK.BEDROCK },
]);
assert.equal(journalProtected.get(blockKey(0, 0, 0)), BLOCK.BEDROCK, "an AIR journal edit cannot mine bedrock");
assert.equal(journalProtected.get(blockKey(1, 0, 0)), BLOCK.BEDROCK, "a placement edit cannot replace bedrock");
assert.notEqual(journalProtected.get(blockKey(2, 1, 0)), BLOCK.BEDROCK, "bedrock cannot be introduced by an edit");

const downwardHit = raycastVoxels(
  [0.5, 3, 0.5],
  [0, -1, 0],
  (_x, y, _z) => y === 0 ? BLOCK.BEDROCK : BLOCK.AIR,
  5,
);
assert.equal(downwardHit?.block.block, BLOCK.BEDROCK, "raycasts target the finite world foundation");
assert.deepEqual(downwardHit?.place, { x: 0, y: 1, z: 0 });

assert.equal(planLocalTntExplosion(0, 1, 0, (_x, y) => y === 0 ? BLOCK.BEDROCK : BLOCK.AIR).length, 0,
  "local TNT cannot plan a bedrock edit");
assert.equal(planLocalCreeperExplosion(0, 1, 0, (_x, y) => y === 0 ? BLOCK.BEDROCK : BLOCK.AIR).length, 0,
  "local creepers cannot plan a bedrock edit");

const falling = resolveFallingBlocks({
  trigger: { x: 0, y: 3, z: 0, coordKey: "0:3:0", previousBlock: "air", nextBlock: "sand" },
  authoritativeCells: [
    { x: 0, y: 0, z: 0, coordKey: "0:0:0", block: "bedrock", blockInstanceToken: null },
    { x: 0, y: 1, z: 0, coordKey: "0:1:0", block: "air", blockInstanceToken: null },
    { x: 0, y: 2, z: 0, coordKey: "0:2:0", block: "air", blockInstanceToken: null },
    { x: 0, y: 3, z: 0, coordKey: "0:3:0", block: "sand", blockInstanceToken: null },
    { x: 0, y: 4, z: 0, coordKey: "0:4:0", block: "air", blockInstanceToken: null },
  ],
});
assert.equal(falling.ok, true);
if (falling.ok) assert.equal(falling.moves[0]?.destination.y, 1, "falling blocks settle above bedrock, never into it");

const snapshot = createWorldChunkSnapshot("0:0", [
  { x: 0, y: 0, z: 0, blockType: "air" },
  { x: 0, y: 1, z: 0, blockType: "stone" },
]);
assert.equal(snapshot.ok, true);
if (!snapshot.ok) throw new Error(snapshot.reason);
assert.equal(snapshot.editCount, 1, "save snapshots do not persist edits over generated bedrock");
const decoded = decodeWorldChunkSnapshot("0:0", snapshot.snapshotJson);
assert.equal(decoded.ok, true);
if (decoded.ok) assert.deepEqual(decoded.edits.map((edit) => edit.coordKey), ["0:1:0"]);
assert.deepEqual(sampleWorldChunkSnapshot("0:0", snapshot.snapshotJson, [{ x: 0, y: 0, z: 0 }]), {
  ok: true,
  blocks: [null],
}, "loading a floor sample always falls back to canonical natural bedrock");
assert.deepEqual(applyWorldChunkEdit("0:0", snapshot.snapshotJson, { x: 0, y: 0, z: 0, blockType: "air" }), {
  ok: false,
  reason: "invalid_edit",
}, "authoritative edit batches reject the foundation atomically");

const operationBase = {
  operationId: "bedrock_floor_0001",
  x: 0,
  y: 0,
  z: 0,
  selectedHotbar: 0,
  expectedHeldItem: null,
  expectedInventoryRevision: "0",
  expectedChunkRevision: "0",
};
assert.equal(parseWorldBlockOperation({ ...operationBase, kind: "mine", expectedBlock: "bedrock" }).ok, false,
  "survival/multiplayer mining rejects bedrock before state mutation");
assert.equal(parseWorldBlockOperation({
  ...operationBase,
  y: 1,
  kind: "place",
  expectedBlock: "air",
  placedBlock: "bedrock",
}).ok, false, "bedrock is not placeable, including through crafted edit payloads");

const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engineSource, /mined\.block !== BLOCK\.BEDROCK/, "Creative and Survival share the engine mining guard");
assert.match(engineSource, /edits\.some\(\(edit\) => edit\.y <= TERRAIN_MIN_Y \|\| edit\.block === BLOCK\.BEDROCK\)/,
  "all live local/remote edit batches fail closed at the foundation boundary");

console.log("lakecraft finite bedrock world-floor tests: ok");
