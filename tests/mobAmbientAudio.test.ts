import assert from "node:assert/strict";
import { localMobAmbientMix } from "../client/game/voxelEngine.ts";

assert.equal(localMobAmbientMix(0, 17, 0, 0), null, "mobs more than sixteen blocks above or below stay inaudible");
assert.ok((localMobAmbientMix(0, 12, 0, 0)?.intensity ?? 1) < (localMobAmbientMix(0, 2, 0, 0)?.intensity ?? 0));
assert.equal(localMobAmbientMix(8, 0, 0, 0)?.pan, 1, "a mob on the listener's right pans right");

console.log("local mob ambient 3D attenuation tests passed");
