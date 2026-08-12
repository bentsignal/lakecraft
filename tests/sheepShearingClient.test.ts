import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../client/game/mobRenderer.ts", import.meta.url), "utf8");

assert.match(engine, /mobTargetHasClickPriority\(mobTarget\.distance, target\?\.distance \?\? null\)/);
assert.match(singleplayer, /target\.kind !== "sheep"[\s\S]*itemId !== "shears"/);
assert.match(singleplayer, /applyConfirmedDurableItemUse/);
assert.match(renderer, /if \(sheared\) appendBox[\s\S]*else appendBox/);
assert.doesNotMatch(multiplayer, /shearMob|retryExactLakebedMutation/,
  "Railway multiplayer cannot invoke Lakebed sheep authority");

console.log("sheep shearing authority boundary tests passed");
