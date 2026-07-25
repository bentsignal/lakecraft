import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

assert.ok(client.includes('useMutation<[sessionId: string], AuthorizeRespawnResult>("authorizeRespawn")'));
assert.equal(client.includes("teleportEpoch: string"), false);

const authorization = client.slice(
  client.indexOf("function requestAuthorizedRespawn"),
  client.indexOf("function exitPointerLockForUi"),
);
assert.ok(authorization.includes("void authorizeRespawn(presenceSessionIdRef.current).then((result) =>"));
assert.ok(authorization.indexOf("if (!result.ok)") < authorization.indexOf("engine.respawn()"));
assert.ok(authorization.includes("validateRespawnPoint(result.target, Number.MAX_SAFE_INTEGER)"));
assert.ok(authorization.includes("const expiresAt = Number(result.expiresAt)"));
assert.equal(authorization.includes("expiresAt <= Date.now()"), false, "an already-committed respawn is not rejected by client clock skew");
assert.equal(authorization.includes("pendingRespawnAuthorizationRef.current"), false);

const deathFlow = client.slice(
  client.indexOf("const ownState = playerCombatResult.states.find"),
  client.indexOf("if (worldChunks?.ok)"),
);
assert.ok(deathFlow.includes("setDeathScreenOpen(true)"));
assert.ok(deathFlow.includes("exitPointerLockForUi()"));
assert.equal(deathFlow.includes("engineRef.current?.respawn()"), false);
assert.ok(deathFlow.includes("engineRef.current.setPlayerHealth(ownState.health)"), "health is reconciled absolutely from Lakebed combat state");
assert.ok(authorization.includes("loadCanonicalPlayer(result.inventory)"), "respawn hunger comes from the committed server snapshot");
assert.ok(authorization.includes("presenceSessionIdRef.current = result.sessionId"), "respawn adopts the server-rotated lease before moving");
const bedInteraction = client.slice(
  client.indexOf("if (target.block.block === BLOCK.BED)"),
  client.indexOf("chestTransferActiveRef.current = false", client.indexOf("if (target.block.block === BLOCK.BED)")),
);
assert.equal(bedInteraction.includes("setRespawnPoint"), false, "bed spawn metadata is never forged into the inventory envelope locally");
assert.equal(bedInteraction.includes("respawnPointRef.current ="), false);
assert.ok(client.includes("Lakebed confirmed this bed as your authoritative respawn point."));

assert.equal(client.includes("pendingRespawnAuthorizationRef"), false);
assert.equal(client.includes("scheduleAuthorizedRespawn"), false, "death waits for the player's Respawn click");
assert.equal(authorization.includes("requestAuthorizedRespawn();"), false, "respawn failures never create a mutation retry loop");
assert.ok(client.includes("onRespawn={requestAuthorizedRespawn}"));
assert.ok(client.includes("preserveInitialPose: Boolean(resumedPresencePose)"));
assert.ok(engine.includes("if (!options.preserveInitialPose)"));
assert.ok(engine.includes("if (playerHealth <= 0)"), "dead players are frozen while Lakebed authorizes respawn");
assert.ok(engine.includes("reconcilePose(nextPose)"));

console.log("server-authorized respawn client integration source tests passed");
