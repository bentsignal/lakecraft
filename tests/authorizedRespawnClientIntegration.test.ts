import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.doesNotMatch(multiplayer, /authorizeRespawn|sleepInBed|presenceSessionIdRef/,
  "Railway gameplay never asks Lakebed to authorize a world relocation");
assert.match(multiplayer, /function requestRailwayRespawn\(\)/);
assert.match(multiplayer, /const sink = realtimeRespawnSinkRef\.current/);
assert.match(multiplayer, /void sink\(\)\.then\(\(pose\) =>/);
assert.match(multiplayer, /registerRespawnSink=\{\(sink\) =>/);
assert.match(multiplayer, /onRespawn=\{requestRailwayRespawn\}/);
assert.match(engine, /if \(playerHealth <= 0\)/);
assert.match(engine, /reconcilePose\(nextPose\)/);

console.log("Railway respawn boundary tests passed");
