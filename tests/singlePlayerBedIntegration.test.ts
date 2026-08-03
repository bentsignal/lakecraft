import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");

assert.ok(app.includes("target.block.block === BLOCK.BED"));
assert.ok(app.includes("initialBedStructures: initialSnapshot.world.beds ?? []"));
assert.ok(app.includes("twoBlockBeds: true"));
assert.ok(app.includes("engineRef.current?.exportBedStructures()"));
assert.ok(app.includes("const bed = engine.getBedAt(x, y, z)"));
assert.ok(app.includes("engine.setRespawnPoint(respawnPointForBed"));
assert.ok(app.includes("canSleepAtPhase(phaseAtTime(runtime.worldTimeMs, runtime.dayNight))"));
assert.ok(app.includes("epochPhase: MORNING_PHASE"));
assert.ok(app.includes("previousBlock === BLOCK.BED && edit.block !== BLOCK.BED"));
assert.ok(app.includes("engine.getBlockAt(bed.x, bed.y, bed.z) !== BLOCK.BED"));
assert.ok(app.includes("worldModalOpen = containerOpen || sleepingBed !== null"));
assert.equal(app.includes("lakebed/client"), false, "single-player bed behavior must remain fully local");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const placement = engine.slice(engine.indexOf("function tryPlaceSelectedBlock"), engine.indexOf("function repeatHeldBlockPlacement"));
assert.ok(placement.indexOf("planBedPlacement") < placement.indexOf("commitEditBatch"));
assert.ok(placement.indexOf("commitEditBatch") < placement.indexOf('emitHandAction("place")'));
const edit = engine.slice(engine.indexOf("function emitEdit"), engine.indexOf("function onKeyDown"));
assert.ok(edit.includes("bedBreakEdits"));
assert.ok(edit.includes("commitEditBatch"));
assert.ok(edit.indexOf("bedBreakEdits") < edit.indexOf("commitEditBatch"));

console.log("lakecraft single-player bed integration tests: ok");
