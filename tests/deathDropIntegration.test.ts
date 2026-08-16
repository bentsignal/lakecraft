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
const settlement = multiplayer.slice(multiplayer.indexOf("function settleRealtimeDeath"),multiplayer.indexOf("function requestRailwayRespawn"));
assert.match(settlement, /enqueueInventoryAction\(\{ kind: "death_settle", eventId \}\)/,
  "the browser asks Railway to derive and atomically settle the canonical death pack");
assert.doesNotMatch(settlement, /planDeathDrops|realtimeDropSinkRef|drop\.stack/,
  "the multiplayer browser never enumerates or submits client-authored death stacks");
assert.doesNotMatch(multiplayer, /authorizeRespawn|scheduleAuthorizedRespawn|heartbeatPlayer/,
  "Railway sessions cannot use the retired Lakebed death/presence authority");
assert.match(singleplayer, /planDeathDrops\([\s\S]*engine\.setDroppedItems\(dropsRef\.current\)/);
assert.match(localDrops, /addItemStack\(nextInventory, drop\.item\)/);

console.log("death/drop gameplay authority tests passed");
