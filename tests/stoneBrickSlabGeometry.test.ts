import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockIdForCubeItem } from "../client/game/blockItemCubeGeometry.ts";
import {
  STONE_BRICK_SLAB_HEIGHT,
  blockCollisionHeight,
  blockContainsSolidPoint,
  blockSupportsPlayerFeet,
  playerIntersectsBlockCollisionHeight,
} from "../client/game/blockGeometry.ts";
import { raycastVoxels } from "../client/game/terrain.ts";
import { BLOCK } from "../client/game/types.ts";
import { appendWorldBlockCrackLines } from "../client/game/blockCracks.ts";
import { BLOCK_PARTICLES_PER_ACTION, createBlockParticleSystem } from "../client/game/blockParticles.ts";
import { blockTextureForFace, textureAtlasUv, type BlockFace } from "../client/game/blockTextures.ts";
import { writeDroppedItemGeometry, droppedBlockCubeVertexCount, type DroppedItemGeometryStats } from "../client/game/droppedItemRenderer.ts";
import { createFirstPersonRenderer, firstPersonSpritePresentation } from "../client/game/firstPersonRenderer.ts";
import { appendItemSpriteGeometry } from "../client/game/itemSpriteGeometry.ts";
import { remoteHeldItemRects, remoteHeldItemVertexCount } from "../client/game/remotePlayerRenderer.ts";
import {
  STONE_BRICK_SLAB_MESH_VERTEX_COUNT,
  appendStoneBrickSlabMesh,
  blockFaceIsOccluded,
  blockMaterialColor,
  blockOccludesFaces,
} from "../client/game/voxelEngine.ts";
import {
  fallProbeCells,
  fallSupportBlockHasCollision,
} from "../shared/fallWorldProbe.ts";
import {
  firstOccludingVoxelOnSegment,
  segmentIntersectsVoxelHeight,
  segmentVoxelHeightIntersectionFraction,
} from "../shared/rangedCombat.ts";
import { itemVisual } from "../shared/visualCatalog.ts";

assert.equal(BLOCK.STONE_BRICK_SLAB, 30, "the slab appends after both gate states without renumbering engine IDs");
assert.equal(STONE_BRICK_SLAB_HEIGHT, 0.5);
assert.equal(blockCollisionHeight(BLOCK.STONE_BRICK_SLAB), 0.5);
assert.equal(blockCollisionHeight(BLOCK.STONE_BRICKS), 1);
assert.equal(blockContainsSolidPoint(BLOCK.STONE_BRICK_SLAB, 7, 7.25), true);
assert.equal(blockContainsSolidPoint(BLOCK.STONE_BRICK_SLAB, 7, 7.75), false,
  "the empty upper half cannot block a ray or projectile");
assert.equal(playerIntersectsBlockCollisionHeight(7.49, 1.78, 7, BLOCK.STONE_BRICK_SLAB), true);
assert.equal(playerIntersectsBlockCollisionHeight(7.5, 1.78, 7, BLOCK.STONE_BRICK_SLAB), false,
  "feet resting on the slab top do not overlap the slab AABB");
assert.equal(blockSupportsPlayerFeet(BLOCK.STONE_BRICK_SLAB, 7, 7.5), true);
assert.equal(blockSupportsPlayerFeet(BLOCK.STONE_BRICK_SLAB, 7, 8), false);
assert.equal(blockOccludesFaces(BLOCK.STONE_BRICK_SLAB), false,
  "a bottom slab cannot hide the upper half of an adjacent full cube face");
assert.equal(blockFaceIsOccluded(BLOCK.STONE, BLOCK.STONE_BRICK_SLAB), false);
assert.deepEqual(blockMaterialColor(BLOCK.STONE_BRICK_SLAB), [0.43, 0.45, 0.43]);
for (const face of ["east", "west", "top", "bottom", "south", "north"] as const satisfies readonly BlockFace[]) {
  assert.equal(blockTextureForFace(BLOCK.STONE_BRICK_SLAB, face), "stone_bricks",
    "world slabs reuse the authored masonry atlas tile");
}

const mesh: number[] = [];
appendStoneBrickSlabMesh(mesh, 3, 7, -2, 0.94);
assert.equal(STONE_BRICK_SLAB_MESH_VERTEX_COUNT, 36);
assert.equal(mesh.length, STONE_BRICK_SLAB_MESH_VERTEX_COUNT * 6,
  "one slab remains a fixed six-face textured box in the existing chunk buffer");
