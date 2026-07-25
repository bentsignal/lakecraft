import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localCreeperExposureBlock } from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";
import {
  CREEPER_EXPLOSION_RADIUS,
  resolveCreeperExplosionDamage,
  sampleCreeperExplosionExposure,
} from "../shared/creeperExplosion.ts";

assert.equal(localCreeperExposureBlock(BLOCK.AIR), "air");
assert.equal(localCreeperExposureBlock(BLOCK.TORCH), "torch");
assert.equal(localCreeperExposureBlock(BLOCK.LADDER), "ladder");
assert.equal(localCreeperExposureBlock(BLOCK.DOOR_OPEN), "door_open");
assert.equal(localCreeperExposureBlock(BLOCK.OAK_FENCE_GATE_OPEN), "oak_fence_gate_open");
for (const block of [
  BLOCK.STONE,
  BLOCK.GLASS,
  BLOCK.LEAVES,
  BLOCK.DOOR_CLOSED,
  BLOCK.OAK_FENCE_GATE_CLOSED,
  BLOCK.STONE_BRICK_SLAB,
]) assert.equal(localCreeperExposureBlock(block), "stone", "every other engine block remains solid blast cover");

const blast = { center: { x: 0, y: 1, z: 0 }, radius: CREEPER_EXPLOSION_RADIUS };
const target = { x: 4, y: 1, z: 0 };
const exposureFor = (readBlock: (x: number, y: number, z: number) => Parameters<typeof localCreeperExposureBlock>[0]) =>
  sampleCreeperExplosionExposure(blast, target, (cell) => localCreeperExposureBlock(readBlock(cell.x, cell.y, cell.z)));

assert.equal(exposureFor(() => BLOCK.AIR), 1);
for (const passThrough of [BLOCK.TORCH, BLOCK.LADDER, BLOCK.DOOR_OPEN, BLOCK.OAK_FENCE_GATE_OPEN]) {
  assert.equal(exposureFor(() => passThrough), 1, "non-solid utility geometry cannot shield a blast");
}
const fullWall = exposureFor((x) => x === 2 ? BLOCK.STONE : BLOCK.AIR);
const lowerWall = exposureFor((x, y) => x === 2 && y === 1 ? BLOCK.STONE : BLOCK.AIR);
const upperWall = exposureFor((x, y) => x === 2 && y === 2 ? BLOCK.STONE : BLOCK.AIR);
assert.equal(fullWall, 0, "a full-height wall shields all three player samples");
assert.equal(lowerWall, 1 / 3, "cover shielding two samples leaves exactly one-third exposure");
assert.equal(upperWall, 2 / 3, "cover shielding one sample leaves exactly two-thirds exposure");
const fullDamage = resolveCreeperExplosionDamage(blast, target, 1);
assert.equal(resolveCreeperExplosionDamage(blast, target, fullWall), 0);
assert.ok(resolveCreeperExplosionDamage(blast, target, lowerWall) < fullDamage);
assert.ok(resolveCreeperExplosionDamage(blast, target, upperWall) < fullDamage);

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const localBlast = engine.slice(
  engine.indexOf("for (const explosion of consumeDueLocalCreeperExplosions"),
  engine.indexOf("writeMobPoseSnapshots", engine.indexOf("for (const explosion of consumeDueLocalCreeperExplosions")),
);
assert.ok(localBlast.indexOf("sampleCreeperExplosionExposure") < localBlast.indexOf("applyLocalExplosionEdits"),
  "exposure samples the intact wall before terrain mutation");
assert.match(localBlast, /resolveCreeperExplosionDamage\(blast, pose, exposure\)/);
assert.ok(localBlast.indexOf("resolveCreeperExplosionDamage") < localBlast.indexOf("mitigatedPlayerDamage"),
  "armor mitigation remains after cover has reduced raw damage");
assert.equal((localBlast.match(/onLocalCreeperExplosion/g) ?? []).length, 1, "the existing exact-once application callback is unchanged");

console.log("lakecraft local creeper blast exposure tests: ok");
