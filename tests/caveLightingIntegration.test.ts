import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEXTURED_WORLD_VERTEX_FLOATS, blockTextureForFace } from "../client/game/blockTextures.ts";
import { packSkyExposureShade, unpackSkyExposureShade } from "../client/game/skyExposure.ts";
import { BLOCK } from "../client/game/types.ts";
import {
  TERRAIN_FRAGMENT_SHADER,
  TERRAIN_VERTEX_SHADER,
  EMISSIVE_GLOW_FRAGMENT_SHADER,
  EMISSIVE_GLOW_VERTEX_SHADER,
  VERTEX_SHADER,
  appendSaplingMesh,
} from "../client/game/voxelEngine.ts";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.equal(engine.match(/vec3 lightAt\(/g)?.length, 1,
  "the client source stores one shared color/terrain lighting implementation");
assert.equal(VERTEX_SHADER.includes("\n"), false, "the assembled color shader remains compact");
assert.equal(TERRAIN_VERTEX_SHADER.includes("\n"), false, "the assembled terrain shader remains compact");
assert.match(VERTEX_SHADER, /lightAt\(aPosition,e\)/);
assert.match(VERTEX_SHADER, /vColor=c\*mix\(vec3\(1\.\),lightAt\(aPosition,e\),uLightingEnabled\)/);
for (const [red, exposure] of [[0.57, 0], [0.57, 1], [0.57, 2], [0.57, 3]] as const) {
  const unpacked = unpackSkyExposureShade(packSkyExposureShade(red, exposure));
  assert.equal(unpacked.exposureLevel, exposure);
  assert.ok(Math.abs(unpacked.faceShade - red) < 1e-12);
}
assert.match(TERRAIN_VERTEX_SHADER, /p=step\(7\.5,aShade\)/);
assert.match(TERRAIN_VERTEX_SHADER, /e=mix\(1\.,floor\(s\/2\.\)\/3\.0,p\)/);
assert.match(TERRAIN_VERTEX_SHADER, /vLight=\(lightAt\(aPosition,e\)\+vec3\(\.18\)\*m\)\*f/,
  "bounded neutral emission preserves each light source's installed texture color");
assert.match(TERRAIN_VERTEX_SHADER, /vEmission=m/);
assert.match(TERRAIN_FRAGMENT_SHADER, /min\(vec3\(1\.12\),texel\.rgb\*\(vLight\+texel\.rgb\*\.14\*vEmission\)\)/,
  "the emissive texture lift remains capped in the retained terrain pass");
assert.match(EMISSIVE_GLOW_VERTEX_SHADER, /max\(length\(d\),\.001\)/,
  "camera-coincident light sources cannot introduce NaN coordinates");
assert.match(EMISSIVE_GLOW_VERTEX_SHADER, /v=1\.-smoothstep\(f\.x,f\.y,length\(d\)\)/,
  "auras fade through the render-distance fog instead of floating beyond terrain");
assert.match(EMISSIVE_GLOW_VERTEX_SHADER, /gl_PointSize=clamp\([^;]+,4\.,64\.\)/,
  "one bounded point per active source creates a compact CSS-pixel aura");
assert.match(EMISSIVE_GLOW_FRAGMENT_SHADER, /smoothstep\(\.12,1\.,d\)\)\*\.12\*v/,
  "the glow has a soft radial edge and a restrained per-source alpha ceiling");
assert.match(engine, /gl\.blendFunc\(gl\.SRC_ALPHA, gl\.ONE_MINUS_SRC_ALPHA\)/,
  "source-over compositing bounds any number of overlapping auras instead of summing past white");
assert.match(engine, /emissiveGlowHeightLocation, canvas\.height/,
  "point sprites scale in framebuffer pixels so their CSS diameter stays stable across DPR values");
assert.match(engine, /gl\.drawArrays\(gl\.POINTS, 0, activeTorchLights\)/,
  "all nearby torches and luminous blocks share one capped draw call");
assert.equal(
  VERTEX_SHADER.match(/vec3 lightAt\(/g)?.length,
  1,
  "the color shader assembles one shared lighting implementation",
);
assert.equal(
  TERRAIN_VERTEX_SHADER.match(/vec3 lightAt\(/g)?.length,
  1,
  "the terrain shader assembles one shared lighting implementation",
);
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
assert.ok(engine.includes("skyOccluderClass(previous) !== skyOccluderClass(block)"),
  "leaf and opaque replacements invalidate the two-class skylight cache");
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
assert.equal(engine.match(/gl\.drawArrays/g)?.length, 17,
  "emissive aura plus the stable fluid depth-and-color passes add bounded draw sites");
assert.ok(engine.includes("appendSpecialTorchMesh("));
assert.ok(engine.includes("const specialVertices = { textured: textureVertices, color: colorVertices }"),
  "the torch stem uses the retained atlas batch while its warm ember stays in the color batch");
assert.equal(blockTextureForFace(BLOCK.FURNACE, "north"), "furnace_front",
  "furnaces retain their authored front texture and nearby torch contribution");

console.log("cached cave lighting mesh/shader integration tests passed");
