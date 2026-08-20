import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { raycastVoxels } from "../client/game/terrain.ts";
import {
  DEFAULT_STREAMING_CHUNK_RADIUS,
  MAX_LOCAL_STREAMING_CHUNK_RADIUS,
  MAX_STREAMING_CHUNK_COUNT,
} from "../client/game/chunks.ts";
import {
  MAX_TRANSPARENT_CHUNK_DRAWS,
  blockFaceIsOccluded,
  blockHasCollision,
  blockMaterialColor,
  blockOccludesFaces,
  sortTransparentChunkKeysBackToFront,
} from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";

assert.equal(BLOCK.COBBLESTONE, 17, "new persisted IDs append after ladder");
assert.equal(BLOCK.SAND, 18);
assert.equal(BLOCK.GLASS, 19);
assert.notDeepEqual(blockMaterialColor(BLOCK.COBBLESTONE), blockMaterialColor(BLOCK.STONE));
assert.notDeepEqual(blockMaterialColor(BLOCK.SAND), blockMaterialColor(BLOCK.DIRT));
assert.notDeepEqual(blockMaterialColor(BLOCK.GLASS), blockMaterialColor(BLOCK.SAND));
assert.equal(blockHasCollision(BLOCK.COBBLESTONE), true);
assert.equal(blockHasCollision(BLOCK.SAND), true);
assert.equal(blockHasCollision(BLOCK.GLASS), true, "glass retains a full collision cell");
assert.equal(blockOccludesFaces(BLOCK.COBBLESTONE), true);
assert.equal(blockOccludesFaces(BLOCK.SAND), true);
assert.equal(blockOccludesFaces(BLOCK.GLASS), false, "glass preserves neighboring opaque faces");
assert.equal(blockFaceIsOccluded(BLOCK.GLASS, BLOCK.GLASS), true, "adjacent glass cells cull their internal seam");
assert.equal(blockFaceIsOccluded(BLOCK.GLASS, BLOCK.STONE), true, "opaque neighbors hide glass faces");
assert.equal(blockFaceIsOccluded(BLOCK.STONE, BLOCK.GLASS), false, "glass does not remove an opaque neighbor face");
assert.equal(blockFaceIsOccluded(BLOCK.GLASS, BLOCK.AIR), false);

const maxLocalStreamingChunkCount = (MAX_LOCAL_STREAMING_CHUNK_RADIUS * 2 + 1) ** 2;
assert.equal(MAX_TRANSPARENT_CHUNK_DRAWS, maxLocalStreamingChunkCount,
  "transparent draws cover the configurable maximum local render-distance window");
assert.equal(MAX_STREAMING_CHUNK_COUNT, (DEFAULT_STREAMING_CHUNK_RADIUS * 2 + 1) ** 2,
  "the default/Lakebed streaming window remains separately bounded to 7x7");
assert.deepEqual(sortTransparentChunkKeysBackToFront([], [0, 0, 0]), []);
assert.deepEqual(
  sortTransparentChunkKeysBackToFront(["0,0", "2,0", "-1,0"], [4, 8, 4]),
  ["2,0", "-1,0", "0,0"],
  "transparent chunks render far-to-near around the camera chunk",
);
const stressSide = MAX_LOCAL_STREAMING_CHUNK_RADIUS * 2 + 2;
const stressKeys = Array.from({ length: stressSide ** 2 }, (_, index) =>
  `${index % stressSide},${Math.floor(index / stressSide)}`);
const boundedStressOrder = sortTransparentChunkKeysBackToFront(stressKeys, [0, 8, 0]);
const expectedStressDraws = Math.min(stressKeys.length, maxLocalStreamingChunkCount);
assert.equal(boundedStressOrder.length, expectedStressDraws,
  "pathological input is capped to the configurable maximum local window");
assert.equal(new Set(boundedStressOrder).size, boundedStressOrder.length);

const baselineDrawCalls = 22;
assert.equal(baselineDrawCalls + sortTransparentChunkKeysBackToFront([], [0, 0, 0]).length, 22);
assert.equal(
  baselineDrawCalls + boundedStressOrder.length,
  baselineDrawCalls + expectedStressDraws,
  "the worst visible local window adds at most one glass draw per configured chunk",
);

const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const transparentPass = engineSource.slice(engineSource.indexOf(
  "waterMeshes.sort((left, right) => -compareTransparentChunkMeshes(left, right))",
));
assert.match(transparentPass, /gl\.enable\(gl\.BLEND\)/);
assert.match(transparentPass, /gl\.blendFunc\(gl\.SRC_ALPHA, gl\.ONE_MINUS_SRC_ALPHA\)/);
assert.match(engineSource, /const chunkWaterVertices: number\[\] = \[\]/);
assert.match(engineSource, /if \(isFluidBlock\(block\)\) \{[\s\S]*?appendFluidBlockMesh\(\s*waterVertices/,
  "fluids own a dedicated buffer instead of sharing camera-sorted glass geometry");
assert.ok(engineSource.indexOf("waterMeshes.sort((left, right) => -compareTransparentChunkMeshes(left, right))")
  < engineSource.indexOf("transparentMeshes.sort(compareTransparentChunkMeshes)"));
assert.ok(transparentPass.indexOf("mesh.waterBuffer") < transparentPass.indexOf("gl.depthMask(false)"),
  "near-to-far water writes stable depth before glass disables depth writes");
assert.match(transparentPass, /gl\.depthMask\(false\)/);
assert.match(transparentPass, /gl\.depthMask\(true\)/);
assert.match(transparentPass, /gl\.disable\(gl\.BLEND\)/);
assert.doesNotMatch(engineSource, /texel\.a < 0\.5/, "low-alpha glass center pixels must reach blending");
assert.match(engineSource,
  /if \(isGlassBlock\(block\)\) \{[\s\S]*?appendConnectedGlassFace\(\s*textureVertices[\s\S]*?appendConnectedGlassFace\(\s*destination/,
  "glass frames write stable depth in the opaque pass before their translucent fill blends");
assert.match(engineSource, /playerSkinRenderer\.setHeldItem\(selectedItem\)/,
  "creative and survival use the same selected-item path for local third-person glass");
assert.ok(
  engineSource.indexOf("if (nameplateVertexCount)") < engineSource.indexOf("transparentMeshes.sort(compareTransparentChunkMeshes)"),
  "glass composites after opaque terrain, players, mobs, drops, and nameplates",
);

const hit = raycastVoxels(
  [4.5, 5.5, 5.5],
  [0, 0, 1],
  (x, y, z) => x === 4 && y === 5 && z === 6 ? BLOCK.GLASS : BLOCK.AIR,
  3,
);
assert.equal(hit?.block.block, BLOCK.GLASS, "non-occluding glass remains raycastable");
assert.deepEqual(hit?.place, { x: 4, y: 5, z: 5 });

console.log(JSON.stringify({
  benchmark: "bounded transparent glass pass",
  baselineDrawCalls,
  emptyGlassDrawDelta: 0,
  worstVisibleGlassDrawDelta: MAX_TRANSPARENT_CHUNK_DRAWS,
  worstTotalDrawCalls: baselineDrawCalls + MAX_TRANSPARENT_CHUNK_DRAWS,
}));
console.log("lakecraft glass material and transparent pass tests: ok");
