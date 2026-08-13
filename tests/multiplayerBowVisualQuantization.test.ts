import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const realtime = readFileSync(new URL("../client/realtimeMultiplayer.ts", import.meta.url), "utf8");
assert.doesNotMatch(multiplayer, /rangedCombat\(|begin_charge|targetKind/,
  "multiplayer bow damage cannot use the retired Lakebed combat path");
assert.match(realtime, /submitAction\(kind: MotionVisualActionKind/);
assert.match(realtime, /type: "action", seq: this\.actionSequence, kind/);
assert.match(singleplayer, /rangedChargeProfile\(intent\.chargeMs\)/);

console.log("bow visual/authority boundary tests passed");
