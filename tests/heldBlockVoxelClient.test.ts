import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blockTextureForFace,
  textureAtlasUv,
  type BlockFace,
} from "../client/game/blockTextures.ts";
import { createFirstPersonRenderer } from "../client/game/firstPersonRenderer.ts";
import { BLOCK } from "../client/game/types.ts";

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
  heldRenderer.setHeldItem(itemId, block);
  const uploaded = captured.uploadFor(heldRenderer.texturedBuffer);
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
heldRenderer.destroy();

const renderer = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
const cubeFaces = readFileSync(new URL("../client/game/cubeFaces.ts", import.meta.url), "utf8");
assert.ok(renderer.includes("blockTextureForFace(block, face[0])"), "held blocks use the canonical face material resolver");
assert.ok(renderer.includes("textureAtlasUv(texture)"), "held blocks use the canonical half-texel atlas UV resolver");
assert.equal((cubeFaces.match(/\["(east|west|top|bottom|south|north)"/g) ?? []).length, 6,
  "one canonical cube basis has six complete solid faces");
assert.ok(renderer.includes("appendSpecialBlock"), "thin placeables receive compact solid geometry rather than a sprite exception");
assert.equal(renderer.includes("ItemIcon"), false, "first-person block/tool geometry has no inventory-icon dependency");

const hud = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.equal(hud.includes("lc-held-voxel"), false, "CSS block approximations are removed");
assert.equal(hud.includes("lc-held-sprite"), false, "stacked sprite extrusions are removed");

console.log("canonical held-block WebGL geometry tests passed");
