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
assert.ok(app.includes("pairedEdit.block !== BLOCK.BED"),
  "respawn invalidation follows a companion coordinate even when falling material replaces it");
assert.equal(app.match(/structuredBedForRespawnPoint\(respawn,/g)?.length, 2,
  "reload and death validation share global pair-metadata resolution");
assert.equal(app.includes("engine.getBlockAt(bed.x, bed.y, bed.z) !== BLOCK.BED"), false);
assert.ok(app.includes("worldModalOpen = containerOpen || sleepingBed !== null"));
assert.equal(app.includes("lakebed/client"), false, "single-player bed behavior must remain fully local");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const placement = engine.slice(engine.indexOf("function tryPlaceSelectedBlock"), engine.indexOf("function repeatHeldBlockPlacement"));
assert.ok(placement.indexOf("planBedPlacement") < placement.indexOf("commitEditBatch"));
assert.ok(placement.indexOf("commitEditBatch") < placement.indexOf('emitHandAction("place")'));
const edit = engine.slice(engine.indexOf("function emitEdit"), engine.indexOf("function onKeyDown"));
assert.ok(edit.includes("commitEditBatch"));
assert.ok(edit.includes("previousBlock === BLOCK.BED"));
assert.ok(edit.includes("planBedBreakSettlement"), "mining a bed plans both falling columns before reservation");
const editCommit = engine.slice(engine.indexOf("function commitEditBatch"), engine.indexOf("function emitEdit"));
assert.ok(editCommit.includes("options.onBlockEdit?.({ ...semanticEdit }"),
  "semantic mining intent remains separate from the reconciled journal/render batch");
const worldCommit = engine.slice(engine.indexOf("function commitWorldEditBatch"), engine.indexOf("function rememberWorldEdit"));
assert.ok(worldCommit.includes("reconcileBedEditBatch"));
assert.ok(worldCommit.indexOf("reconcileBedEditBatch") < worldCommit.indexOf("options.acceptWorldEdits"));
assert.ok(worldCommit.indexOf("options.acceptWorldEdits") < worldCommit.indexOf("unregisterBedStructure"));
for (const boundary of ["applyLocalExplosionEdits", "applyWorldEdits(edits)", "settleFallingBlocks(edit"]) {
  assert.ok(engine.slice(engine.indexOf(boundary), engine.indexOf("}", engine.indexOf(boundary)) + 1).includes("commitWorldEditBatch"),
    `${boundary} routes through bed-aware atomic reconciliation`);
}
const explosionProtection = engine.slice(
  engine.indexOf("const LOCAL_EXPLOSION_PROTECTED_BLOCKS"),
  engine.indexOf("export function planLocalTntExplosion"),
);
assert.doesNotMatch(explosionProtection, /BLOCK\.BED(?:\s|,)/, "paired beds participate in TNT and creeper crater edits");
const explosionApply = engine.slice(engine.indexOf("function applyLocalExplosionEdits"), engine.indexOf("function updateMobs"));
assert.ok(explosionApply.includes("previousBlock: BLOCK.BED"), "an out-of-radius companion carries correct break metadata");
assert.ok(engine.includes("edits: appliedEdits ?? []"), "creeper persistence receives the expanded accepted crater");
assert.ok(engine.includes("return appliedEdits;"), "TNT persistence receives the expanded accepted crater");

console.log("lakecraft single-player bed integration tests: ok");
