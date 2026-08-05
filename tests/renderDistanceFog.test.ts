import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TERRAIN_VERTEX_SHADER,
  VERTEX_SHADER,
  writeRenderDistanceFogRange,
} from "../client/game/voxelEngine.ts";

const range = new Float32Array(2);
assert.equal(writeRenderDistanceFogRange(range, 6), range, "fog range reuses caller storage");
assert.ok(Math.abs(range[0] - 36.8) < 0.001, "six chunks remain clear through most of the loaded radius");
assert.equal(range[1], 46, "six-chunk fog finishes two blocks before the nearest loaded edge");

writeRenderDistanceFogRange(range, 12);
assert.equal(range[0], 78, "twelve chunks expose substantially more terrain before fading");
assert.equal(range[1], 94, "twelve-chunk fog tracks the expanded loaded edge");

writeRenderDistanceFogRange(range, 2);
assert.equal(range[0], 6, "the minimum radius retains a full-chunk fade");
assert.equal(range[1], 14, "minimum-radius fog still hides the void edge");

writeRenderDistanceFogRange(range, Number.NaN);
assert.deepEqual([...range], [14, 22], "invalid values fall back to the bounded engine radius");

for (const shader of [VERTEX_SHADER, TERRAIN_VERTEX_SHADER]) {
  assert.match(shader, /uniform vec2 uFogRange/);
  assert.match(shader, /smoothstep\(uFogRange\.x,uFogRange\.y/);
  assert.doesNotMatch(shader, /smoothstep\(18\.,42\./, "fog is no longer fixed to the old short range");
}

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engine, /writeRenderDistanceFogRange\(fogRange, streamingChunkRadius\)/,
  "every frame derives fog from the live radius changed by Options");
assert.match(engine, /fogRange\[1\] \+ WORLD_CHUNK_SIZE/,
  "the camera far plane extends beyond the fog at large radii");
assert.match(engine, /uniform2fv\(terrainFogRangeLocation, fogRange\)/);
assert.match(engine, /uniform2fv\(fogRangeLocation, fogRange\)/);

console.log("render-distance-scaled fog tests passed");
