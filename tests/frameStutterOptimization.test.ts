import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  packedBlockKey,
  writeBlockKeyCoordinates,
  writePackedBlockKeyCoordinates,
} from "../client/game/voxelEngine.ts";

const output = new Int32Array(3);
assert.deepEqual([...writeBlockKeyCoordinates("0,64,0", output)], [0, 64, 0]);
assert.deepEqual([...writeBlockKeyCoordinates("-128,-7,2048", output)], [-128, -7, 2048]);
assert.deepEqual([...writeBlockKeyCoordinates("2147483647,-2147483648,9", output)], [2147483647, -2147483648, 9]);
for (const malformed of ["1,2", "1,2,3,4", "1,,3", "x,2,3"]) {
  assert.throws(() => writeBlockKeyCoordinates(malformed, output), /Invalid block key/);
}
for (const coordinate of [[0, 64, 0], [-1_000_000, 1, 1_000_000], [1_000_000, 192, -1_000_000]] as const) {
  const key = packedBlockKey(...coordinate);
  assert.ok(Number.isSafeInteger(key));
  assert.deepEqual([...writePackedBlockKeyCoordinates(key, output)], [...coordinate]);
}

const sourcePath = fileURLToPath(new URL("../client/game/voxelEngine.ts", import.meta.url));
const source = readFileSync(sourcePath, "utf8");
const rebuild = source.slice(source.indexOf("function rebuildChunkMesh"), source.indexOf("function disposeChunkMesh"));
assert.ok(rebuild.includes("writePackedBlockKeyCoordinates(packedKey, blockCoordinateScratch)"), "chunk rebuild should decode numeric keys into retained scratch");
assert.ok(!rebuild.includes('split(",").map(Number)'), "chunk rebuild must not allocate arrays while parsing every block key");
assert.ok(!rebuild.includes("new Float32Array(textureVertices)"), "chunk rebuild must not allocate exact-size upload arrays");
assert.match(source, /const chunkTextureVertices: number\[\] = \[\];[\s\S]*const chunkUploadScratch = Array\.from/);
assert.match(source, /const blocks = new Map<number, BlockId>\(\)/);
assert.match(source, /gl\.bufferData\(gl\.ARRAY_BUFFER, values\.length \* Float32Array\.BYTES_PER_ELEMENT, gl\.STATIC_DRAW\);\s*gl\.bufferSubData/);

console.log("frame stutter optimization tests passed");
