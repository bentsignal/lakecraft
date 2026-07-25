import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockTextureForFace, textureAtlasUv, type BlockFace } from "../client/game/blockTextures.ts";
import {
  OAK_FENCE_BOX_VERTEX_COUNT,
  OAK_FENCE_HEIGHT,
  appendOakFenceMesh,
  blockHasCollision,
  blockMaterialColor,
  blockOccludesFaces,
  oakFenceConnections,
  oakFenceConnectsTo,
  oakFenceMeshVertexCount,
  playerIntersectsOakFenceHeight,
  type OakFenceConnections,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";

assert.equal(BLOCK.OAK_FENCE, 27, "oak fences append after stone bricks without renumbering shipped engine IDs");
assert.equal(blockHasCollision(BLOCK.OAK_FENCE), true, "a fence blocks traversal through its occupied cell");
assert.equal(blockOccludesFaces(BLOCK.OAK_FENCE), false, "thin fence geometry never hides neighboring cube faces");
assert.deepEqual(blockMaterialColor(BLOCK.OAK_FENCE), [0.69, 0.48, 0.25]);
for (const face of ["east", "west", "top", "bottom", "south", "north"] as const satisfies readonly BlockFace[]) {
  assert.equal(blockTextureForFace(BLOCK.OAK_FENCE, face), null, "fences bypass full-cube face generation");
}

assert.equal(oakFenceConnectsTo(BLOCK.OAK_FENCE), true);
assert.equal(oakFenceConnectsTo(BLOCK.STONE), true, "opaque full blocks accept a rail connection");
assert.equal(oakFenceConnectsTo(BLOCK.PLANKS), true);
assert.equal(oakFenceConnectsTo(BLOCK.AIR), false);
assert.equal(oakFenceConnectsTo(BLOCK.TORCH), false);
assert.equal(oakFenceConnectsTo(BLOCK.SAPLING), false);
assert.equal(oakFenceConnectsTo(BLOCK.GLASS), false, "transparent non-occluders do not create surprising rails");
assert.equal(oakFenceConnectsTo(BLOCK.CHEST), false, "authored chest geometry is not a full-block rail anchor");
assert.equal(oakFenceConnectsTo(BLOCK.BED), false);
assert.equal(oakFenceConnectsTo(BLOCK.DOOR_CLOSED), false);
assert.equal(oakFenceConnectsTo(BLOCK.DOOR_OPEN), false);
assert.equal(oakFenceConnectsTo(BLOCK.FURNACE), true, "full-cube authored textures remain valid anchors");
assert.equal(oakFenceConnectsTo(BLOCK.CRAFTING_TABLE), true);

const neighbors = new Map<string, BlockId>([
  ["11:7:-3", BLOCK.OAK_FENCE],
  ["9:7:-3", BLOCK.STONE],
  ["10:7:-2", BLOCK.TORCH],
  ["10:7:-4", BLOCK.PLANKS],
]);
let probes = 0;
const connected = oakFenceConnections(10, 7, -3, (x, y, z) => {
  probes += 1;
  return neighbors.get(`${x}:${y}:${z}`) ?? BLOCK.AIR;
});
assert.equal(probes, 4, "one mesh uses exactly four bounded neighbor probes");
assert.deepEqual(connected, { east: true, west: true, south: false, north: true });

const isolated: OakFenceConnections = { east: false, west: false, south: false, north: false };
const all: OakFenceConnections = { east: true, west: true, south: true, north: true };
assert.equal(OAK_FENCE_BOX_VERTEX_COUNT, 36);
assert.equal(oakFenceMeshVertexCount(isolated), 36, "an isolated fence is one fixed post box");
assert.equal(oakFenceMeshVertexCount(connected), 252, "three directions add two fixed rail boxes apiece");
assert.equal(oakFenceMeshVertexCount(all), 324, "four-way fences retain an exact bounded vertex budget");

const vertices: number[] = [];
appendOakFenceMesh(vertices, 10, 7, -3, connected, 0.94);
assert.equal(vertices.length, oakFenceMeshVertexCount(connected) * 6, "position, UV, and shade stay in one retained texture batch");
const positions = Array.from({ length: vertices.length / 6 }, (_, index) => vertices.slice(index * 6, index * 6 + 3));
assert.equal(Math.max(...positions.map((position) => position[1])), 7 + OAK_FENCE_HEIGHT, "the post reaches the 1.5-block fence top");
assert.equal(Math.max(...positions.map((position) => position[0])), 11, "east rails connect to the neighboring cell edge");
assert.equal(Math.min(...positions.map((position) => position[0])), 10, "west rails connect to the neighboring cell edge");
assert.equal(Math.min(...positions.map((position) => position[2])), -3, "north rails connect to the neighboring cell edge");
const uv = textureAtlasUv("oak_planks");
for (let index = 0; index < vertices.length; index += 6) {
  assert.ok(vertices[index + 3] >= uv.left && vertices[index + 3] <= uv.right);
  assert.ok(vertices[index + 4] >= uv.bottom && vertices[index + 4] <= uv.top);
  assert.ok(vertices[index + 5] > 0 && vertices[index + 5] <= 0.94);
}

assert.equal(playerIntersectsOakFenceHeight(1.49, 1.8, 0), true, "ordinary jump height still intersects a 1.5-block fence");
assert.equal(playerIntersectsOakFenceHeight(1.5, 1.8, 0), false, "a player standing exactly on the top is not trapped");
assert.equal(playerIntersectsOakFenceHeight(-8.6, 1.8, -10), true, "the collision rule also works below world zero");
assert.equal(playerIntersectsOakFenceHeight(Number.NaN, 1.8, 0), false);

const art = getItemIconArt("oak_fence");
assert.equal(art.family, "block");
assert.equal(art.variant, "oak_fence");
assert.ok(art.runs.length >= 18, "inventory and held views use a readable original post-and-rails sprite");
assert.notDeepEqual(art.runs, getItemIconArt("planks").runs);

const held = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
assert.match(held, /itemId === "oak_fence" \|\| itemId === "oak_fence_gate"[\s\S]{0,500}appendColorBox/,
  "held fences use solid posts and rails rather than a flat silhouette");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engine, /block === BLOCK\.OAK_FENCE[\s\S]{0,420}appendOakFenceMesh\(\s*textureVertices/,
  "oak fences reuse the retained textured chunk batch");
assert.match(engine, /getBlock\(bx, by - 1, bz\) === BLOCK\.OAK_FENCE[\s\S]{0,120}playerIntersectsOakFenceHeight/,
  "the bounded below-cell collision closes the half-block jump-over gap");
assert.doesNotMatch(engine, /OAK_FENCE[\s\S]{0,120}(setInterval|setTimeout|fetch)\(/,
  "fence connectivity and collision add no timer, polling, or network loop");

console.log("lakecraft connected oak fence mesh, collision, icon, and held-art tests: ok");
