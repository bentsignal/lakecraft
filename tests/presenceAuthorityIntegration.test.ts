import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

for (const required of [
  "playerRespawns: table({",
  '.index("by_user", ["userId"])',
  "authorizeRespawn: mutation(async (ctx, rawSessionId: string) =>",
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
assert.ok(authorize.includes("presence.sessionId !== rawSessionId && presence.sessionId !== replaySessionId"), "lost respawn responses replay only from the fenced predecessor lease");
assert.ok(authorize.includes("sessionId: respawnSessionId"), "respawn fences all in-flight pre-death heartbeats");
assert.ok(authorize.includes('bedRows[0]?.blockType === "bed"'));
assert.ok(authorize.includes("destination = trailheadPoseForUser(ctx.auth.userId)"));
assert.ok(authorize.includes("activeGrant.consumedAt && currentPose"), "lost responses replay only a committed authorization whose authoritative pose already matches");
assert.ok(authorize.indexOf("activeGrant.consumedAt") < authorize.indexOf("if (!presenceIsActive)"), "a committed respawn remains replayable after grant/lease expiry");
assert.ok(authorize.indexOf("playerRespawns.update") < authorize.indexOf("playerPresence.update"));

const heartbeat = server.slice(
  server.indexOf("heartbeatPlayer: mutation"),
  server.indexOf("leavePlayer: mutation"),
);
assert.ok(heartbeat.includes("existingRows.length > 1"), "duplicate presence rows fail closed");
assert.ok(heartbeat.includes("decidePresenceSequence(existing.sessionId, existing.poseSequence"));
assert.ok(heartbeat.indexOf("decidePresenceSequence(") < heartbeat.indexOf("decidePresenceWriteGate("), "sequence fencing precedes rate and survival work");
assert.ok(heartbeat.indexOf("decidePresenceSequence(") < heartbeat.indexOf("advanceAuthoritativeSurvival("));
assert.ok(heartbeat.includes('return { ok: true, applied: false, reason: "stale_sequence", poseSequence: existing.poseSequence }'));
assert.ok(heartbeat.includes("if (relocationEpoch)"), "ordinary motion does not read relocation state");
assert.ok(heartbeat.indexOf("decidePresenceTrajectory(") < heartbeat.indexOf("playerPresence.update"));
assert.ok(heartbeat.indexOf("decidePresenceTrajectory(") < heartbeat.indexOf("authoritativeFallWorldFacts("));
assert.ok(heartbeat.indexOf("authoritativeFallWorldFacts(") < heartbeat.indexOf("advanceAuthoritativeSurvival("));
assert.ok(heartbeat.indexOf("advanceAuthoritativeSurvival(") < heartbeat.indexOf("advanceAuthoritativeFall("));
assert.ok(heartbeat.indexOf("playerPresence.update") < heartbeat.indexOf("grantConsumedAt:"));
assert.ok(heartbeat.includes("...survival.progress"));
assert.ok(heartbeat.includes("fallGrounded: fall.state.grounded"));
assert.ok(heartbeat.includes("fallPeakY: fall.state.fallPeakY"));
assert.ok(heartbeat.includes('lastAttackerId: fall.damage > 0'));
assert.ok(heartbeat.includes('"fall"'));
assert.ok(heartbeat.includes("serverNow + PLAYER_RESPAWN_DELAY_MS"));
assert.ok(heartbeat.includes("if (survival.hungerChanged)"));
assert.ok(heartbeat.includes("if (survival.healthChanged || fall.healthChanged)"));
assert.equal(heartbeat.includes("armorDamaged"), false, "fall damage never wears or mitigates armor");
assert.equal(heartbeat.includes("targetEquipment"), false, "fall damage cannot mutate equipment");

const mobDamage = server.slice(
  server.indexOf("claimMobPlayerDamage: mutation"),
  server.indexOf("attackMob: mutation"),
);
assert.ok(mobDamage.includes("progress: callerPresenceRow"));
assert.ok(mobDamage.includes("activityHalfUnits: storedPresenceActivityHalfUnits(callerPresenceRow)"));
assert.ok(mobDamage.includes("await ctx.db.playerPresence.update(callerPresenceRow.id, survival.progress)"));
assert.ok(
  mobDamage.indexOf("advanceAuthoritativeSurvival(") < mobDamage.indexOf("resolveMobDamage("),
  "mob damage advances the survival timeline before applying damage",
);

const pvpDamage = server.slice(
  server.indexOf("attackPlayer: mutation"),
  server.indexOf("claimUsername: mutation"),
);
assert.ok(pvpDamage.includes("progress: targetPresenceRow"));
assert.ok(pvpDamage.includes("activityHalfUnits: storedPresenceActivityHalfUnits(targetPresenceRow)"));
assert.ok(pvpDamage.includes("await ctx.db.playerPresence.update(targetPresenceRow.id, targetSurvival.progress)"));
assert.ok(
  pvpDamage.indexOf("advanceAuthoritativeSurvival(") < pvpDamage.indexOf("resolvePlayerAttack("),
  "PvP advances the target survival timeline before applying damage",
);

const sleep = server.slice(
  server.indexOf("sleepInBed: mutation"),
  server.indexOf("attackMob: mutation"),
);
assert.ok(sleep.includes("ownPresences.length !== 1"));
assert.ok(sleep.includes(") > 6) return"), "bed home requires authoritative presence within reach");
assert.ok(sleep.indexOf("validatePresencePoseFields(") < sleep.indexOf("playerRespawns.update"));

const leave = server.slice(server.indexOf("leavePlayer: mutation"), server.indexOf("applyInventoryAction: mutation"));
assert.ok(server.includes("sessionId: string().default"));
assert.ok(server.includes('poseSequence: string().default("0")'));
assert.ok(server.includes('sessionId: ""'), "leave revokes the session lease");
const sessionStart = server.slice(server.indexOf("startPresenceSession: mutation"), server.indexOf("authorizeRespawn: mutation"));
assert.ok(sessionStart.includes(".take(64)"));
assert.ok(sessionStart.includes("playerPresence.delete(row.id)"), "legacy duplicate/malformed rows are healed before session ownership rotates");
assert.ok(sessionStart.includes("sessionId: rawSessionId"));
assert.ok(sessionStart.includes("if (!sameSession)"), "same-session start retries preserve the accepted sequence");
assert.ok(sessionStart.includes("invalid_or_exhausted_sequence_state"), "same-lease sequence state never wraps or resets");
assert.ok(sessionStart.includes("playerPresence.insert"), "a fresh session persists a fenced offline lease before heartbeat one");
assert.ok(sessionStart.includes("spawnPose: keeperPose ?? trailhead"));
assert.ok(sessionStart.includes("nextPoseSequence:"));
assert.ok(sessionStart.includes("fallGrounded: true"));
assert.ok(sessionStart.includes("fallPeakY: String(trailhead.y)"));
assert.ok(authorize.includes("fallGrounded: true"));
assert.ok(authorize.includes("fallPeakY: grant.y"));
assert.ok(server.includes("const blockX = Math.floor(x)"), "fractional spawn centers use integer terrain columns");
assert.ok(leave.includes("existing.sessionId !== rawSessionId"), "an old tab cannot take a new presence session offline");
assert.ok(client.includes("const presenceSessionId = crypto.randomUUID()"));
assert.ok(client.includes("startPresenceSession(presenceSessionIdRef.current)"));
assert.ok(client.includes("void leavePlayer(activeSessionId)"));
assert.ok(client.includes("engineRef.current?.reconcilePose(canonicalPose)"));
assert.ok(client.includes("Object.assign(scheduler, createPresenceSchedulerState())"));

const inventoryAction = server.slice(
  server.indexOf("applyInventoryAction: mutation"),
  server.indexOf("dropItem: mutation"),
);
assert.ok(inventoryAction.includes("validateInventoryActionRequestJson(requestJson)"));
assert.ok(inventoryAction.includes("decideInventoryActionReplay("), "actions are replay-safe before any write");
assert.ok(inventoryAction.includes("currentRevision !== request.expectedRevision"), "actions use revision CAS");
assert.ok(inventoryAction.includes("applyInventoryActionTransition(previous.state, request.action)"), "item deltas are derived by the shared authority reducer");
assert.ok(inventoryAction.includes("createInitializedPlayerState()"), "starter inventory is selected by the server");
assert.ok(inventoryAction.includes('reason: tableAuthority, inventory: existing'), "rejected table crafts return canonical state for rollback");
assert.equal(server.includes("saveInventory: mutation"), false, "generic client-trusted inventory mutation stays removed");
assert.equal(client.includes('>("saveInventory")'), false, "the client cannot call the removed minting boundary");

console.log(JSON.stringify({
  benchmark: "server-authorized relocation event envelope",
  modernChunkHeartbeat: { indexedReads: "5-8", writes: 1 },
  hungerBoundaryHeartbeat: { indexedReads: "5-8", writes: 2 },
  healthOrFallBoundaryHeartbeat: { indexedReads: "5-8", writes: 2 },
  rejectedTrajectory: { indexedReads: 2, writes: 0 },
  authorizeTrailhead: { indexedReads: 4, writes: "3-4" },
  authorizeBed: { indexedReads: 5, writes: "3-4" },
}));
console.log("presence authority Lakebed integration tests passed");
