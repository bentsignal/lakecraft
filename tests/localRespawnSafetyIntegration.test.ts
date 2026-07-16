import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const start = engine.indexOf("respawn() {");
const end = engine.indexOf("\n    },", start);
const respawn = engine.slice(start, end);
assert.ok(start >= 0 && end > start);

const setX = respawn.indexOf("pose.x = respawnPoint.x");
const setZ = respawn.indexOf("pose.z = respawnPoint.z");
const stream = respawn.indexOf("updateStreamingWindow(true)");
const safeY = respawn.indexOf("pose.y = resolveSafeSpawnY(");
const health = respawn.indexOf("playerHealth = PLAYER_MAX_HEALTH");
const poseCallback = respawn.indexOf("options.onPoseChange?.({ ...pose })");
const healthCallback = respawn.indexOf("options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH)");
assert.ok(setX >= 0 && setZ > setX && stream > setZ,
  "saved X/Z become the streaming center before a potentially far respawn is probed");
assert.ok(stream < safeY, "target chunks and persisted edits load before collision reads");
assert.match(respawn, /resolveSafeSpawnY\(\s*respawnPoint\.y,\s*respawnPoint\.y,/,
  "saved Y is both preference and floor so a clear underground bed is preserved");
assert.match(respawn, /\(candidateY\) => collides\(respawnPoint\.x, candidateY, respawnPoint\.z\)/,
  "the existing full player collision volume owns clearance");
assert.ok(safeY < health && health < poseCallback && poseCallback < healthCallback,
  "the safe pose is committed before one health restore and its existing callbacks");
assert.equal((respawn.match(/PLAYER_MAX_HEALTH/g) ?? []).length, 2,
  "health is assigned once and reported once");
assert.equal((respawn.match(/onPoseChange/g) ?? []).length, 1);
assert.equal((respawn.match(/onPlayerHealthChange/g) ?? []).length, 1);
assert.equal(respawn.includes("respawnPoint ="), false, "temporary collision lift never rewrites saved bed identity");
assert.ok(respawn.includes("pose.yaw = respawnPoint.yaw") && respawn.includes("pose.pitch = respawnPoint.pitch"));

const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const localRespawn = singleplayer.slice(singleplayer.indexOf("function respawnLocally"), singleplayer.indexOf("useEffect", singleplayer.indexOf("function respawnLocally")));
assert.ok(localRespawn.indexOf("planDeathDrops") < localRespawn.indexOf("engine.respawn()"),
  "collision safety does not move or bypass conserved death settlement");
assert.match(localRespawn, /engine\.getBlockAt\(bed\.x, bed\.y, bed\.z\) !== BLOCK\.BED[\s\S]*?singlePlayerWorldSpawn/,
  "a broken bed still selects deterministic world spawn before the safe engine respawn");

console.log("lakecraft collision-safe local respawn integration tests: ok");