const meshPositions = Array.from({ length: mesh.length / 6 }, (_, index) => mesh.slice(index * 6, index * 6 + 3));
assert.equal(Math.min(...meshPositions.map((position) => position[1])), 7);
assert.equal(Math.max(...meshPositions.map((position) => position[1])), 7.5,
  "rendered slab vertices occupy exactly [y, y + 0.5]");
assert.equal(Math.min(...meshPositions.map((position) => position[0])), 3);
assert.equal(Math.max(...meshPositions.map((position) => position[0])), 4);
assert.equal(Math.min(...meshPositions.map((position) => position[2])), -2);
assert.equal(Math.max(...meshPositions.map((position) => position[2])), -1);
const masonryUv = textureAtlasUv("stone_bricks");
for (let index = 0; index < mesh.length; index += 6) {
  assert.ok(mesh[index + 3] >= masonryUv.left && mesh[index + 3] <= masonryUv.right);
  assert.ok(mesh[index + 4] >= masonryUv.bottom && mesh[index + 4] <= masonryUv.top);
  assert.ok(mesh[index + 5] > 0 && mesh[index + 5] <= 0.94);
}
const culledVertexCount = (
  neighbor: readonly [number, number, number],
  block = BLOCK.STONE,
): number => {
  const vertices: number[] = [];
  appendStoneBrickSlabMesh(vertices, 3, 7, -2, 1, (x, y, z) => (
    x === neighbor[0] && y === neighbor[1] && z === neighbor[2] ? block : BLOCK.AIR
  ));
  return vertices.length / 6;
};
assert.equal(culledVertexCount([4, 7, -2]), 30,
  "an opaque east neighbor removes exactly the hidden six-vertex side");
assert.equal(culledVertexCount([4, 7, -2], BLOCK.STONE_BRICK_SLAB), 30,
  "an adjacent slab removes exactly their shared half-height side");
assert.equal(culledVertexCount([3, 6, -2]), 30,
  "an opaque block below removes exactly the hidden bottom face");
assert.equal(culledVertexCount([3, 8, -2]), 36,
  "a block one cell above cannot hide the slab top across the empty upper half");
const slabCracks: number[] = [];
assert.ok(appendWorldBlockCrackLines(slabCracks, { x: 3, y: 7, z: -2 }, 0.55, STONE_BRICK_SLAB_HEIGHT) > 0);
const crackYs = Array.from({ length: slabCracks.length / 6 }, (_, index) => slabCracks[index * 6 + 1]);
assert.ok(Math.min(...crackYs) >= 7 - 0.004 && Math.max(...crackYs) <= 7.5 + 0.004,
  "mining cracks stay attached to the slab's half-height AABB");
const slabParticles = createBlockParticleSystem(32);
assert.equal(slabParticles.spawn({ block: BLOCK.STONE_BRICK_SLAB, x: 3, y: 7, z: -2, action: "break" }),
  BLOCK_PARTICLES_PER_ACTION.break, "final block ID 30 emits the existing bounded break-particle burst");
const slabArt = getItemIconArt("stone_brick_slab");
assert.equal(slabArt.family, "block");
assert.equal(slabArt.variant, "stone_brick_slab");
assert.ok(slabArt.runs.length >= 20, "inventory and held views use a readable original low masonry sprite");
assert.notDeepEqual(slabArt.runs, getItemIconArt("stone_bricks").runs,
  "the slab silhouette is distinct from the full stone-brick cube");
assert.equal(itemVisual("stone_brick_slab").parent, "block", "the slab retains its shared block-item catalog definition");
assert.equal(blockIdForCubeItem("stone_brick_slab"), null,
  "a partial-height slab cannot enter any full-cube held or dropped path");

