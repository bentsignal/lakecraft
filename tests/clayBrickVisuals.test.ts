import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockTextureForFace, type BlockFace } from "../client/game/blockTextures.ts";
import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
} from "../client/game/generated/textureAtlas.ts";
import { blockHasCollision, blockMaterialColor, blockOccludesFaces } from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";

const faces: readonly BlockFace[] = ["east", "west", "top", "bottom", "south", "north"];
assert.equal(BLOCK.CLAY, 31, "clay appends after the deployed slab engine identity");
assert.equal(BLOCK.BRICKS, 32, "bricks append after clay without renumbering earlier blocks");

for (const [block, texture] of [[BLOCK.CLAY, "clay"], [BLOCK.BRICKS, "bricks"]] as const) {
  assert.equal(blockHasCollision(block), true, `${texture} remains a full collision cube`);
  assert.equal(blockOccludesFaces(block), true, `${texture} stays in the opaque terrain batch`);
  for (const face of faces) assert.equal(blockTextureForFace(block, face), texture);
}
assert.deepEqual(blockMaterialColor(BLOCK.CLAY), [0.58, 0.64, 0.70]);
assert.deepEqual(blockMaterialColor(BLOCK.BRICKS), [0.68, 0.28, 0.20]);

function tileColors(name: "clay" | "bricks"): Map<string, number> {
  const index = TEXTURE_ATLAS_NAMES.indexOf(name);
  assert.ok(index >= 28, `${name} appends into existing atlas capacity`);
  const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
  const colors = new Map<string, number>();
  for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
      const tileX = index % TEXTURE_ATLAS_COLUMNS;
      const tileY = Math.floor(index / TEXTURE_ATLAS_COLUMNS);
      const offset = ((tileY * TEXTURE_TILE_SIZE + y) * atlasWidth + tileX * TEXTURE_TILE_SIZE + x) * 4;
      const rgba = `${TEXTURE_ATLAS_RGBA[offset]},${TEXTURE_ATLAS_RGBA[offset + 1]},${TEXTURE_ATLAS_RGBA[offset + 2]},${TEXTURE_ATLAS_RGBA[offset + 3]}`;
      colors.set(rgba, (colors.get(rgba) ?? 0) + 1);
      assert.equal(TEXTURE_ATLAS_RGBA[offset + 3], 255, `${name} does not require a transparent draw pass`);
    }
  }
  return colors;
}

const clayColors = tileColors("clay");
const brickColors = tileColors("bricks");
assert.equal(TEXTURE_ATLAS_NAMES.indexOf("clay"), 28);
assert.equal(TEXTURE_ATLAS_NAMES.indexOf("bricks"), 29);
assert.equal(clayColors.size, 4, "clay uses a restrained original four-tone surface");
assert.ok((clayColors.get("153,170,187,255") ?? 0) > 200, "smooth compressed clay remains the dominant read");
assert.equal(brickColors.size, 5, "fired masonry uses five warm tones including mortar");
assert.ok((brickColors.get("68,51,51,255") ?? 0) >= 70, "deep mortar keeps staggered courses legible at 16px");

for (const block of ["clay", "bricks"] as const) {
  const art = getItemIconArt(block);
  assert.equal(art.family, "block");
  assert.equal(art.variant, block);
  assert.ok(art.runs.length >= 25, `${block} has detailed original three-face voxel art`);
}
for (const material of ["clay_ball", "brick"] as const) {
  const art = getItemIconArt(material);
  assert.equal(art.family, "material");
  assert.equal(art.variant, material);
  assert.ok(art.runs.length >= 18, `${material} has original readable 16x16 item art`);
  assert.notDeepEqual(art.runs, getItemIconArt(material === "brick" ? "clay_ball" : "brick").runs);
}

const heldRenderer = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
assert.ok(heldRenderer.includes("blockTextureForFace(block, face[0])") && heldRenderer.includes("textureAtlasUv(texture)"),
  "held clay and bricks reuse their exact world-atlas surface tiles on solid cubes");

for (const relative of ["../client/index.tsx", "../client/singleplayer/SinglePlayerApp.tsx"] as const) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  assert.match(source, /\[BLOCK\.CLAY\]:\s*"clay"/);
  assert.match(source, /\[BLOCK\.BRICKS\]:\s*"bricks"/);
  assert.match(source, /clay:\s*BLOCK\.CLAY/);
  assert.match(source, /bricks:\s*BLOCK\.BRICKS/);
}
const rendererSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(rendererSource, /block === BLOCK\.GLASS \? transparentVertices : textureVertices/,
  "all other atlas cubes, including clay and bricks, reuse the existing opaque VBO");

console.log("lakecraft clay and brick client visuals tests: ok");
