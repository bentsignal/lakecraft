import assert from "node:assert/strict";
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

assert.equal(BLOCK.WOOL, 24, "wool appends after deployed gravel without renumbering existing blocks");
const faces: readonly BlockFace[] = ["east", "west", "top", "bottom", "south", "north"];
for (const face of faces) assert.equal(blockTextureForFace(BLOCK.WOOL, face), "wool");
assert.equal(blockHasCollision(BLOCK.WOOL), true, "placed wool keeps full-cube collision");
assert.equal(blockOccludesFaces(BLOCK.WOOL), true, "opaque wool hides adjacent cube faces");
assert.deepEqual(blockMaterialColor(BLOCK.WOOL), [0.86, 0.84, 0.78]);

const woolIndex = TEXTURE_ATLAS_NAMES.indexOf("wool");
assert.equal(woolIndex, 25, "wool appends after every shipped texture tile");
const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const colors = new Map<string, number>();
for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) {
  for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const tileX = woolIndex % TEXTURE_ATLAS_COLUMNS;
    const tileY = Math.floor(woolIndex / TEXTURE_ATLAS_COLUMNS);
    const offset = ((tileY * TEXTURE_TILE_SIZE + y) * atlasWidth + tileX * TEXTURE_TILE_SIZE + x) * 4;
    colors.set(`${TEXTURE_ATLAS_RGBA[offset]},${TEXTURE_ATLAS_RGBA[offset + 1]},${TEXTURE_ATLAS_RGBA[offset + 2]}`, 1);
    assert.equal(TEXTURE_ATLAS_RGBA[offset + 3], 255, "wool remains in the opaque terrain pass");
  }
}
assert.ok(colors.size >= 5, "white wool retains visible woven flecks at 16px");
assert.equal(colors.has("187,187,170"), true, "warm shadow threads break up the pale fleece");
assert.equal(colors.has("255,255,238"), true, "small highlights keep the weave readable");

const art = getItemIconArt("wool");
assert.equal(art.family, "block");
assert.equal(art.variant, "wool");
assert.ok(art.runs.length >= 25, "inventory wool uses a textured three-face cube icon");
assert.notDeepEqual(art.runs, getItemIconArt("sand").runs);

console.log("lakecraft wool block renderer tests: ok");
