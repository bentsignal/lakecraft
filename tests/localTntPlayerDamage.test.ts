import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localCreeperExposureBlock } from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";
import {
  CREEPER_EXPLOSION_RADIUS,
  resolveCreeperExplosionDamage,
  sampleCreeperExplosionExposure,
} from "../shared/creeperExplosion.ts";
import { mitigatedPlayerDamage } from "../shared/playerCombat.ts";

const blast = { center: { x: 0.5, y: 1, z: 0.5 }, radius: CREEPER_EXPLOSION_RADIUS };
const pointBlank = { x: 0.5, y: 1, z: 0.5 };
const coveredTarget = { x: 4, y: 1, z: 0.5 };
const exposed = sampleCreeperExplosionExposure(blast, pointBlank, () => "air");
const covered = sampleCreeperExplosionExposure(blast, coveredTarget, () => "stone");
const raw = resolveCreeperExplosionDamage(blast, pointBlank, exposed);
assert.equal(exposed, 1);
assert.equal(covered, 0);
assert.ok(raw > 0, "standing on an exposed TNT blast produces real raw damage");
assert.equal(resolveCreeperExplosionDamage(blast, coveredTarget, covered), 0, "solid cover suppresses TNT damage");
assert.ok(mitigatedPlayerDamage(raw, 20) < raw, "armor mitigation applies to the shared TNT damage curve");
assert.equal(localCreeperExposureBlock(BLOCK.DOOR_OPEN), "door_open");
assert.equal(localCreeperExposureBlock(BLOCK.DOOR_CLOSED), "stone");

const nearTarget = { x: 2, y: 1, z: 0.5 };
const sourceTntExposure = (adjacentCover: boolean) => sampleCreeperExplosionExposure(blast, nearTarget, (cell) => {
  const block = cell.x === 0 && cell.y === 1 && cell.z === 0
    ? BLOCK.TNT
    : adjacentCover && cell.x === 1 && cell.y === 1 && cell.z === 0 ? BLOCK.STONE : BLOCK.AIR;
  return cell.x === 0 && cell.y === 1 && cell.z === 0 ? "air" : localCreeperExposureBlock(block);
});
const sourceOnlyExposure = sourceTntExposure(false);
const adjacentCoverExposure = sourceTntExposure(true);
assert.equal(sourceOnlyExposure, 1, "the exploding source TNT cannot shield its own blast rays");
assert.equal(adjacentCoverExposure, 1 / 3, "neighboring intact cover still shields the same source-TNT fixture");
assert.ok(resolveCreeperExplosionDamage(blast, nearTarget, sourceOnlyExposure) > 0);
assert.ok(resolveCreeperExplosionDamage(blast, nearTarget, adjacentCoverExposure)
  < resolveCreeperExplosionDamage(blast, nearTarget, sourceOnlyExposure));

const source = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const start = source.indexOf("explodeTnt(x, y, z)");
const end = source.indexOf("settleFallingBlocks", start);
const explode = source.slice(start, end);
assert.ok(start >= 0 && end > start);
const validation = explode.indexOf("if (!primedTnt.has(sourceKey)");
const exposure = explode.indexOf("sampleCreeperExplosionExposure");
const apply = explode.indexOf("if (!applyLocalExplosionEdits(edits)) return []");
const damage = explode.indexOf("const appliedDamage");
const playerDamage = explode.indexOf('options.onPlayerDamage?.(appliedDamage, "tnt")');
const healthChange = explode.indexOf("options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH)");
const consumeFuse = explode.indexOf("primedTnt.delete(sourceKey)");
assert.ok(validation >= 0 && validation < exposure, "invalid and duplicate calls return before exposure or damage");
assert.ok(exposure < apply, "cover samples the intact world before terrain mutation");
assert.match(explode, /cell\.x === x && cell\.y === y && cell\.z === z[\s\S]*?\? "air"[\s\S]*?: localCreeperExposureBlock/,
  "only the validated exploding source coordinate is transparent to its own exposure sample");
assert.ok(apply < damage && damage < playerDamage && playerDamage < healthChange,
  "rejected edits return before mitigation, armor wear, health, or death callbacks");
assert.ok(healthChange < consumeFuse, "one accepted blast reconciles health before consuming its exact fuse identity");
assert.equal((explode.match(/onPlayerDamage/g) ?? []).length, 1);
assert.equal((explode.match(/onPlayerHealthChange/g) ?? []).length, 1);
assert.match(explode, /rawDamage > 0[\s\S]*?mitigatedPlayerDamage\(rawDamage, options\.getPlayerProtection\?\.\(\) \?\? 0\)/);

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
assert.ok(app.includes('if (amount > 0 && cause !== "fall")'), "accepted TNT damage reuses one armor-wear edge");
assert.ok(app.includes("setDeathScreenOpen(true)"), "the shared health callback retains local death flow");

console.log("lakecraft local TNT player damage tests: ok");
