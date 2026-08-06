import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCK } from "../client/game/types.ts";
import {
  TERRAIN_MIN_Y,
  createTerrainChunk,
  terrainHeight,
  terrainOreBlock,
} from "../client/game/terrain.ts";
import { planLocalCreeperExplosion, planLocalTntExplosion } from "../client/game/voxelEngine.ts";
import { WORLD_EDIT_MAX_Y, WORLD_EDIT_MIN_Y } from "../shared/worldChunks.ts";
import { WORLD_TERRAIN_MIN_Y, naturalWorldBlockAt } from "../shared/worldTerrainAuthority.ts";

const seed = 7_319;
assert.equal(TERRAIN_MIN_Y, 1);
assert.equal(WORLD_TERRAIN_MIN_Y, 1);
assert.equal(WORLD_EDIT_MIN_Y, 1);
assert.equal(WORLD_EDIT_MAX_Y, 192);
assert.equal(naturalWorldBlockAt(0, 0, 0, seed), "air", "y=0 is void, never implicit stone");
assert.equal(naturalWorldBlockAt(0, 1, 0, seed), "bedrock");
assert.equal(createTerrainChunk(seed, 0, 0).get("0,1,0"), BLOCK.BEDROCK);
assert.equal(terrainHeight(0, 0, seed), 68);

let diamondCount = 0;
for (let x = -64; x <= 64; x += 1) for (let z = -64; z <= 64; z += 1) {
  const surface = terrainHeight(x, z, seed);
  assert.ok(surface >= 63 && surface <= 80);
  for (let y = 1; y <= 64; y += 1) {
    const ore = terrainOreBlock(x, y, z, seed);
    if (ore !== BLOCK.DIAMOND_ORE) continue;
    diamondCount += 1;
    assert.ok(y >= 2 && y <= 10, `diamond escaped the low band at y=${y}`);
  }
}
assert.ok(diamondCount > 0, "the y=2..10 band remains meaningfully populated");

const readFoundation = (_x: number, y: number, _z: number) => y === 1 ? BLOCK.BEDROCK : BLOCK.STONE;
assert.equal(planLocalTntExplosion(0, 3, 0, readFoundation).some((edit) => edit.y === 1), false);
assert.equal(planLocalCreeperExplosion(0, 2, 0, readFoundation).some((edit) => edit.y === 1), false);

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.ok(engine.includes("mined.block !== BLOCK.BEDROCK"));
assert.ok(server.includes('currentBlock === "bedrock" || request.y === WORLD_EDIT_MIN_Y'));
assert.ok(server.includes('cell.y < WORLD_EDIT_MIN_Y ? "stone" : "air"') === false,
  "multiplayer probes treat the coordinate below bedrock as void, not phantom stone");

console.log(JSON.stringify({ diamondCount, spawnSurface: terrainHeight(0, 0, seed), worldBounds: [1, 192] }));
console.log("lakecraft vertical world coordinate contract tests: ok");
