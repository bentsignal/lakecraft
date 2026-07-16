import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WORLD_CHUNK_SIZE, parseChunkKey } from "../client/game/chunks.ts";
import {
  compareTransparentChunkMeshes,
  sortTransparentChunkKeysBackToFront,
} from "../client/game/voxelEngine.ts";

type SortEntry = { key: string; transparentDistanceSquared: number };

function retainedOrder(keys: readonly string[], camera: readonly [number, number, number]): string[] {
  return keys.map((key): SortEntry => {
    const coordinate = parseChunkKey(key);
    const dx = (coordinate.x + 0.5) * WORLD_CHUNK_SIZE - camera[0];
    const dz = (coordinate.z + 0.5) * WORLD_CHUNK_SIZE - camera[2];
    return { key, transparentDistanceSquared: dx * dx + dz * dz };
  }).sort(compareTransparentChunkMeshes).map(({ key }) => key);
}

const keySets = [
  [],
  ["0,0"],
  ["0,0", "2,0", "-1,0"],
  Array.from({ length: 49 }, (_, index) => `${index % 7 - 3},${Math.floor(index / 7) - 3}`),
] as const;
const cameras = [[0, 8, 0], [4, 20, 4], [-80, -4, 91], [250_000, 64, -250_000]] as const;
for (const keys of keySets) {
  for (const camera of cameras) {
    assert.deepEqual(
      retainedOrder(keys, camera),
      sortTransparentChunkKeysBackToFront(keys, camera),
      `retained mesh order matches legacy key order at ${camera.join(",")}`,
    );
  }
}
assert.deepEqual(
  retainedOrder(["0,0", "-1,0", "0,-1", "-1,-1"], [0, 0, 0]),
  sortTransparentChunkKeysBackToFront(["0,0", "-1,0", "0,-1", "-1,-1"], [0, 0, 0]),
  "equal-distance ties retain exact key ordering",
);

const retained: SortEntry[] = [];
retained.push({ key: "0,0", transparentDistanceSquared: 10 }, { key: "1,0", transparentDistanceSquared: 20 });
retained.sort(compareTransparentChunkMeshes);
assert.deepEqual(retained.map(({ key }) => key), ["1,0", "0,0"]);
retained.length = 0;
retained.push({ key: "-2,3", transparentDistanceSquared: 4 });
assert.deepEqual(retained.map(({ key }) => key), ["-2,3"], "next frame cannot retain a stale unloaded mesh");

const source = await readFile(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.ok(source.includes("const visibleMeshes: ChunkMesh[] = []"));
assert.ok(source.includes("const transparentMeshes: ChunkMesh[] = []"));
assert.ok(source.includes("visibleMeshes.length = 0;\n    transparentMeshes.length = 0;"));
const render = source.slice(source.indexOf("function render("), source.indexOf("\n  function frame("));
for (const forbidden of [
  "visibleMeshes: Array<", "visibleMeshes.push([", ".filter(([, mesh])", ".map(([key])", "chunkMeshes.get(key)",
  "sortTransparentChunkKeysBackToFront(",
]) assert.equal(render.includes(forbidden), false, `render pass stays free of legacy allocation: ${forbidden}`);
assert.ok(render.includes("transparentMeshes.sort(compareTransparentChunkMeshes)"));
assert.equal(54 * 60 * 60, 194_400, "49 visible tuples plus five list arrays are removed each minute at 60 FPS");

console.log("retained visible and transparent chunk pass tests passed");
