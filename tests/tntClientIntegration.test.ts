import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

assert.doesNotMatch(multiplayer, /igniteTnt|claimTntExplosion|tntFuses/,
  "Railway worlds cannot run TNT authority through Lakebed");
assert.match(singleplayer, /target\.block\.block !== BLOCK\.TNT/);
assert.match(singleplayer, /primeLocalTnt\(x, y, z, TNT_FUSE_MS/);
assert.match(engine, /setPrimedTntFuses/);

console.log("TNT authority boundary tests passed");
