import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../client/components/FurnaceDrawer.tsx", import.meta.url), "utf8");

assert.doesNotMatch(multiplayer, /operateFurnace|FurnaceAtResult|activeFurnaceKey/,
  "multiplayer cannot quietly route furnace state through Lakebed");
assert.match(multiplayer, /needs a Railway authority command/,
  "unsupported authoritative interactions fail explicitly");
assert.match(singleplayer, /openLocalFurnace|applyLocalFurnaceTransfer/);
assert.match(drawer, /materializeFurnace\(anchor\.state, trustedNow\)/);

console.log("furnace authority boundary tests passed");
