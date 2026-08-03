import assert from "node:assert/strict";
import { BLOCKS, ITEMS, getDeterministicMiningDrop, getMiningDrop } from "../shared/game.ts";
import { isBlockType } from "../shared/protocol.ts";
import {
  WORLD_CHUNK_BLOCK_TYPES,
  createWorldChunkSnapshot,
  decodeWorldChunkSnapshot,
} from "../shared/worldChunks.ts";
import {
  WORLD_TERRAIN_SEED,
  naturalWorldBlockAt,
  terrainGravelBlock as authoritativeGravelBlock,
} from "../shared/worldTerrainAuthority.ts";
import { BLOCK } from "../client/game/types.ts";
import {
  createTerrainChunk,
  terrainBaseBlock,
  terrainGravelBlock as clientGravelBlock,
} from "../client/game/terrain.ts";

assert.equal(BLOCKS.gravel.preferredTool, "shovel");
assert.equal(BLOCKS.gravel.drop, "gravel");
assert.equal(ITEMS.gravel.category, "block");
assert.equal(ITEMS.gravel.placesBlock, "gravel");
assert.equal(ITEMS.gravel.maxStack, 64);
assert.equal(isBlockType("gravel"), true);
assert.equal(WORLD_CHUNK_BLOCK_TYPES[23], "gravel", "the append-only chunk palette preserves gravel's deployed code");
assert.equal(BLOCK.GRAVEL, 23, "the client block palette appends gravel after deployed TNT");

assert.deepEqual(getMiningDrop("gravel", null), { itemId: "gravel", count: 1 });
assert.deepEqual(getMiningDrop("gravel", "wooden_shovel"), { itemId: "gravel", count: 1 });
const shovelDrops = Array.from(
  { length: 400 },
  (_, index) => getDeterministicMiningDrop("gravel", "wooden_shovel", index - 200, -4, 83)?.itemId,
);
const sampledFlintCount = shovelDrops.filter((drop) => drop === "flint").length;
assert.ok(sampledFlintCount >= 30 && sampledFlintCount <= 50, `sampled flint chance ${sampledFlintCount}/400 escaped the one-in-ten budget`);
assert.equal(shovelDrops.filter((drop) => drop === "gravel").length + sampledFlintCount, 400);
assert.deepEqual(
  shovelDrops,
  Array.from({ length: 400 }, (_, index) => getDeterministicMiningDrop("gravel", "wooden_shovel", index - 200, -4, 83)?.itemId),
  "equal coordinates always conserve the same single drop",
);
assert.ok(Array.from({ length: 100 }, (_, x) => getDeterministicMiningDrop("sand", "diamond_shovel", x, 2, 5)?.itemId)
  .every((drop) => drop === "sand"), "the temporary flint-from-sand shortcut is gone");

const knownPocket = [-64, 22, -37] as const;
assert.equal(authoritativeGravelBlock(...knownPocket, WORLD_TERRAIN_SEED), "gravel");
assert.equal(clientGravelBlock(...knownPocket, WORLD_TERRAIN_SEED), BLOCK.GRAVEL);
assert.equal(naturalWorldBlockAt(...knownPocket), "gravel");
assert.equal(terrainBaseBlock(...knownPocket, WORLD_TERRAIN_SEED), BLOCK.STONE, "gravel replaces only natural stone strata");

let gravelCount = 0;
let stoneCount = 0;
for (let x = -48; x <= 48; x += 1) {
  for (let z = -48; z <= 48; z += 1) {
    for (let y = 1; y <= 29; y += 1) {
      const authoritative = authoritativeGravelBlock(x, y, z, WORLD_TERRAIN_SEED);
      const client = clientGravelBlock(x, y, z, WORLD_TERRAIN_SEED);
      assert.equal(client === BLOCK.GRAVEL, authoritative === "gravel", `gravel authority drift at ${x},${y},${z}`);
      if (authoritative) gravelCount += 1;
      else if (terrainBaseBlock(x, y, z, WORLD_TERRAIN_SEED) === BLOCK.STONE) stoneCount += 1;
    }
  }
}
const gravelDensity = gravelCount / (gravelCount + stoneCount);
assert.ok(gravelCount >= 2_000, `expected useful underground gravel pockets, received ${gravelCount}`);
assert.ok(gravelDensity >= 0.01 && gravelDensity <= 0.03, `gravel density ${(gravelDensity * 100).toFixed(2)}% escaped its 1–3% budget`);

const chunk = createTerrainChunk(WORLD_TERRAIN_SEED, -8, -5);
assert.equal(chunk.get(`${knownPocket[0]},${knownPocket[1]},${knownPocket[2]}`), BLOCK.GRAVEL);
const snapshot = createWorldChunkSnapshot("0:0", [{
  id: "gravel-codec",
  x: 3,
  y: 22,
  z: 6,
  blockType: "gravel",
  editedAt: "1",
}]);
assert.equal(snapshot.ok, true);
if (snapshot.ok) {
  const decoded = decodeWorldChunkSnapshot("0:0", snapshot.snapshotJson);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.equal(decoded.edits[0]?.blockType, "gravel");
}

console.log(JSON.stringify({ gravelCount, stoneCount, gravelDensity: Number(gravelDensity.toFixed(4)) }));
console.log("lakecraft gravel catalog, deterministic flint drop, terrain, and codec tests: ok");
