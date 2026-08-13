import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engineBoundary = readFileSync(new URL("../client/gameplay/engine.ts", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

for (const retired of ["checkpointMobWorld", "claimMobPlayerDamage", "mobWorldAuthority", "MultiplayerSegmentTransport"]) {
  assert.equal(multiplayer.includes(retired), false, `${retired} cannot remain in Railway multiplayer`);
}
assert.match(engineBoundary, /simulateMobs: authority\.capabilities\.localSimulation/);
assert.match(engine, /if \(options\.simulateMobs === false\) return/);
assert.match(engine, /applyMobMotionSnapshot\(poses: readonly MobMotionPose\[]/);

console.log("mob simulation authority boundary tests passed");
