import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockTextureForFace, type BlockFace } from "../client/game/blockTextures.ts";
import {
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
} from "../client/game/generated/textureAtlas.ts";
import { blockHasCollision, blockMaterialColor, blockOccludesFaces } from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";
import { decodePng } from "../scripts/png-rgba.mjs";

const installedBlocks = (JSON.parse(readFileSync(
  new URL("../scripts/generated/minecraft-visual-assets-v26.2.json", import.meta.url),
  "utf8",
)) as { blocks: Readonly<Record<string, string>> }).blocks;

assert.equal(BLOCK.WOOL, 24, "wool appends after deployed gravel without renumbering existing blocks");
const faces: readonly BlockFace[] = ["east", "west", "top", "bottom", "south", "north"];
for (const face of faces) assert.equal(blockTextureForFace(BLOCK.WOOL, face), "wool");
assert.equal(blockHasCollision(BLOCK.WOOL), true, "placed wool keeps full-cube collision");
assert.equal(blockOccludesFaces(BLOCK.WOOL), true, "opaque wool hides adjacent cube faces");
assert.deepEqual(blockMaterialColor(BLOCK.WOOL), [0.86, 0.84, 0.78]);

const woolIndex = TEXTURE_ATLAS_NAMES.indexOf("wool");
const woolCell = TEXTURE_ATLAS_CELLS[woolIndex];
assert.equal(woolIndex, 25, "wool appends after every shipped texture tile");
const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const colors = new Map<string, number>();
const installedWool = decodePng(Buffer.from(installedBlocks.wool, "base64"));
assert.deepEqual([installedWool.width, installedWool.height], [16, 16]);
for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) {
  for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const tileX = woolCell % TEXTURE_ATLAS_COLUMNS;
    const tileY = Math.floor(woolCell / TEXTURE_ATLAS_COLUMNS);
    const offset = ((tileY * TEXTURE_TILE_SIZE + y) * atlasWidth + tileX * TEXTURE_TILE_SIZE + x) * 4;
    colors.set(`${TEXTURE_ATLAS_RGBA[offset]},${TEXTURE_ATLAS_RGBA[offset + 1]},${TEXTURE_ATLAS_RGBA[offset + 2]}`, 1);
    assert.equal(TEXTURE_ATLAS_RGBA[offset + 3], 255, "wool remains in the opaque terrain pass");
    assert.deepEqual([...TEXTURE_ATLAS_RGBA.subarray(offset, offset + 4)],
      [...installedWool.rgba.subarray((y * TEXTURE_TILE_SIZE + x) * 4, (y * TEXTURE_TILE_SIZE + x) * 4 + 4)],
      `wool atlas pixel ${x},${y} exactly preserves its installed source`);
  }
}
assert.ok(colors.size >= 32, "installed white wool retains subtle woven variation at 16px");
const woolBrightness = [...colors.keys()].map((rgb) => rgb.split(",").map(Number)
  .reduce((sum, channel) => sum + channel, 0) / 3);
assert.ok(Math.min(...woolBrightness) >= 200 && Math.max(...woolBrightness) >= 250,
  "installed white wool remains pale while preserving visible shadow threads");

const art = getItemIconArt("wool");
assert.equal(art.family, "block");
assert.equal(art.variant, "wool");
assert.ok(art.runs.length >= 25, "inventory wool uses a textured three-face cube icon");
assert.notDeepEqual(art.runs, getItemIconArt("sand").runs);

console.log("lakecraft wool block renderer tests: ok");
