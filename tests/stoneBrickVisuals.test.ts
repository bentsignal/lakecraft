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

assert.equal(BLOCK.STONE_BRICKS, 26, "stone bricks append after saplings without renumbering existing blocks");
assert.equal(blockHasCollision(BLOCK.STONE_BRICKS), true, "stone bricks retain full-cube collision");
assert.equal(blockOccludesFaces(BLOCK.STONE_BRICKS), true, "opaque masonry hides adjacent cube faces");
assert.deepEqual(blockMaterialColor(BLOCK.STONE_BRICKS), [0.43, 0.45, 0.43]);
for (const face of ["east", "west", "top", "bottom", "south", "north"] as readonly BlockFace[]) {
  assert.equal(blockTextureForFace(BLOCK.STONE_BRICKS, face), "stone_bricks");
}

const stoneBrickIndex = TEXTURE_ATLAS_NAMES.indexOf("stone_bricks");
assert.equal(stoneBrickIndex, 27, "stone bricks append after every previously shipped texture tile");
const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const colors = new Map<string, number>();
for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) {
  for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const tileX = stoneBrickIndex % TEXTURE_ATLAS_COLUMNS;
    const tileY = Math.floor(stoneBrickIndex / TEXTURE_ATLAS_COLUMNS);
    const offset = ((tileY * TEXTURE_TILE_SIZE + y) * atlasWidth + tileX * TEXTURE_TILE_SIZE + x) * 4;
    const rgb = `${TEXTURE_ATLAS_RGBA[offset]},${TEXTURE_ATLAS_RGBA[offset + 1]},${TEXTURE_ATLAS_RGBA[offset + 2]}`;
    colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
    assert.equal(TEXTURE_ATLAS_RGBA[offset + 3], 255, "stone bricks stay in the opaque terrain pass");
  }
}
assert.equal(colors.size, 5, "masonry uses a restrained five-tone stone palette");
assert.ok((colors.get("68,68,68") ?? 0) >= 70, "dark one-pixel mortar keeps staggered courses readable");
assert.equal(colors.has("153,153,136"), true, "worn warm highlights distinguish bricks from smooth stone");

const art = getItemIconArt("stone_bricks");
assert.equal(art.family, "block");
assert.equal(art.variant, "stone_bricks");
assert.ok(art.runs.length >= 30, "inventory masonry carries brick joints across its three-face cube");
assert.notDeepEqual(art.runs, getItemIconArt("stone").runs);
assert.notDeepEqual(art.runs, getItemIconArt("cobblestone").runs);
const held = readFileSync(new URL("../client/components/ItemGlyph.tsx", import.meta.url), "utf8");
assert.doesNotMatch(held, /HELD_SPRITE_BLOCKS[^;]*stone_bricks/s,
  "held stone bricks use the ordinary three-face block presentation");
const heldStyles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.match(heldStyles, /data-block="stone_bricks"[^}]+repeating-linear-gradient/,
  "held masonry has staggered brick courses instead of the generic speckle pattern");
assert.match(heldStyles, /data-block="stone_bricks"[^}]+\.lc-held-voxel__face::after/,
  "held masonry disables generic block speckles");

console.log("lakecraft stone-brick material renderer tests: ok");
