import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

assert.match(engine, /raycastRemotePlayers\(eye, facing, remoteStates\.values\(\), reach\)/);
assert.match(engine, /options\.onRemotePlayerAttack\?\./);
assert.match(multiplayer, /onRemotePlayerAttack: \(target\) =>/,
  "the shared crosshair target emits one Railway attack intent");
assert.ok(multiplayer.includes("realtimePlayerAttackSinkRef.current?.")
  && multiplayer.includes("onPlayerHit={(hit) =>"),
"Railway owns the PvP receipt, target health, death, and reaction path");
assert.doesNotMatch(multiplayer, /attackPlayer|playerCombatStates|Lakebed confirmed the hit/,
  "the client cannot fall back to Lakebed PvP or emit its stale hit-confirmation toast");

console.log("player combat authority boundary tests passed");
