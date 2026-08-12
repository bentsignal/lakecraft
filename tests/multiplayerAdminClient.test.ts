import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeRealtimeGameMode } from "../client/realtimeMultiplayer.ts";

assert.equal(decodeRealtimeGameMode("creative"), "creative");
assert.equal(decodeRealtimeGameMode("survival"), "survival");
assert.equal(decodeRealtimeGameMode(undefined), "survival");
assert.equal(decodeRealtimeGameMode("operator"), "survival");

const transport = readFileSync(new URL("../client/RealtimeMultiplayerTransport.tsx", import.meta.url), "utf8");
assert.match(transport, /onGameMode: \(gameMode: RealtimeGameMode\) => void/);
assert.match(transport, /propsRef\.current\.onGameMode\(gameMode\)/);

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const presentation = readFileSync(new URL("../client/gameplay/presentation.ts", import.meta.url), "utf8");
assert.match(presentation, /canCreativeFly: \(\) => context\.getGameMode\(\) === "creative"/);
assert.match(client, /getGameMode: \(\) => realtimeGameModeRef\.current/);
assert.match(presentation, /canTakePlayerDamage: \(\) => context\.getGameMode\(\) === "survival"/);
assert.match(client, /creativeInventory=\{Boolean\(realtimeSession\) && realtimeGameMode === "creative"\}/);
assert.match(client, /showSurvivalStatus=\{realtimeGameMode !== "creative"\}/);
assert.match(client, /if \(realtimeGameModeRef\.current === "creative"\) return true;/,
  "Creative catalog changes stay local instead of forging Lakebed survival inventory actions");

console.log("multiplayer admin/Creative client gates: ok");
