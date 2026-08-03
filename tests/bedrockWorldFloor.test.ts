import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockFaceIsOccluded, blockHasCollision } from "../client/game/voxelEngine.ts";
import {
  materializeTerrainChunk,
  planLocalCreeperExplosion,
  planLocalTntExplosion,
} from "../client/game/voxelEngine.ts";
import {
  TERRAIN_MIN_Y,
  TERRAIN_Y_OFFSET,
  blockKey,
  createTerrainChunk,
  raycastVoxels,
  terrainBaseBlock,
  terrainHeight,
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
  WORLD_TERRAIN_Y_OFFSET,
  naturalWorldBlockAt,
} from "../shared/worldTerrainAuthority.ts";

const SEED = 7319;

assert.equal(BLOCK.BEDROCK, 33, "bedrock appends without renumbering saved engine block IDs");
assert.equal(TERRAIN_MIN_Y, 0);
assert.equal(TERRAIN_Y_OFFSET, 24);
assert.equal(WORLD_TERRAIN_MIN_Y, 0);
assert.equal(WORLD_TERRAIN_Y_OFFSET, 24);
assert.equal(WORLD_EDIT_MIN_Y, 0);
assert.equal(isBlockType("bedrock"), true);
assert.equal(creeperBlockIsProtected("bedrock"), true);
assert.equal(blockHasCollision(BLOCK.BEDROCK), true);
assert.equal(blockFaceIsOccluded(BLOCK.BEDROCK, BLOCK.AIR, "bottom"), true,
  "the invisible underside of the finite foundation is never meshed");
assert.equal(blockFaceIsOccluded(BLOCK.BEDROCK, BLOCK.AIR, "top"), false);
assert.equal(terrainHeight(0, 0, SEED), 30, "the legacy y=6 spawn plateau translates to y=30");
for (let x = -16; x <= 16; x += 4) {
  for (let z = -16; z <= 16; z += 4) {
    assert.ok(terrainHeight(x, z, SEED) >= 27 && terrainHeight(x, z, SEED) <= 35,
      "the complete legacy 3..11 surface range translates by exactly +24");
  }
}

const translatedLegacyAnchors = [
  [-64, -8, -64, "gold_ore"],
  [-64, -19, -60, "iron_ore"],
  [-63, -12, -64, "coal_ore"],
  [-62, -12, -62, "diamond_ore"],
  [-57, -23, -57, "air"],
  [-64, 7, -53, "sand"],
  [-64, -2, -37, "gravel"],
  [-76, 5, -17, "clay"],
  [-59, 9, -33, "wood"],
  [-61, 10, -34, "leaves"],
] as const;
for (const [x, legacyY, z, expected] of translatedLegacyAnchors) {
  const y = legacyY + TERRAIN_Y_OFFSET;
  assert.equal(naturalWorldBlockAt(x, y, z, SEED), expected,
    `legacy terrain anchor ${x},${legacyY},${z} must translate without shape mutation`);
  assert.equal(createTerrainChunk(SEED, Math.floor(x / 8), Math.floor(z / 8)).get(blockKey(x, y, z)) ?? BLOCK.AIR,
    ({ air: BLOCK.AIR, gold_ore: BLOCK.GOLD_ORE, iron_ore: BLOCK.IRON_ORE, coal_ore: BLOCK.COAL_ORE,
      diamond_ore: BLOCK.DIAMOND_ORE, sand: BLOCK.SAND, gravel: BLOCK.GRAVEL, clay: BLOCK.CLAY,
      wood: BLOCK.WOOD, leaves: BLOCK.LEAVES } as const)[expected]);
}

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

assert.deepEqual(createWorldChunkSnapshot("0:0", [
  { x: 0, y: 0, z: 0, blockType: "air" },
  { x: 0, y: 1, z: 0, blockType: "stone" },
]), { ok: false, reason: "invalid_edit" }, "new snapshot writes reject the foundation atomically");
assert.deepEqual(createWorldChunkSnapshot("0:0", [
  { x: 0, y: 2, z: 0, blockType: "bedrock" },
]), { ok: false, reason: "invalid_edit" }, "bedrock is unrepresentable in persisted edits");
const snapshot = createWorldChunkSnapshot("0:0", [{ x: 0, y: 1, z: 0, blockType: "stone" }]);
assert.equal(snapshot.ok, true);
if (!snapshot.ok) throw new Error(snapshot.reason);
assert.equal(snapshot.editCount, 1);
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
assert.deepEqual(applyWorldChunkEdit("0:0", snapshot.snapshotJson, { x: 0, y: 2, z: 0, blockType: "bedrock" }), {
  ok: false,
  reason: "invalid_edit",
}, "authoritative edit batches cannot manufacture bedrock away from the foundation");

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
assert.match(engineSource, /if \(y < TERRAIN_MIN_Y \+ 1\) return true/,
  "player collision has a fail-closed floor even if chunk data is incomplete");

console.log("lakecraft finite bedrock world-floor tests: ok");
