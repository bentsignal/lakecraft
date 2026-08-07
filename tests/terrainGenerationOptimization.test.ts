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
  { coordinate: [0, 0], size: 4_465, sha256: "60489766bfb7f0d8ffaac07b15c62421a6c6945c84c232c6ec2319409ca0af43" },
  { coordinate: [1, -1], size: 4_383, sha256: "757238bd2de81fdf6a68462ecbebde9be18bed67b05c67d6bf8f00c2585d5b3e" },
  { coordinate: [-4, 3], size: 4_038, sha256: "2485d7d7890a253eaf4d4db59069395acdfd16e04ec570b01a45ac763a6fd2ba" },
  { coordinate: [25_000, -25_000], size: 4_102, sha256: "288aa30b976584560b16b842c3ea2847f79b32d50530f856e38b7889b2700627" },
  { coordinate: [-25_003, 24_998], size: 4_369, sha256: "c48613d57ee0666184fd1b56c2bb477ec3ddcc4839660b925887b19fa0bb4c46" },
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
assert.equal(eager.size, 114_337);
assert.equal(
  orderedMapDigest(eager),
  "3a5a094a814fa1d88ed899bccf5dc8d89ea5265d82ef9cb79ee665d07869b5a0",
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
  assert.equal(blockCount, 204_853, "the exact performance window preserves its shifted terrain output count");
}

console.log(JSON.stringify({
  benchmark: "optimized terrain generation equivalence",
  farWindowChunks: farWindow.length,
  repeatedGenerationMs: timings.map((value) => Number(value.toFixed(2))),
  snapshotChunks: chunkSnapshots.length,
}));
console.log("lakecraft terrain generation optimization equivalence tests: ok");
