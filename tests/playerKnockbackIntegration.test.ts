import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");

assert.match(engine, /contactDamageSources\[0\] \?\? projectileDamageSources\[0\]/);
assert.match(engine, /knockbackReceipts\.has\(eventId\)/);
assert.match(engine, /stepPlayerKnockbackAxis\(knockbackVelocity\[0\]/);
assert.match(types, /applyConfirmedMobKnockback\(eventId: string/);
assert.match(multiplayer, /engineRef\.current\?\.setPaused\(multiplayerPaused\)/);
assert.match(multiplayer, /<RealtimeMultiplayerTransport/);
assert.doesNotMatch(multiplayer, /claimMobPlayerDamage|mobWorldAuthority\.damageClaims/,
  "Railway sessions cannot accept Lakebed knockback claims");

console.log("player knockback authority boundary tests passed");
