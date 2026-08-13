import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const localDrops = readFileSync(new URL("../client/singleplayer/localDroppedItems.ts", import.meta.url), "utf8");

assert.match(multiplayer, /deathScreenOpen=\{deathScreenOpen\}/);
assert.match(multiplayer, /onRespawn=\{requestRailwayRespawn\}/);
assert.match(multiplayer, /realtimeSession\?\.demo\?\.userId \?\? auth\.userId/,
  "Direct Connect owner delay uses the Railway identity, not a mismatched Lakebed account id");
assert.match(multiplayer, /window\.setInterval\(\(\) => maybePickupNearbyDroppedItem\(poseRef\.current\), 125\)/,
  "stationary players keep sweeping nearby world items after the short owner delay");
assert.doesNotMatch(multiplayer, /droppedPickupAttemptRef\.current\.set\([^\n]*POSITIVE_INFINITY/,
  "Q-drops are never permanently blacklisted from pickup in their source browser");
assert.match(multiplayer, /planDeathDrops\([\s\S]*Promise\.all\(plan\.drops\.map[\s\S]*kind: "death_settle"/,
  "Railway accepts every conserved carried stack before Lakebed persists the empty pack");
assert.doesNotMatch(multiplayer, /authorizeRespawn|scheduleAuthorizedRespawn|heartbeatPlayer/,
  "Railway sessions cannot use the retired Lakebed death/presence authority");
assert.match(singleplayer, /planDeathDrops\([\s\S]*engine\.setDroppedItems\(dropsRef\.current\)/);
assert.match(localDrops, /addItemStack\(nextInventory, drop\.item\)/);

console.log("death/drop gameplay authority tests passed");
