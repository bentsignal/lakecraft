import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const localDrops = readFileSync(new URL("../client/singleplayer/localDroppedItems.ts", import.meta.url), "utf8");

assert.match(multiplayer, /deathScreenOpen=\{deathScreenOpen\}/);
assert.match(multiplayer, /onRespawn=\{requestRailwayRespawn\}/);
assert.doesNotMatch(multiplayer, /authorizeRespawn|scheduleAuthorizedRespawn|heartbeatPlayer/,
  "Railway sessions cannot use the retired Lakebed death/presence authority");
assert.match(singleplayer, /planDeathDrops\([\s\S]*engine\.setDroppedItems\(dropsRef\.current\)/);
assert.match(localDrops, /addItemStack\(nextInventory, drop\.item\)/);

console.log("death/drop gameplay authority tests passed");
