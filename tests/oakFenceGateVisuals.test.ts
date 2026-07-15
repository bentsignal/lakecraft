import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockTextureForFace, textureAtlasUv, type BlockFace } from "../client/game/blockTextures.ts";
import {
  OAK_FENCE_GATE_MESH_VERTEX_COUNT,
  OAK_FENCE_HEIGHT,
  appendOakFenceGateMesh,
  blockHasCollision,
  blockMaterialColor,
  blockOccludesFaces,
  createDoorToggleEdit,
  doorPlacementBlock,
  isOakFenceGateBlock,
  oakFenceConnectsTo,
  toggledDoorBlock,
  tryInteractBlock,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockTarget } from "../client/game/types.ts";

assert.equal(BLOCK.OAK_FENCE_GATE_CLOSED, 28, "closed gate appends after oak fence without renumbering engine IDs");
assert.equal(BLOCK.OAK_FENCE_GATE_OPEN, 29, "open gate is the next append-only render state");
assert.equal(isOakFenceGateBlock(BLOCK.OAK_FENCE_GATE_CLOSED), true);
assert.equal(isOakFenceGateBlock(BLOCK.OAK_FENCE_GATE_OPEN), true);
assert.equal(isOakFenceGateBlock(BLOCK.OAK_FENCE), false);
assert.equal(blockHasCollision(BLOCK.OAK_FENCE_GATE_CLOSED), true, "closed gates block their passage");
assert.equal(blockHasCollision(BLOCK.OAK_FENCE_GATE_OPEN), false, "open gates are traversable");
assert.equal(blockOccludesFaces(BLOCK.OAK_FENCE_GATE_CLOSED), false, "thin closed gates preserve adjacent cube faces");
assert.equal(blockOccludesFaces(BLOCK.OAK_FENCE_GATE_OPEN), false);
assert.deepEqual(blockMaterialColor(BLOCK.OAK_FENCE_GATE_CLOSED), [0.69, 0.48, 0.25]);
assert.deepEqual(blockMaterialColor(BLOCK.OAK_FENCE_GATE_OPEN), [0.69, 0.48, 0.25]);
for (const face of ["east", "west", "top", "bottom", "south", "north"] as const satisfies readonly BlockFace[]) {
  assert.equal(blockTextureForFace(BLOCK.OAK_FENCE_GATE_CLOSED, face), null);
  assert.equal(blockTextureForFace(BLOCK.OAK_FENCE_GATE_OPEN, face), null);
}

assert.equal(oakFenceConnectsTo(BLOCK.OAK_FENCE_GATE_CLOSED), true, "fence rails meet a closed gate post");
assert.equal(oakFenceConnectsTo(BLOCK.OAK_FENCE_GATE_OPEN), true, "rails remain connected while the panel is open");
assert.equal(toggledDoorBlock(BLOCK.OAK_FENCE_GATE_CLOSED), BLOCK.OAK_FENCE_GATE_OPEN);
assert.equal(toggledDoorBlock(BLOCK.OAK_FENCE_GATE_OPEN), BLOCK.OAK_FENCE_GATE_CLOSED);
assert.equal(doorPlacementBlock(BLOCK.OAK_FENCE_GATE_OPEN), BLOCK.OAK_FENCE_GATE_CLOSED,
  "an inventory gate can only place the closed canonical state");

const gateTarget: BlockTarget = {
  block: { x: 8, y: 12, z: -4, block: BLOCK.OAK_FENCE_GATE_CLOSED },
  place: { x: 8, y: 12, z: -3 },
  distance: 2.5,
};
assert.deepEqual(createDoorToggleEdit(gateTarget), { x: 8, y: 12, z: -4, block: BLOCK.OAK_FENCE_GATE_OPEN },
  "the existing local toggle-edit path generalizes to a gate");
let interactions = 0;
assert.equal(tryInteractBlock(gateTarget, () => { interactions += 1; return true; }), true);
assert.equal(tryInteractBlock({ ...gateTarget, block: { ...gateTarget.block, block: BLOCK.OAK_FENCE_GATE_OPEN } },
  () => { interactions += 1; return true; }), true);
assert.equal(interactions, 2, "both gate states dispatch through the existing discrete interaction callback");

const closed: number[] = [];
const open: number[] = [];
appendOakFenceGateMesh(closed, 8, 12, -4, false, 0.96);
appendOakFenceGateMesh(open, 8, 12, -4, true, 0.96);
assert.equal(OAK_FENCE_GATE_MESH_VERTEX_COUNT, 144, "two posts and two bars keep one exact fixed budget");
assert.equal(closed.length, OAK_FENCE_GATE_MESH_VERTEX_COUNT * 6);
assert.equal(open.length, OAK_FENCE_GATE_MESH_VERTEX_COUNT * 6, "opening never reallocates a larger mesh shape");
const closedPositions = Array.from({ length: closed.length / 6 }, (_, index) => closed.slice(index * 6, index * 6 + 3));
const openPositions = Array.from({ length: open.length / 6 }, (_, index) => open.slice(index * 6, index * 6 + 3));
assert.equal(Math.max(...closedPositions.map((position) => position[1])), 12 + OAK_FENCE_HEIGHT);
assert.equal(Math.max(...openPositions.map((position) => position[1])), 12 + OAK_FENCE_HEIGHT);
assert.equal(Math.max(...closedPositions.map((position) => position[2])), -3.375, "closed bars remain between the posts");
assert.equal(Math.max(...openPositions.map((position) => position[2])), -3, "open bars visibly swing south around their hinge");
assert.notDeepEqual(closedPositions, openPositions);
const uv = textureAtlasUv("oak_planks");
for (const vertices of [closed, open]) {
  for (let index = 0; index < vertices.length; index += 6) {
    assert.ok(vertices[index + 3] >= uv.left && vertices[index + 3] <= uv.right);
    assert.ok(vertices[index + 4] >= uv.bottom && vertices[index + 4] <= uv.top);
    assert.ok(vertices[index + 5] > 0 && vertices[index + 5] <= 0.96);
  }
}

const art = getItemIconArt("oak_fence_gate");
assert.equal(art.family, "block");
assert.equal(art.variant, "oak_fence_gate");
assert.ok(art.runs.length >= 20, "inventory gate art reads as two posts, rails, and hinges");
assert.notDeepEqual(art.runs, getItemIconArt("oak_fence").runs);
const held = readFileSync(new URL("../client/components/ItemGlyph.tsx", import.meta.url), "utf8");
assert.match(held, /HELD_SPRITE_BLOCKS[\s\S]{0,180}"oak_fence_gate"/,
  "held gates retain their authored thin silhouette");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engine, /isOakFenceGateBlock\(block\)[\s\S]{0,260}appendOakFenceGateMesh\(\s*textureVertices/,
  "both states use the retained oak-textured chunk batch");
assert.match(engine, /getBlock\(bx, by - 1, bz\) === BLOCK\.OAK_FENCE_GATE_CLOSED[\s\S]{0,120}playerIntersectsOakFenceHeight/,
  "closed-gate collision extends through the upper half block");
assert.doesNotMatch(engine, /OAK_FENCE_GATE[\s\S]{0,140}(setInterval|setTimeout|fetch)\(/,
  "gate rendering and toggling add no timer, polling, or network loop");

console.log("lakecraft connected oak fence-gate mesh, collision, toggle, icon, and held-art tests: ok");
