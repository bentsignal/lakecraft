import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockTextureForFace, textureAtlasUv, type BlockFace } from "../client/game/blockTextures.ts";
import { createFirstPersonRenderer, firstPersonSpritePresentation } from "../client/game/firstPersonRenderer.ts";
import { appendItemSpriteGeometry } from "../client/game/itemSpriteGeometry.ts";
import {
  SAPLING_MESH_VERTEX_COUNT,
  appendSaplingMesh,
  blockHasCollision,
  blockMaterialColor,
  blockOccludesFaces,
  canPlaceSapling,
  tryInteractBlock,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockTarget } from "../client/game/types.ts";
import { itemVisual } from "../shared/visualCatalog.ts";

assert.equal(BLOCK.SAPLING, 25, "sapling appends after wool without renumbering deployed block IDs");
assert.equal(blockHasCollision(BLOCK.SAPLING), false, "players can walk through crossed sapling quads");
assert.equal(blockOccludesFaces(BLOCK.SAPLING), false, "saplings never hide neighboring cube faces");
assert.deepEqual(blockMaterialColor(BLOCK.SAPLING), [0.28, 0.55, 0.18]);
for (const face of ["east", "west", "top", "bottom", "south", "north"] as readonly BlockFace[]) {
  assert.equal(blockTextureForFace(BLOCK.SAPLING, face), null, "sapling bypasses full cube face generation");
}
const uv = textureAtlasUv("sapling");
const vertices: number[] = [];
appendSaplingMesh(vertices, 4, 7, -2, 0.95);
assert.equal(vertices.length, SAPLING_MESH_VERTEX_COUNT * 6, "one sapling costs exactly two crossed quads");
assert.equal(SAPLING_MESH_VERTEX_COUNT, 12, "saplings add no cube-face or transparent-sort overhead");
const positions = Array.from({ length: SAPLING_MESH_VERTEX_COUNT }, (_, index) => vertices.slice(index * 6, index * 6 + 3));
assert.equal(positions.some(([x,,z]) => x === 4.12 && z === -1.88), true);
assert.equal(positions.some(([x,,z]) => x === 4.88 && z === -1.12), true);
for (let index = 0; index < vertices.length; index += 6) {
  assert.ok(vertices[index + 3] >= uv.left && vertices[index + 3] <= uv.right);
  assert.ok(vertices[index + 4] >= uv.bottom && vertices[index + 4] <= uv.top);
  assert.equal(vertices[index + 5], 0.95);
}

const soilTarget: BlockTarget = {
  block: { x: 4, y: 6, z: -2, block: BLOCK.GRASS },
  place: { x: 4, y: 7, z: -2 },
  distance: 2,
};
assert.equal(canPlaceSapling(soilTarget, BLOCK.GRASS), true);
assert.equal(canPlaceSapling({ ...soilTarget, block: { ...soilTarget.block, block: BLOCK.DIRT } }, BLOCK.DIRT), true);
assert.equal(canPlaceSapling({ ...soilTarget, place: { x: 5, y: 6, z: -2 } }, BLOCK.GRASS), false, "side placement is rejected");
assert.equal(canPlaceSapling(soilTarget, BLOCK.STONE), false, "stone cannot support a sapling");
const saplingTarget: BlockTarget = { ...soilTarget, block: { ...soilTarget.block, block: BLOCK.SAPLING } };
let interactions = 0;
assert.equal(tryInteractBlock(saplingTarget, () => { interactions += 1; return true; }), true);
assert.equal(tryInteractBlock(saplingTarget, () => { interactions += 1; return false; }), false,
  "an app-declined bone-meal interaction preserves normal secondary handling");
assert.equal(interactions, 2);

const saplingArt = getItemIconArt("sapling");
assert.equal(saplingArt.family, "block");
assert.equal(saplingArt.variant, "sapling");
assert.ok(saplingArt.runs.length >= 25, "sapling has original leafy 16px sprite art");
const boneMealArt = getItemIconArt("bone_meal");
assert.equal(boneMealArt.family, "material");
assert.equal(boneMealArt.variant, "bone_meal");
assert.ok(boneMealArt.runs.length >= 12, "bone meal has an original pale granular pile icon");

assert.equal(itemVisual("sapling").parent, "block", "oak sapling retains its shared block-item visual definition");
const expectedHeldGeometry: number[] = [];
const expectedHeldVertices = appendItemSpriteGeometry(
  expectedHeldGeometry,
  saplingArt,
  firstPersonSpritePresentation("sapling"),
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
    if (!boundBuffer) throw new Error("held sapling capture buffer was not bound");
    uploads.set(boundBuffer, new Float32Array(data));
  },
  deleteBuffer: () => undefined,
} as unknown as WebGLRenderingContext;
const heldRenderer = createFirstPersonRenderer(captureGl);
heldRenderer[3]("sapling", BLOCK.SAPLING);
const heldUpload = uploads.get(heldRenderer[0]);
assert.ok(heldUpload, "oak sapling uploads shared item-sprite color geometry");
assert.equal(heldRenderer[2][0], expectedHeldVertices, "oak sapling keeps canonical sprite vertex parity");
assert.equal(heldUpload.length, expectedHeldGeometry.length, "oak sapling uploads one complete six-float color stream");
for (let offset = 3; offset < heldUpload.length; offset += 6) {
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Math.abs(heldUpload[offset + channel] - expectedHeldGeometry[offset + channel]) < 1e-6,
      `oak sapling vertex color ${offset / 6}:${channel} retains canonical inventory-art parity`);
  }
}
assert.equal(heldRenderer[2][1], 0, "oak sapling never falls through to textured full-cube output");
heldRenderer[7]();
const held = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
for (const sharedPath of ["getItemIconArt(itemId)", "appendItemSpriteGeometry("]) {
  assert.ok(held.includes(sharedPath), `held saplings use the shared visual pipeline through ${sharedPath}`);
}
assert.equal(held.includes("appendColorBox"), false,
  "the removed bespoke color-box held approximation cannot return");
assert.equal(held.includes("appendSpecialBlock"), false,
  "the removed special-block held approximation cannot bypass shared item art");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engine, /if \(texel\.a < uAlphaCutoff\) discard;/, "sapling holes use alpha testing instead of costly sorted blending");
assert.match(engine, /block === BLOCK\.SAPLING[\s\S]{0,160}appendSaplingMesh\(textureVertices/,
  "saplings share each chunk's retained opaque texture buffer");
assert.match(engine, /!saplingPlacement && playerIntersectsBlock/, "non-colliding saplings do not reject placement inside the player cell");
assert.match(engine, /getBlockAt\(x, y, z\)/, "offline growth can read local clearance without mutating the engine");

console.log("lakecraft sapling crossed-quad and bone-meal visual tests: ok");
