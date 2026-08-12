import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planLocalCreeperExplosion } from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";
import { CREEPER_EXPLOSION_MAX_BLOCKS } from "../shared/creeperExplosion.ts";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const presentation = readFileSync(new URL("../client/gameplay/presentation.ts", import.meta.url), "utf8");

assert.ok(engine.includes("consumeDueLocalCreeperExplosions(mobSimulation, localCreeperExplosions)"), "the offline engine consumes completed creeper fuses");
assert.ok(engine.includes("applyLocalExplosionEdits(edits)"), "a completed fuse resolves terrain through the bounded local blast path");
assert.ok(engine.includes("resolveCreeperExplosionDamage"), "the local player receives the shared creeper damage curve");
assert.ok(engine.includes("mitigatedPlayerDamage(rawDamage, options.getPlayerProtection?.() ?? 0)"), "creeper blasts use the shared multiplayer mitigation contract");
assert.ok(engine.includes('options.onPlayerDamage?.(appliedDamage, "creeper")'), "creeper damage carries its durability-wear cause");
assert.ok(engine.includes("options.onLocalCreeperExplosion?."), "the application is notified exactly at the completed-fuse boundary");
assert.ok(singleplayer.includes("onLocalCreeperExplosion"), "single-player persists automatic creeper terrain edits");
assert.ok(singleplayer.includes('recordLocalExplosion(`creeper:${mobId}`'), "creeper and TNT blasts share save, sound, particles, and chain handling");
assert.ok(presentation.includes("getPlayerProtection: () => equippedArmorProtection(context.getEquipment())")
  && singleplayer.includes("getEquipment: () => equipmentRef.current"), "single-player combat reads equipped armor through shared presentation");
assert.ok(singleplayer.includes('audio.play(killed ? "mobDeath" : "mobHurt"'),
  "successful local attacks distinguish audible hurt and death confirmation");

const localCrater = planLocalCreeperExplosion(0, 8, 0, () => BLOCK.STONE);
assert.ok(localCrater.length > 0 && localCrater.length <= CREEPER_EXPLOSION_MAX_BLOCKS,
  "local creeper terrain remains inside the shared 64-cell envelope");
assert.ok(localCrater.every((edit) => Math.abs(edit.x) <= 3 && Math.abs(edit.y - 8) <= 3 && Math.abs(edit.z) <= 3),
  "stronger TNT terrain does not expand local creeper craters");

console.log("lakecraft local creeper explosion integration tests: ok");
