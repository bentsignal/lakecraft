import assert from "node:assert/strict";
import {
  canSleepAtPhase,
  respawnPointForBed,
  respawnPointMatchesBed,
  singlePlayerWorldSpawn,
} from "../client/singleplayer/localBed.ts";
import { terrainHeight } from "../client/game/terrain.ts";

assert.equal(canSleepAtPhase(0), true, "midnight is sleepable");
assert.equal(canSleepAtPhase(0.699999), false, "daytime is not sleepable");
assert.equal(canSleepAtPhase(0.7), true, "sunset starts the sleep window");
assert.equal(canSleepAtPhase(0.179999), true, "late night remains sleepable");
assert.equal(canSleepAtPhase(0.18), false, "dawn ends the sleep window");
assert.equal(canSleepAtPhase(-0.1), true, "wrapped night phases stay sleepable");
assert.equal(canSleepAtPhase(Number.NaN), false);

const bed = respawnPointForBed(12, 7, -4, Math.PI / 2);
assert.deepEqual(bed, { x: 12.5, y: 8.02, z: -3.5, yaw: Math.PI / 2, pitch: -0.08 });
assert.equal(respawnPointMatchesBed(bed, 12, 7, -4), true);
assert.equal(respawnPointMatchesBed(bed, 12, 7, -3), false);

const worldSpawn = singlePlayerWorldSpawn(7_319);
assert.deepEqual(worldSpawn, {
  x: 0.5,
  y: terrainHeight(0, 0, 7_319) + 1.02,
  z: 0.5,
  yaw: 0,
  pitch: -0.08,
});

console.log("lakecraft single-player bed tests: ok");