const expectedHeldGeometry: number[] = [];
const expectedHeldVertices = appendItemSpriteGeometry(
  expectedHeldGeometry,
  slabArt,
  firstPersonSpritePresentation("stone_brick_slab"),
);
let nextBufferId = 0;
let boundBuffer: WebGLBuffer | null = null;
const uploads = new Map<WebGLBuffer, Float32Array>();
const captureGl = {
  ARRAY_BUFFER: 0x8892,
  DYNAMIC_DRAW: 0x88e8,
  createBuffer: () => ({ id: ++nextBufferId }),
  bindBuffer: (_target: number, buffer: WebGLBuffer | null) => { boundBuffer = buffer; },
  bufferData: () => undefined,
  bufferSubData: (_target: number, _offset: number, data: Float32Array) => {
    if (!boundBuffer) throw new Error("held slab capture buffer was not bound");
    uploads.set(boundBuffer, new Float32Array(data));
  },
  deleteBuffer: () => undefined,
} as unknown as WebGLRenderingContext;
const heldRenderer = createFirstPersonRenderer(captureGl);
heldRenderer[3]("stone_brick_slab", BLOCK.STONE_BRICK_SLAB);
const heldUpload = uploads.get(heldRenderer[0]);
assert.ok(heldUpload, "the first-person slab uploads shared item-sprite color geometry");
assert.equal(heldRenderer[2][0], expectedHeldVertices, "the first-person slab keeps canonical sprite vertex parity");
assert.equal(heldUpload.length, expectedHeldGeometry.length, "the first-person slab uploads one complete color stream");
for (let offset = 0; offset < heldUpload.length; offset += 6) {
  assert.ok(Number.isFinite(heldUpload[offset])
    && Number.isFinite(heldUpload[offset + 1])
    && Number.isFinite(heldUpload[offset + 2]),
  `first-person slab vertex ${offset / 6} has a finite socketed position`);
  for (let channel = 3; channel < 6; channel += 1) {
    assert.ok(Math.abs(heldUpload[offset + channel] - expectedHeldGeometry[offset + channel]) < 1e-6,
      `first-person slab vertex ${offset / 6} retains canonical inventory-art color channel ${channel - 3}`);
  }
}
assert.equal(heldRenderer[2][1], 0, "the partial-height slab never emits textured full-cube output");
heldRenderer[7]();

assert.equal(droppedBlockCubeVertexCount("stone_brick_slab"), 0,
  "dropped slabs cannot enter the retained full-cube template map");
const droppedOutput = new Float32Array(slabArt.runs.length * 6 * 6);
const droppedStats: DroppedItemGeometryStats = { totalItemCount: 0, visibleItemCount: 0, vertexCount: 0 };
writeDroppedItemGeometry(
  new Float32Array([0, 1, 0]),
  new Float32Array([0]),
  ["stone_brick_slab"],
  1,
  [0, 1, 0],
  0,
  droppedOutput,
  droppedStats,
);
assert.equal(droppedStats.vertexCount, slabArt.runs.length * 6,
  "one dropped slab uses the canonical inventory-sprite run count");

