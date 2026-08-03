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
  { coordinate: [0, 0], size: 2_079, sha256: "77cc28f1b82a7314fd4910258a37e467206315e8f45861ba16efb396b0fb46c7" },
  { coordinate: [1, -1], size: 2_165, sha256: "5ebd39938ea206770c39b19d20fb1d8c330cad35cc0c700dc9353d1b1c50d114" },
  { coordinate: [-4, 3], size: 1_750, sha256: "5982e347526514903865cafb9f93cce489f5e0d798c9a2d7b92cbcf8f7f62208" },
  { coordinate: [25_000, -25_000], size: 1_839, sha256: "4713d3a78b76d2a20345a8cc38e54c35a95e5733a26e478714567ed178ac550b" },
  { coordinate: [-25_003, 24_998], size: 2_084, sha256: "bfe64b35670a6ee68628faeffef8dbb03dc998563b06f27c6e1f265f8a0b8290" },
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
assert.equal(eager.size, 53_985);
assert.equal(
  orderedMapDigest(eager),
  "8d70f3c6b50db24c44673de104d84a76b456bc5d20e9fbbce3d68a635df88703",
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
  assert.equal(blockCount, 94_377, "the exact performance window preserves its translated bedrock output count");
}

console.log(JSON.stringify({
  benchmark: "optimized terrain generation equivalence",
  farWindowChunks: farWindow.length,
  repeatedGenerationMs: timings.map((value) => Number(value.toFixed(2))),
  snapshotChunks: chunkSnapshots.length,
}));
console.log("lakecraft terrain generation optimization equivalence tests: ok");
