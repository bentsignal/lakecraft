import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const realtime = readFileSync(new URL("../client/realtimeMultiplayer.ts", import.meta.url), "utf8");
const world = readFileSync(new URL("../apps/game-server/src/world.ts", import.meta.url), "utf8");

for (const retired of ["heartbeatPlayer", "startPresenceSession", "leavePlayer", "presenceSessionIdRef"]) {
  assert.equal(multiplayer.includes(retired), false, `${retired} cannot compete with Railway presence`);
}
assert.match(realtime, /type: "input"/);
assert.match(realtime, /onReconcilePose/);
assert.match(world, /handleInput|lastInputSeq/);

console.log("Railway presence authority integration tests passed");
