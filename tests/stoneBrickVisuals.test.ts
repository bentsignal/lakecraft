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

assert.equal(BLOCK.STONE_BRICKS, 26, "stone bricks append after saplings without renumbering existing blocks");
assert.equal(blockHasCollision(BLOCK.STONE_BRICKS), true, "stone bricks retain full-cube collision");
assert.equal(blockOccludesFaces(BLOCK.STONE_BRICKS), true, "opaque masonry hides adjacent cube faces");
assert.deepEqual(blockMaterialColor(BLOCK.STONE_BRICKS), [0.43, 0.45, 0.43]);
for (const face of ["east", "west", "top", "bottom", "south", "north"] as readonly BlockFace[]) {
  assert.equal(blockTextureForFace(BLOCK.STONE_BRICKS, face), "stone_bricks");
}

const stoneBrickIndex = TEXTURE_ATLAS_NAMES.indexOf("stone_bricks");
const stoneBrickCell = TEXTURE_ATLAS_CELLS[stoneBrickIndex];
assert.equal(stoneBrickIndex, 27, "stone bricks append after every previously shipped texture tile");
const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const colors = new Map<string, number>();
const installedStoneBricks = decodePng(Buffer.from(installedBlocks.stone_bricks, "base64"));
assert.deepEqual([installedStoneBricks.width, installedStoneBricks.height], [16, 16]);
for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) {
  for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const tileX = stoneBrickCell % TEXTURE_ATLAS_COLUMNS;
    const tileY = Math.floor(stoneBrickCell / TEXTURE_ATLAS_COLUMNS);
    const offset = ((tileY * TEXTURE_TILE_SIZE + y) * atlasWidth + tileX * TEXTURE_TILE_SIZE + x) * 4;
    const rgb = `${TEXTURE_ATLAS_RGBA[offset]},${TEXTURE_ATLAS_RGBA[offset + 1]},${TEXTURE_ATLAS_RGBA[offset + 2]}`;
    colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
    assert.equal(TEXTURE_ATLAS_RGBA[offset + 3], 255, "stone bricks stay in the opaque terrain pass");
    assert.deepEqual([...TEXTURE_ATLAS_RGBA.subarray(offset, offset + 4)],
      [...installedStoneBricks.rgba.subarray((y * TEXTURE_TILE_SIZE + x) * 4, (y * TEXTURE_TILE_SIZE + x) * 4 + 4)],
      `stone-brick atlas pixel ${x},${y} exactly preserves its installed source`);
  }
}
assert.ok(colors.size >= 7, "installed masonry retains distinct stone and mortar tones");
const stoneBrightness = [...colors.keys()].map((rgb) => rgb.split(",").map(Number)
  .reduce((sum, channel) => sum + channel, 0) / 3);
assert.ok(Math.max(...stoneBrightness) - Math.min(...stoneBrightness) >= 50,
  "installed mortar remains visibly darker than its brick faces");

const art = getItemIconArt("stone_bricks");
assert.equal(art.family, "block");
assert.equal(art.variant, "stone_bricks");
assert.ok(art.runs.length >= 30, "inventory masonry carries brick joints across its three-face cube");
assert.notDeepEqual(art.runs, getItemIconArt("stone").runs);
assert.notDeepEqual(art.runs, getItemIconArt("cobblestone").runs);
const held = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
assert.ok(held.includes("blockTextureForFace(block, face[0])") && held.includes("textureAtlasUv(texture)"),
  "held stone bricks reuse the world masonry tile rather than a CSS approximation");

console.log("lakecraft stone-brick material renderer tests: ok");
