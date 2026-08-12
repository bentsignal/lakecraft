import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const remote = readFileSync(new URL("../client/game/remotePlayerRenderer.ts", import.meta.url), "utf8");

assert.doesNotMatch(multiplayer, /rangedCombat|retryExactLakebedMutation|playerCombatStates/,
  "Railway multiplayer cannot send combat to Lakebed");
assert.match(singleplayer, /onRangedRelease: \(intent\)/);
assert.match(singleplayer, /rangedChargeProfile\(intent\.chargeMs\)/);
assert.match(engine, /createPlayerProjectileRenderer\(gl\)/);
assert.match(engine, /onRangedRelease\?\.\(intent\)/);
assert.match(remote, /remoteHeldItemGeometry\(itemId, state\.bowDrawing\)/);

console.log("ranged combat authority boundary tests passed");
