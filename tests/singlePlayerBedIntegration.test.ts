import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");

assert.ok(app.includes("target.block.block === BLOCK.BED"));
assert.ok(app.includes("engine.setRespawnPoint(respawnPointForBed"));
assert.ok(app.includes("canSleepAtPhase(phaseAtTime(runtime.worldTimeMs, runtime.dayNight))"));
assert.ok(app.includes("epochPhase: MORNING_PHASE"));
assert.ok(app.includes("previousBlock === BLOCK.BED && edit.block !== BLOCK.BED"));
assert.ok(app.includes("engine.getBlockAt(bed.x, bed.y, bed.z) !== BLOCK.BED"));
assert.ok(app.includes("worldModalOpen = containerOpen || sleepingBed !== null"));
assert.equal(app.includes("lakebed/client"), false, "single-player bed behavior must remain fully local");

console.log("lakecraft single-player bed integration tests: ok");
