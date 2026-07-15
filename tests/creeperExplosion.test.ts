import assert from "node:assert/strict";
import {
  CREEPER_EXPLOSION_MAX_BLOCKS,
  CREEPER_EXPLOSION_RADIUS,
  authorizeCreeperExplosionRequest,
  creeperExplosionEventId,
  decideCreeperExplosionCommit,
  enumerateCreeperExplosionBlocks,
  planCreeperTerrainDestruction,
  resolveCreeperExplosionDamage,
  validateCreeperExplosionRequestJson,
  type CreeperExplosionAuthority,
} from "../shared/creeperExplosion.ts";

const authority: CreeperExplosionAuthority = {
  mobId: "creeper-5nb-b",
  epoch: 1_725_000_000_000,
  checkpointRevision: 9,
  fuseStartedTick: 40,
  explosionTick: 55,
  currentTick: 57,
  center: { x: 7.25, y: 4, z: 7.75 },
  radius: CREEPER_EXPLOSION_RADIUS,
};
const operationId = creeperExplosionEventId(authority);
const raw = JSON.stringify({
  operationId,
  mobId: authority.mobId,
  epoch: authority.epoch,
  checkpointRevision: authority.checkpointRevision,
  fuseStartedTick: authority.fuseStartedTick,
});
const request = validateCreeperExplosionRequestJson(raw);
assert.ok(request);
const accepted = authorizeCreeperExplosionRequest(request, authority);
assert.equal(accepted.ok, true);
assert.equal(validateCreeperExplosionRequestJson(JSON.stringify({ ...JSON.parse(raw), center: authority.center })), null,
  "a client cannot supply an explosion center");
assert.equal(validateCreeperExplosionRequestJson(JSON.stringify({ ...JSON.parse(raw), radius: 20 })), null,
  "a client cannot supply a radius");
assert.equal(authorizeCreeperExplosionRequest({ ...request, checkpointRevision: 8 }, authority).ok, false);
assert.equal(authorizeCreeperExplosionRequest({ ...request, fuseStartedTick: 39 }, authority).ok, false);
assert.equal(authorizeCreeperExplosionRequest(request, { ...authority, currentTick: 76 }).ok, false,
  "old fuse claims expire deterministically");

const cells = enumerateCreeperExplosionBlocks(authority);
assert.ok(cells.length > 0 && cells.length <= CREEPER_EXPLOSION_MAX_BLOCKS);
assert.deepEqual(cells, enumerateCreeperExplosionBlocks(authority), "blast cell order is replay-stable");
assert.ok(cells.every((cell, index) => index === 0 || cells[index - 1].distanceSquared <= cell.distanceSquared));
const chunks = new Set(cells.map((cell) => `${Math.floor(cell.x / 8)}:${Math.floor(cell.z / 8)}`));
assert.ok(chunks.size <= 4, "a radius-three boundary blast touches at most four compact chunks");

const planned = planCreeperTerrainDestruction(authority, (cell) =>
  cell.coordKey === cells[0].coordKey ? "chest"
    : cell.coordKey === cells[1].coordKey ? "furnace"
      : cell.coordKey === cells[2].coordKey ? "bed" : "stone");
assert.equal(planned.some(({ previousBlock }) => previousBlock === "chest" || previousBlock === "furnace" || previousBlock === "bed"), false,
  "interactive side-state blocks remain protected until their contents can be conserved");
assert.ok(planned.length <= CREEPER_EXPLOSION_MAX_BLOCKS);

assert.ok(resolveCreeperExplosionDamage(authority, authority.center) > 0);
assert.equal(resolveCreeperExplosionDamage(authority, { x: 100, y: 4, z: 100 }), 0);
assert.equal(resolveCreeperExplosionDamage(authority, authority.center, 0), 0);

if (!accepted.ok) throw new Error("unreachable");
assert.equal(decideCreeperExplosionCommit(null, accepted.fingerprint), "commit");
assert.equal(decideCreeperExplosionCommit(accepted.fingerprint, accepted.fingerprint), "replay");
assert.equal(decideCreeperExplosionCommit("forged", accepted.fingerprint), "event_collision");

console.log(JSON.stringify({
  benchmark: "bounded authoritative creeper blast plan",
  candidateBlocks: cells.length,
  affectedChunks: chunks.size,
  requestBytes: raw.length,
}));
console.log("lakecraft creeper explosion authority tests: ok");
