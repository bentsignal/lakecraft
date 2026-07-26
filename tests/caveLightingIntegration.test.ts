import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEXTURED_WORLD_VERTEX_FLOATS, blockTextureForFace } from "../client/game/blockTextures.ts";
import { unpackSkyExposureShade } from "../client/game/skyExposure.ts";
import { BLOCK } from "../client/game/types.ts";
import { appendSaplingMesh } from "../client/game/voxelEngine.ts";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const shader = engine.slice(
  engine.indexOf("const TERRAIN_VERTEX_SHADER"),
  engine.indexOf("const TERRAIN_FRAGMENT_SHADER"),
);
assert.ok(shader.includes("float packedExposure = step("));
assert.ok(shader.includes("float skyExposure = mix(1.0, floor(encodedShade / 2.0) /"));
assert.ok(shader.includes("vec3 lighting = mix(vec3("));
assert.ok(shader.includes("surfaceLighting, skyExposure)"));
assert.ok(shader.includes("vLight = (lighting + torchLight + emissiveLight) * faceShade"),
  "torch emission is added after cave daylight attenuation");
assert.ok(engine.includes('textureName === "furnace_front"'),
  "the furnace front retains a small exposure-independent emissive term");
assert.equal(TEXTURED_WORLD_VERTEX_FLOATS, 6, "exposure reuses the retained texture shade channel");
const caveMesh: number[] = [];
appendSaplingMesh(caveMesh, 0, 0, 0, 0.95, 0);
for (let offset = 5; offset < caveMesh.length; offset += TEXTURED_WORLD_VERTEX_FLOATS) {
  const decoded = unpackSkyExposureShade(caveMesh[offset]);
  assert.equal(decoded.exposureLevel, 0);
  assert.ok(Math.abs(decoded.faceShade - 0.95) < 1e-12);
}

assert.ok(engine.includes("const skyOccluderColumns: SkyOccluderColumns = new Map()"));
assert.equal(
  engine.match(/writeChunkSkyOccluders\(skyOccluderColumns,/g)?.length,
  2,
  "initial and incremental streaming each populate the column cache",
);
assert.ok(engine.includes("removeChunkSkyOccluders(skyOccluderColumns, chunkX, chunkZ)"));
assert.ok(engine.includes("refreshEditedSkyColumns(skyOccluderColumns, skyEdits, getBlock)"));
assert.ok(engine.includes("skyExposureDirtyChunkKeysForEdits(skyEdits)"));
assert.ok(engine.includes("if (setBlock(next.x, next.y, next.z, next.block)) skyEdits.push(next)"));

const render = engine.slice(engine.indexOf("function render("), engine.indexOf("\n  function frame("));
for (const forbidden of [
  "skyExposureLevel(",
  "refreshEditedSkyColumns(",
  "writeChunkSkyOccluders(",
  "for (const key of chunkBlocks",
]) {
  assert.equal(render.includes(forbidden), false, `render loop avoids exposure scan: ${forbidden}`);
}
assert.equal(engine.match(/gl\.drawArrays/g)?.length, 14, "cave lighting adds no draw call");
assert.ok(engine.includes("appendTorchMesh(colorVertices, x, y, z)"),
  "the warm torch mesh remains on its established emissive color path");
assert.equal(blockTextureForFace(BLOCK.FURNACE, "north"), "furnace_front",
  "furnaces retain their authored front texture and nearby torch contribution");

console.log("cached cave lighting mesh/shader integration tests passed");
