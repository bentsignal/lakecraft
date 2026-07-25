import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

for (const marker of [
  "primedTnt: table({",
  "tntIgnitionReceipts: table({",
  "tntExplosionReceipts: table({",
  "igniteTnt: mutation(async",
  "claimTntExplosion: mutation(async",
  "applyAuthoritativeWorldExplosion",
]) assert.ok(server.includes(marker), `missing TNT authority marker: ${marker}`);

const ignite = server.slice(
  server.indexOf("igniteTnt: mutation(async"),
  server.indexOf("claimTntExplosion: mutation(async"),
);
for (const marker of [
  "validateTntIgnitionRequestJson(requestJson)",
  "tntIgnitionFingerprint(request)",
  "ctx.db.tntIgnitionReceipts",
  "authoritativeCombatPose",
  "validatePlayerStateJson",
  "playerState.state.selectedHotbar",
  "furnaceBlockInstanceToken(worldRows[0])",
  "authorizeTntIgnition",
  "createTntFuse",
  "ctx.db.primedTnt.insert",
]) assert.ok(ignite.includes(marker), `missing authoritative ignition marker: ${marker}`);
for (const mutableRead of ["ctx.db.playerPresence", "ctx.db.inventories", "ctx.db.worldEdits", "ctx.db.primedTnt"]) {
  assert.ok(ignite.indexOf("ctx.db.tntIgnitionReceipts") < ignite.indexOf(mutableRead), `ignition receipt must precede ${mutableRead}`);
}
assert.doesNotMatch(ignite, /setTimeout|setInterval/, "Lakebed authority must not spend timer writes on a fuse");
assert.match(ignite, /heldItem,[\s\S]*?activeFuseAtCoordinate/);

const claim = server.slice(
  server.indexOf("claimTntExplosion: mutation(async"),
  server.indexOf("claimCreeperExplosion: mutation(async"),
);
for (const marker of [
  "validateTntExplosionRequestJson(requestJson)",
  "ctx.db.tntExplosionReceipts",
  "normalizeStoredTntFuse(fuseRows[0])",
  "authorizeTntExplosion(request, fuse, serverNow)",
  "electTntExplosionClaimer(fuse, activePlayers)",
  "furnaceBlockInstanceToken(worldRows[0]) !== fuse.blockInstanceToken",
  "applyAuthoritativeWorldExplosion(ctx.db",
  "ctx.db.primedTnt.delete",
  "ctx.db.tntExplosionReceipts.insert",
]) assert.ok(claim.includes(marker), `missing authoritative explosion marker: ${marker}`);
assert.ok(claim.indexOf("ctx.db.tntExplosionReceipts") < claim.indexOf("ctx.db.primedTnt"), "global receipt lookup precedes fuse authority reads");
assert.doesNotMatch(claim, /request\.(?:x|y|z|center|radius)/, "client cannot select the blast geometry");
assert.match(claim, /center: \{ x: fuse\.x \+ 0\.5, y: fuse\.y, z: fuse\.z \+ 0\.5 \}/);

const edit = server.slice(
  server.indexOf("editWorldBlock: mutation(async"),
  server.indexOf("startPresenceSession: mutation("),
);
assert.match(edit, /ctx\.db\.primedTnt[\s\S]*?reason: "block_primed"/, "a burning TNT block cannot be mined or replaced");

const worldChunks = server.slice(
  server.indexOf("worldChunks: query(async"),
  server.indexOf("droppedItems: query(async"),
);
assert.match(worldChunks, /ctx\.db\.primedTnt[\s\S]*?take\(TNT_MAX_ACTIVE_FUSES\)/);
assert.match(worldChunks, /electTntExplosionClaimer/);
assert.match(worldChunks, /return \{ ok: true, chunks, tntFuses, serverNow \}/);
assert.doesNotMatch(worldChunks, /setTimeout|setInterval/);

console.log("Lakebed TNT server authority integration tests passed");
