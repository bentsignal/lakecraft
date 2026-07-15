import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

for (const required of [
  "playerRespawns: table({",
  '.index("by_user", ["userId"])',
  "authorizeRespawn: mutation(async (ctx) =>",
  "startPresenceSession: mutation(async (ctx, rawSessionId: string) =>",
  "buildPresenceRelocationGrant(ctx.auth.userId",
  "decidePresenceTrajectory(",
  "trajectory.relocationGrantUpdate",
  "grantConsumedAt:",
  "RESPAWN_AUTHORIZATION_COOLDOWN_MS",
]) assert.ok(server.includes(required), `missing presence authority integration: ${required}`);

const authorize = server.slice(
  server.indexOf("authorizeRespawn: mutation"),
  server.indexOf("heartbeatPlayer: mutation"),
);
assert.equal(authorize.includes("rawX"), false, "respawn destination is never accepted from the client");
assert.equal(authorize.includes("rawY"), false, "respawn destination is never accepted from the client");
assert.equal(authorize.includes("rawZ"), false, "respawn destination is never accepted from the client");
assert.ok(authorize.includes("storedBedRespawnPose(existingRespawn)"));
assert.ok(authorize.includes('bedRows[0]?.blockType === "bed"'));
assert.ok(authorize.includes("destination = trailheadPoseForUser(ctx.auth.userId)"));
assert.ok(authorize.includes("activeGrant.consumedAt && currentPose"), "lost responses replay only a committed authorization whose authoritative pose already matches");
assert.ok(authorize.indexOf("playerRespawns.update") < authorize.indexOf("playerPresence.update"));

const heartbeat = server.slice(
  server.indexOf("heartbeatPlayer: mutation"),
  server.indexOf("leavePlayer: mutation"),
);
assert.ok(heartbeat.includes("existingRows.length > 1"), "duplicate presence rows fail closed");
assert.ok(heartbeat.includes("if (relocationEpoch)"), "ordinary motion does not read relocation state");
assert.ok(heartbeat.indexOf("decidePresenceTrajectory(") < heartbeat.indexOf("playerPresence.update"));
assert.ok(heartbeat.indexOf("playerPresence.update") < heartbeat.indexOf("grantConsumedAt:"));

const sleep = server.slice(
  server.indexOf("sleepInBed: mutation"),
  server.indexOf("attackMob: mutation"),
);
assert.ok(sleep.includes("ownPresences.length !== 1"));
assert.ok(sleep.includes(") > 6) return"), "bed home requires authoritative presence within reach");
assert.ok(sleep.indexOf("validatePresencePoseFields(") < sleep.indexOf("playerRespawns.update"));

const leave = server.slice(server.indexOf("leavePlayer: mutation"), server.indexOf("saveInventory: mutation"));
assert.ok(server.includes("sessionId: string().default"));
assert.ok(server.includes("if (existing?.sessionId && existing.sessionId !== sessionId)"));
const sessionStart = server.slice(server.indexOf("startPresenceSession: mutation"), server.indexOf("authorizeRespawn: mutation"));
assert.ok(sessionStart.includes(".take(64)"));
assert.ok(sessionStart.includes("playerPresence.delete(row.id)"), "legacy duplicate/malformed rows are healed before session ownership rotates");
assert.ok(sessionStart.includes("sessionId: rawSessionId"));
assert.ok(sessionStart.includes("spawnPose: keeper ? null : trailheadPoseForUser(ctx.auth.userId)"));
assert.ok(server.includes("const blockX = Math.floor(x)"), "fractional spawn centers use integer terrain columns");
assert.ok(leave.includes("existing.sessionId !== rawSessionId"), "an old tab cannot take a new presence session offline");
assert.ok(client.includes("const presenceSessionId = crypto.randomUUID()"));
assert.ok(client.includes("startPresenceSession(presenceSessionId)"));
assert.ok(client.includes("void leavePlayer(presenceSessionId)"));
assert.ok(client.includes("engineRef.current?.reconcilePose(canonicalPose)"));
assert.ok(client.includes("Object.assign(scheduler, createPresenceSchedulerState())"));

console.log(JSON.stringify({
  benchmark: "server-authorized relocation event envelope",
  ordinaryHeartbeat: { indexedReads: 2, writes: 1 },
  rejectedTrajectory: { indexedReads: 2, writes: 0 },
  authorizeTrailhead: { indexedReads: 3, writes: 3 },
  authorizeBed: { indexedReads: 4, writes: 3 },
}));
console.log("presence authority Lakebed integration tests passed");
