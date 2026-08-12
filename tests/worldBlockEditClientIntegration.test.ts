import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const authority = readFileSync(new URL("../client/gameplay/authority.ts", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

assert.doesNotMatch(multiplayer, /useMutation[^\n]*editWorldBlock|invokeWorldBlockEditWithOneRetry/,
  "Railway multiplayer cannot split block authority through Lakebed");
assert.match(multiplayer, /realtimeBlockSinkRef\.current/);
assert.match(multiplayer, /await sink\(pending\.operationId, pending\.optimisticEdit\)/);
assert.match(multiplayer, /engineRef\.current\?\.applyWorldEdits\(\[confirmed\]\)/);
assert.match(multiplayer, /block: pending\.previousBlock/,
  "a rejected Railway edit restores the exact optimistic predecessor");
assert.match(authority, /createRailwayGameplayAuthority[\s\S]*createAuthority\("railway"/);
assert.match(authority, /!engineOptions\.canEditBlock \|\| !engineOptions\.onBlockEdit/);
assert.match(engine, /options\.canEditBlock/);

console.log("Railway world-edit client boundary tests passed");
