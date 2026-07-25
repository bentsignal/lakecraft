import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WORLD_CHUNK_SIZE } from "../client/game/chunks.ts";
import { aabbIntersectsFrustum, writeFrustumPlanes } from "../client/game/voxelEngine.ts";

function referenceIntersects(
  mvp: Float32Array,
  centerX: number,
  centerY: number,
  centerZ: number,
  extentX: number,
  extentY: number,
  extentZ: number,
): boolean {
  const planes = [
    [mvp[3] + mvp[0], mvp[7] + mvp[4], mvp[11] + mvp[8], mvp[15] + mvp[12]],
    [mvp[3] - mvp[0], mvp[7] - mvp[4], mvp[11] - mvp[8], mvp[15] - mvp[12]],
    [mvp[3] + mvp[1], mvp[7] + mvp[5], mvp[11] + mvp[9], mvp[15] + mvp[13]],
    [mvp[3] - mvp[1], mvp[7] - mvp[5], mvp[11] - mvp[9], mvp[15] - mvp[13]],
    [mvp[3] + mvp[2], mvp[7] + mvp[6], mvp[11] + mvp[10], mvp[15] + mvp[14]],
    [mvp[3] - mvp[2], mvp[7] - mvp[6], mvp[11] - mvp[10], mvp[15] - mvp[14]],
  ];
  for (const plane of planes) {
    const distance = plane[0] * centerX + plane[1] * centerY + plane[2] * centerZ + plane[3];
    const radius = Math.abs(plane[0]) * extentX + Math.abs(plane[1]) * extentY + Math.abs(plane[2]) * extentZ;
    if (distance + radius < 0) return false;
  }
  return true;
}

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const backing = new Float32Array(26).fill(99);
const planes = backing.subarray(1, 25);
assert.equal(writeFrustumPlanes(planes, identity), planes);
assert.equal(backing[0], 99);
assert.equal(backing[25], 99, "plane extraction stays inside the retained view");
assert.deepEqual(Array.from(planes), [1, 0, 0, 1, -1, 0, 0, 1, 0, 1, 0, 1, 0, -1, 0, 1, 0, 0, 1, 1, 0, 0, -1, 1]);
assert.equal(aabbIntersectsFrustum(planes, 0, 0, 0, 0.5, 0.5, 0.5), true);
assert.equal(aabbIntersectsFrustum(planes, 3, 0, 0, 0.5, 0.5, 0.5), false);
assert.equal(aabbIntersectsFrustum(planes, 1.5, 0, 0, 0.5, 0.5, 0.5), true, "an exactly tangent box remains visible");

let randomState = 0x71c4a;
const random = (): number => {
  randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
  return randomState / 0x1_0000_0000;
};
for (let matrixIndex = 0; matrixIndex < 256; matrixIndex += 1) {
  const mvp = Float32Array.from({ length: 16 }, () => (random() - 0.5) * 4);
  writeFrustumPlanes(planes, mvp);
  for (let chunkX = -3; chunkX <= 3; chunkX += 1) {
    for (let chunkZ = -3; chunkZ <= 3; chunkZ += 1) {
      const centerX = (chunkX + 0.5) * WORLD_CHUNK_SIZE;
      const centerZ = (chunkZ + 0.5) * WORLD_CHUNK_SIZE;
      const minY = -16 + Math.floor(random() * 8);
      const maxY = 30 + Math.floor(random() * 40);
      const centerY = (minY + maxY) * 0.5;
      const extentY = Math.max(0.5, (maxY - minY) * 0.5);
      assert.equal(
        aabbIntersectsFrustum(planes, centerX, centerY, centerZ, 4, extentY, 4),
        referenceIntersects(mvp, centerX, centerY, centerZ, 4, extentY, 4),
        `retained culling parity for matrix ${matrixIndex}, chunk ${chunkX},${chunkZ}`,
      );
    }
  }
}

const source = await readFile(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const predicate = source.slice(source.indexOf("function chunkIntersectsView"), source.indexOf("\n\nexport function localMobAttackIsReady"));
assert.doesNotMatch(predicate, /parseChunkKey|const planes|\[mvp\[/, "per-chunk culling has no coordinate or plane-array allocation");
assert.ok(source.includes("const frustumPlanes = new Float32Array(24)"));
assert.ok(source.includes("writeFrustumPlanes(frustumPlanes, mvp)"));
assert.ok(source.includes("centerX: (coordinate.x + 0.5) * WORLD_CHUNK_SIZE"));
assert.equal(49 * 60 * 60 * (7 + 1), 1_411_200, "the normal window avoids over 1.4M explicit culling objects per minute");

console.log("allocation-free retained frustum culling parity tests passed");
