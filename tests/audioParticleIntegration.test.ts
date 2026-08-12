import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const multiplayer = source("../client/index.tsx");
const singleplayer = source("../client/singleplayer/SinglePlayerApp.tsx");
const presentation = source("../client/gameplay/presentation.ts");
const engine = source("../client/game/voxelEngine.ts");
const engineTypes = source("../client/game/types.ts");
const particles = source("../client/game/blockParticles.ts");

for (const app of [multiplayer, singleplayer]) {
  assert.match(app, /createGameplayPresentationOptions\(/,
    "both authority adapters use one footsteps/mining/FOV presentation contract");
}
assert.match(presentation, /onFootstep: \(block\) => context\.audio\.play\("footstep"/);
assert.match(presentation, /audioSurfaceForBlock\(block\)/);
assert.match(multiplayer, /await sink\(pending\.operationId, pending\.optimisticEdit\)/);
assert.match(multiplayer, /play\("blockBreak"[\s\S]*spawnBlockParticles\(\{[\s\S]*action: "break"/,
  "Railway confirmation, not Lakebed, emits break feedback");
assert.match(singleplayer, /play\("blockBreak"[\s\S]*spawnBlockParticles\(\{ action: "break"/);
assert.match(engine, /now - lastMiningHitAt >= 225/);
assert.match(engine, /footstepDistance \+= movedHorizontally/);
assert.match(engineTypes, /onMiningHit\?:/);
assert.match(engineTypes, /onFootstep\?:/);
assert.equal((engine.match(/createBlockParticleSystem\(\)/g) ?? []).length, 1);
assert.equal((engine.match(/blockParticles\.update\(dt\)/g) ?? []).length, 1);
assert.match(engine, /gl\.deleteBuffer\(particleBuffer\)/);
assert.match(particles, /MAX_BLOCK_PARTICLES = 192/);
assert.doesNotMatch(particles, /lakebed\/|\bfetch\s*\(/);

console.log("shared audio and particle integration tests passed");
