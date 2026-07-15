import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");

const respawnStart = server.indexOf("authorizeRespawn: mutation");
const respawnEnd = server.indexOf("heartbeatPlayer: mutation", respawnStart);
assert.ok(respawnStart >= 0 && respawnEnd > respawnStart, "authoritative respawn mutation exists");
const respawn = server.slice(respawnStart, respawnEnd);

const replayFence = respawn.indexOf("if (activeGrant)");
const deathGate = respawn.indexOf('combatRow.health !== "0"');
const settlement = respawn.indexOf("const deathPlan = planDeathDrops");
const firstWrite = respawn.indexOf("ctx.db.playerRespawns.update");
assert.ok(replayFence >= 0 && deathGate > replayFence && settlement > deathGate,
  "death settlement runs only after active-grant replay and authoritative death gates");
assert.ok(firstWrite > settlement, "the full death settlement is preflighted before any respawn write");

assert.match(respawn, /validatePresencePoseFields\(\s*presence\.x,\s*presence\.y,\s*presence\.z/,
  "drop placement uses server-stored presence rather than a client pose payload");
assert.match(respawn, /by_owner_expiry[\s\S]*canCreateDroppedItem/,
  "bounded owned-row capacity is checked before clearing carried state");
assert.match(respawn, /createPersistedDroppedItem\([\s\S]*drop\.operationId[\s\S]*drop\.position/,
  "stable settlement operation ids create deterministic dropped-item rows");
assert.match(respawn, /inventory: deathPlan\.carriedState\.inventory/);
assert.match(respawn, /equipment: deathPlan\.carriedState\.equipment/);
assert.match(respawn, /for \(const row of deathDropRows\)[\s\S]*ctx\.db\.droppedItems\.insert\(row\)/,
  "inventory clear and all conserved rows are committed by the same Lakebed mutation");

const heartbeatStart = server.indexOf("heartbeatPlayer: mutation");
const heartbeatEnd = server.indexOf("leavePlayer: mutation", heartbeatStart);
const heartbeat = server.slice(heartbeatStart, heartbeatEnd);
assert.match(heartbeat, /if \(combat\.health === 0\)[\s\S]*reason: "dead_pose_locked"/,
  "dead players retain their last authoritative presence pose until settlement");
assert.ok(heartbeat.indexOf("if (combat.health === 0)") < heartbeat.indexOf("authoritativeFallWorldFacts"),
  "dead movement is frozen before proposed movement can affect world/fall authority");

assert.ok(!client.includes("scheduleAuthorizedRespawn"), "death never starts an automatic mutation retry loop");
assert.match(client, /deathScreenOpen=\{deathScreenOpen\}/);
assert.match(client, /onRespawn=\{requestAuthorizedRespawn\}/);
assert.match(client, /setDeathScreenOpen\(true\)[\s\S]*exitPointerLockForUi\(\)/,
  "authoritative death opens the blocking UI and releases the pointer");
assert.match(singleplayer, /planDeathDrops\([\s\S]*engine\.setDroppedItems\(dropsRef\.current\)/,
  "single-player uses the same pure settlement and retains the resulting world drops");
assert.match(singleplayer, /addItemStack\(nextInventory, drop\.item\)/,
  "single-player world drops can be picked back up with exact durability metadata");
assert.match(singleplayer, /dropsRef\.current\.length \+ plan\.drops\.length > 256/,
  "single-player fails closed instead of deleting old world loot at its local row cap");

console.log("authoritative death settlement integration checks passed");
