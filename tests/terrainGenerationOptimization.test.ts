import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { chunkWindow } from "../client/game/chunks.ts";
import { createTerrain, createTerrainChunk } from "../client/game/terrain.ts";
import type { BlockId } from "../client/game/types.ts";

function orderedMapDigest(blocks: ReadonlyMap<string, BlockId>): string {
  const hash = createHash("sha256");
  for (const [coordinate, block] of blocks) hash.update(`${coordinate}=${block};`);
  return hash.digest("hex");
}

// Ordered-map fingerprints cover spawn blending, negative seams, far
// coordinates, and every intentional deterministic material-layer change.
const chunkSnapshots = [
  { coordinate: [0, 0], size: 2_079, sha256: "b9b314842fcdc4daf5fff2b4bb0e4a6a537ae5684a7dd9a9896628f517ac63cc" },
  { coordinate: [1, -1], size: 2_165, sha256: "34fce5781cf2202bb6aaa07b8ce04f1c4c9233d89ed7abef675684b652bace2a" },
  { coordinate: [-4, 3], size: 1_750, sha256: "9004f411e5e3eb6e66000ce55a609657089121f5789f6acae863439ab654aa03" },
  { coordinate: [25_000, -25_000], size: 1_839, sha256: "d192ff58101388cf9e815bc266f217487faec837c78a05ccf56affa3efc7171f" },
  { coordinate: [-25_003, 24_998], size: 2_084, sha256: "2aaf902b76e60def04258b3dac440e4eda429e7ef58fbdc4b0dbf246964ab2b4" },
] as const;

for (const snapshot of chunkSnapshots) {
  const [chunkX, chunkZ] = snapshot.coordinate;
  const first = createTerrainChunk(7_319, chunkX, chunkZ);
  const second = createTerrainChunk(7_319, chunkX, chunkZ);
  assert.equal(first.size, snapshot.size);
  assert.equal(orderedMapDigest(first), snapshot.sha256,
    `chunk ${chunkX},${chunkZ} preserves every expected block and insertion position`);
  assert.deepEqual([...second], [...first], `chunk ${chunkX},${chunkZ} remains exactly deterministic`);
}

const eager = createTerrain(7_319, 20);
assert.equal(eager.size, 16_005);
assert.equal(
  orderedMapDigest(eager),
  "ac624ab0bbe9d2d99266bc34c2af5b4f74ce7d18f29d74227b516544b748787d",
  "the eager compatibility generator preserves its complete expected ordered map",
);

const farWindow = chunkWindow(8 * 25_000, 8 * -25_000);
const timings: number[] = [];
for (let run = 0; run < 3; run += 1) {
  const startedAt = performance.now();
  let blockCount = 0;
  for (const coordinate of farWindow) {
    blockCount += createTerrainChunk(7_319, coordinate.x, coordinate.z).size;
  }
  timings.push(performance.now() - startedAt);
  assert.equal(blockCount, 94_376, "the exact performance window preserves its clay-aware output count");
}

console.log(JSON.stringify({
  benchmark: "optimized terrain generation equivalence",
  farWindowChunks: farWindow.length,
  repeatedGenerationMs: timings.map((value) => Number(value.toFixed(2))),
  snapshotChunks: chunkSnapshots.length,
}));
console.log("lakecraft terrain generation optimization equivalence tests: ok");
