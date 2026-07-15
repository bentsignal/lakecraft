import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

assert.ok(client.includes('useMutation<[], AuthorizeRespawnResult>("authorizeRespawn")'));
assert.equal(client.includes("teleportEpoch: string"), false);

const authorization = client.slice(
  client.indexOf("function requestAuthorizedRespawn"),
  client.indexOf("function scheduleAuthorizedRespawn"),
);
assert.ok(authorization.includes("void authorizeRespawn().then((result) =>"));
assert.ok(authorization.indexOf("if (!result.ok)") < authorization.indexOf("engine.respawn()"));
assert.ok(authorization.includes("validateRespawnPoint(result.target, Number.MAX_SAFE_INTEGER)"));
assert.ok(authorization.includes("const expiresAt = Number(result.expiresAt)"));
assert.equal(authorization.includes("expiresAt <= Date.now()"), false, "an already-committed respawn is not rejected by client clock skew");
assert.equal(authorization.includes("pendingRespawnAuthorizationRef.current"), false);

const deathFlow = client.slice(
  client.indexOf("onPlayerHealthChange: (health) =>"),
  client.indexOf("onBlockEdit: handleBlockEdit"),
);
assert.ok(deathFlow.includes("scheduleAuthorizedRespawn()"));
assert.equal(deathFlow.includes("engineRef.current?.respawn()"), false);

assert.equal(client.includes("pendingRespawnAuthorizationRef"), false);
assert.ok(authorization.includes("result.retryAfterMs ?? 2_000"));
assert.ok(authorization.includes("requestAuthorizedRespawn();"));
assert.ok(client.includes("preserveInitialPose: Boolean(resumedPresencePose)"));
assert.ok(engine.includes("if (!options.preserveInitialPose)"));
assert.ok(engine.includes("if (playerHealth <= 0)"), "dead players are frozen while Lakebed authorizes respawn");
assert.ok(engine.includes("reconcilePose(nextPose)"));

console.log("server-authorized respawn client integration source tests passed");
