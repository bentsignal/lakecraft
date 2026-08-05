import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blockTextureForFace,
  textureAtlasUv,
  type BlockFace,
} from "../client/game/blockTextures.ts";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { createFirstPersonRenderer } from "../client/game/firstPersonRenderer.ts";
import { appendItemSpriteGeometry } from "../client/game/itemSpriteGeometry.ts";
import { BLOCK } from "../client/game/types.ts";
import { itemVisual } from "../shared/visualCatalog.ts";

const faces: readonly BlockFace[] = ["east", "west", "top", "bottom", "south", "north"];
for (const block of [BLOCK.DIRT, BLOCK.GRASS, BLOCK.WOOD, BLOCK.STONE_BRICKS, BLOCK.CLAY, BLOCK.BRICKS]) {
  for (const face of faces) assert.ok(blockTextureForFace(block, face), `held cube face ${face} reuses the world atlas`);
}

function captureGl(): {
  gl: WebGLRenderingContext;
  uploadFor(buffer: WebGLBuffer): Float32Array | undefined;
} {
  let nextBuffer = 0;
  let boundBuffer: WebGLBuffer | null = null;
  const uploads = new Map<WebGLBuffer, Float32Array>();
  const gl = {
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    createBuffer: () => ({ id: ++nextBuffer }),
    bindBuffer: (_target: number, buffer: WebGLBuffer | null) => { boundBuffer = buffer; },
    bufferData: () => undefined,
    bufferSubData: (_target: number, _offset: number, data: Float32Array) => {
      if (boundBuffer) uploads.set(boundBuffer, new Float32Array(data));
    },
    deleteBuffer: () => undefined,
  } as unknown as WebGLRenderingContext;
  return { gl, uploadFor: (buffer) => uploads.get(buffer) };
}

const canonicalFaceCoordinates: Readonly<Record<BlockFace, ReadonlyArray<readonly [number, number]>>> = {
  east: [[0,0],[0,1],[1,1],[0,0],[1,1],[1,0]],
  west: [[1,0],[1,1],[0,1],[1,0],[0,1],[0,0]],
  top: [[0,0],[0,1],[1,1],[0,0],[1,1],[1,0]],
  bottom: [[0,1],[0,0],[1,0],[0,1],[1,0],[1,1]],
  south: [[1,0],[1,1],[0,1],[1,0],[0,1],[0,0]],
  north: [[0,0],[0,1],[1,1],[0,0],[1,1],[1,0]],
};
const captured = captureGl();
const heldRenderer = createFirstPersonRenderer(captured.gl);
for (const [itemId, block] of [
  ["crafting_table", BLOCK.CRAFTING_TABLE],
  ["furnace", BLOCK.FURNACE],
  ["tnt", BLOCK.TNT],
  ["log", BLOCK.WOOD],
] as const) {
  heldRenderer[3](itemId, block);
  const uploaded = captured.uploadFor(heldRenderer[1]);
  assert.ok(uploaded, `${itemId} uploads its directional atlas cube`);
  assert.equal(uploaded.length, 36 * 6);
  faces.forEach((face, faceIndex) => {
    const texture = blockTextureForFace(block, face);
    assert.ok(texture, `${itemId} ${face} resolves a directional tile`);
    const bounds = textureAtlasUv(texture);
    canonicalFaceCoordinates[face].forEach(([horizontal, vertical], vertexIndex) => {
      const offset = (faceIndex * 6 + vertexIndex) * 6;
      const expectedU = bounds.left + (bounds.right - bounds.left) * horizontal;
      const expectedV = bounds.bottom + (bounds.top - bounds.bottom) * vertical;
      assert.ok(Math.abs(uploaded[offset + 3] - expectedU) < 1e-6,
        `${itemId} ${face} vertex ${vertexIndex} keeps canonical horizontal orientation`);
      assert.ok(Math.abs(uploaded[offset + 4] - expectedV) < 1e-6,
        `${itemId} ${face} vertex ${vertexIndex} keeps canonical vertical orientation`);
    });
  });
}
for (const [itemId, block] of [
  ["door", BLOCK.DOOR_CLOSED],
  ["torch", BLOCK.TORCH],
  ["bed", BLOCK.BED],
] as const) {
  assert.equal(itemVisual(itemId).parent, "block", `${itemId} retains its shared block visual definition`);
  assert.equal(blockTextureForFace(block, "east"), null, `${itemId} is not misclassified as a full atlas cube`);
  const expectedVertices = appendItemSpriteGeometry([], getItemIconArt(itemId), {
    center: [0.10, -0.02, -1.17],
    size: 0.76,
    depth: 0.06,
    rotationDegrees: [0, -24, 0],
  });
  heldRenderer[3](itemId, block);
  const uploaded = captured.uploadFor(heldRenderer[0]);
  assert.ok(uploaded, `${itemId} uploads canonical item-sprite geometry`);
  assert.equal(heldRenderer[2][0], expectedVertices, `${itemId} keeps canonical sprite vertex parity`);
  assert.equal(uploaded.length, expectedVertices * 6, `${itemId} uploads exactly one six-float color vertex stream`);
  assert.equal(heldRenderer[2][1], 0, `${itemId} never falls through to full-cube textured geometry`);
}
heldRenderer[7]();

const renderer = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
const cubeFaces = readFileSync(new URL("../client/game/cubeFaces.ts", import.meta.url), "utf8");
assert.ok(renderer.includes("blockTextureForFace(block, face[0])"), "held blocks use the canonical face material resolver");
assert.ok(renderer.includes("textureAtlasUv(texture)"), "held blocks use the canonical half-texel atlas UV resolver");
assert.equal((cubeFaces.match(/\["(east|west|top|bottom|south|north)"/g) ?? []).length, 6,
  "one canonical cube basis has six complete solid faces");
for (const sharedPath of ["itemVisual(itemId)", "getItemIconArt(itemId)", "appendItemSpriteGeometry("]) {
  assert.ok(renderer.includes(sharedPath), `thin placeables use the shared canonical sprite path through ${sharedPath}`);
}
assert.equal(renderer.includes("appendSpecialBlock"), false,
  "the removed arbitrary special-block approximation cannot bypass canonical item art");
assert.equal(renderer.includes("ItemGlyph"), false,
  "first-person geometry shares canonical art data without depending on the inventory UI component");
assert.equal(renderer.includes("<ItemIcon"), false,
  "the WebGL renderer never substitutes a DOM inventory icon for geometry");

const hud = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.equal(hud.includes("lc-held-voxel"), false, "CSS block approximations are removed");
assert.equal(hud.includes("lc-held-sprite"), false, "stacked sprite extrusions are removed");

console.log("canonical held-block WebGL geometry tests passed");
