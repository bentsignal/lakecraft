import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");

assert.ok(engine.includes("consumeDueLocalCreeperExplosions(mobSimulation, localCreeperExplosions)"), "the offline engine consumes completed creeper fuses");
assert.ok(engine.includes("applyLocalExplosionEdits(edits)"), "a completed fuse resolves terrain through the bounded local blast path");
assert.ok(engine.includes("resolveCreeperExplosionDamage"), "the local player receives the shared creeper damage curve");
assert.ok(engine.includes("mitigatedPlayerDamage(rawDamage, options.getPlayerProtection?.() ?? 0)"), "creeper blasts use the shared multiplayer mitigation contract");
assert.ok(engine.includes('options.onPlayerDamage?.(appliedDamage, "creeper")'), "creeper damage carries its durability-wear cause");
assert.ok(engine.includes("options.onLocalCreeperExplosion?."), "the application is notified exactly at the completed-fuse boundary");
assert.ok(singleplayer.includes("onLocalCreeperExplosion"), "single-player persists automatic creeper terrain edits");
assert.ok(singleplayer.includes('recordLocalExplosion(`creeper:${mobId}`'), "creeper and TNT blasts share save, sound, particles, and chain handling");
assert.ok(singleplayer.includes("getPlayerProtection: () => equippedArmorProtection(equipmentRef.current)"), "single-player combat reads equipped armor");
assert.ok(singleplayer.includes('audio.play("mobHurt"'), "successful local attacks have audible hit confirmation");

console.log("lakecraft local creeper explosion integration tests: ok");