const remoteRects = remoteHeldItemRects("stone_brick_slab");
assert.equal(remoteHeldItemVertexCount("stone_brick_slab"), remoteRects.length * 6);
assert.ok(remoteRects.length > 0, "remote players retain a visible slab silhouette");
const slabPalette = new Set(slabArt.runs.map((run) => run.color.toLowerCase()));
for (const rectangle of remoteRects) {
  const color = `#${rectangle.color.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
  assert.ok(slabPalette.has(color), "remote held slabs use only canonical inventory-art colors");
}

const heldSource = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
for (const sharedPath of ["getItemIconArt(itemId)", "appendItemSpriteGeometry("]) {
  assert.ok(heldSource.includes(sharedPath), `held slabs use the shared visual pipeline through ${sharedPath}`);
}
assert.equal(heldSource.includes("appendColorBox"), false,
  "the removed bespoke color-box held approximation cannot return");
assert.equal(heldSource.includes("appendSpecialBlock"), false,
  "the removed special-block held approximation cannot bypass shared item art");

const slabLookup = (x: number, y: number, z: number) => (
  x === 1 && y === 7 && z === 0 ? BLOCK.STONE_BRICK_SLAB : BLOCK.AIR
);
assert.equal(
  raycastVoxels([0.2, 7.75, 0.5], [1, 0, 0], slabLookup, 3),
  null,
  "block targeting passes through the slab's empty upper half",
);
const lowerHit = raycastVoxels([0.2, 7.25, 0.5], [1, 0, 0], slabLookup, 3);
assert.equal(lowerHit?.block.block, BLOCK.STONE_BRICK_SLAB,
  "block targeting hits the occupied lower half");
assert.deepEqual(lowerHit?.place, { x: 0, y: 7, z: 0 });
const descendingHit = raycastVoxels([1.5, 8.1, 0.5], [0, -1, 0], slabLookup, 2);
assert.equal(descendingHit?.block.block, BLOCK.STONE_BRICK_SLAB);
assert.deepEqual(descendingHit?.place, { x: 1, y: 8, z: 0 },
  "a ray entering the empty upper half places against the slab's top face");

const slabSupport = fallProbeCells({ x: 1.5, y: 7.5, z: 0.5 });
assert.deepEqual(
  slabSupport.find((cell) => cell.coordKey === "1:7:0"),
  { coordKey: "1:7:0", x: 1, y: 7, z: 0, support: false, slabSupport: true, doorTop: false, ladder: true },
  "the authoritative probe samples the half-height support plane",
);
assert.equal(fallSupportBlockHasCollision("stone_brick_slab"), false,
  "the generic full-height support predicate cannot accidentally support a player at y+1");
assert.equal(
  fallProbeCells({ x: 1.5, y: 8, z: 0.5 }).find((cell) => cell.coordKey === "1:7:0")?.support,
  true,
  "ordinary standing probes still inspect a slab cell as a full-height candidate",
);

const upperStart = { x: 0.2, y: 7.75, z: 0.5 };
const upperEnd = { x: 2.8, y: 7.75, z: 0.5 };
const lowerStart = { x: 0.2, y: 7.25, z: 0.5 };
const lowerEnd = { x: 2.8, y: 7.25, z: 0.5 };
assert.equal(segmentIntersectsVoxelHeight(upperStart, upperEnd, 1, 7, 0, 0.5), false);
assert.equal(segmentIntersectsVoxelHeight(lowerStart, lowerEnd, 1, 7, 0, 0.5), true);
const lowerFraction = segmentVoxelHeightIntersectionFraction(lowerStart, lowerEnd, 1, 7, 0, 0.5);
assert.ok(lowerFraction !== null);
assert.ok(Math.abs(lowerFraction - 0.8 / 2.6) < 1e-12,
  "partial-height ranged cover reports the exact global entry fraction");

const slabOccluder = (
  x: number,
  y: number,
  z: number,
  segmentStart = lowerStart,
  segmentEnd = lowerEnd,
) => x === 1 && y === 7 && z === 0
  ? segmentVoxelHeightIntersectionFraction(segmentStart, segmentEnd, x, y, z, 0.5) ?? false
  : false;
assert.equal(firstOccludingVoxelOnSegment(upperStart, upperEnd, slabOccluder), null,
  "authoritative projectiles pass through the empty upper half");
const projectileHit = firstOccludingVoxelOnSegment(lowerStart, lowerEnd, slabOccluder);
assert.deepEqual(projectileHit && { ...projectileHit, fraction: Number(projectileHit.fraction.toFixed(12)) }, {
  x: 1,
  y: 7,
  z: 0,
  fraction: Number((0.8 / 2.6).toFixed(12)),
}, "authoritative projectiles stop at the slab's occupied lower-half AABB");

const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engineSource,
  /block === BLOCK\.STONE_BRICK_SLAB\)[\s\S]{0,180}appendStoneBrickSlabMesh\(\s*textureVertices/,
  "slabs append into the retained opaque terrain batch");
assert.ok((engineSource.match(/blockHasCollision\(block\) && playerIntersectsBlockCollisionHeight/g)?.length ?? 0) >= 2,
  "player and mob collision both use the partial-height AABB");
assert.match(engineSource,
  /isProjectileBlocked:[\s\S]{0,220}blockHasCollision\(block\) && blockContainsSolidPoint\(block, blockY, y\)/,
  "local mob projectiles use the same upper-half pass-through rule");
assert.match(serverSource,
  /cell\.slabSupport && block === "stone_brick_slab"\) supported = true/,
  "Lakebed fall authority accepts the dedicated slab-top probe");
assert.match(serverSource,
  /block !== "stone_brick_slab"\) return true;[\s\S]{0,180}segmentVoxelHeightIntersectionFraction/,
  "Lakebed ranged authority uses partial AABB cover instead of whole-cell cover");

console.log("stone-brick slab half-height collision, targeting, fall support, and projectile cover tests passed");
