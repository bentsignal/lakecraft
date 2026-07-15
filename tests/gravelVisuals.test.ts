import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockTextureForFace, type BlockFace } from "../client/game/blockTextures.ts";
import { TEXTURE_ATLAS_COLUMNS, TEXTURE_ATLAS_NAMES, TEXTURE_ATLAS_RGBA, TEXTURE_TILE_SIZE } from "../client/game/generated/textureAtlas.ts";
import { BLOCK } from "../client/game/types.ts";

const faces: readonly BlockFace[] = ["east", "west", "top", "bottom", "south", "north"];
for (const face of faces) assert.equal(blockTextureForFace(BLOCK.GRAVEL, face), "gravel");

const gravelIndex = TEXTURE_ATLAS_NAMES.indexOf("gravel");
assert.ok(gravelIndex >= 0, "gravel has a generated nearest-neighbor world tile");
const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const colors = new Map<string, number>();
for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) {
  for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const tileX = gravelIndex % TEXTURE_ATLAS_COLUMNS;
    const tileY = Math.floor(gravelIndex / TEXTURE_ATLAS_COLUMNS);
    const offset = ((tileY * TEXTURE_TILE_SIZE + y) * atlasWidth + tileX * TEXTURE_TILE_SIZE + x) * 4;
    const key = `${TEXTURE_ATLAS_RGBA[offset]},${TEXTURE_ATLAS_RGBA[offset + 1]},${TEXTURE_ATLAS_RGBA[offset + 2]}`;
    colors.set(key, (colors.get(key) ?? 0) + 1);
    assert.equal(TEXTURE_ATLAS_RGBA[offset + 3], 255, "gravel remains in the opaque terrain pass");
  }
}
assert.ok(colors.size >= 5, "gravel retains a busy, readable five-tone pebble palette");
assert.ok([...colors].some(([rgb, count]) => rgb === "68,68,68" && count >= 20), "dark pebble clusters distinguish gravel from smooth stone");
assert.ok([...colors].some(([rgb]) => rgb === "136,119,102"), "subtle warm aggregate keeps gravel distinct from cobblestone");

const gravelArt = getItemIconArt("gravel");
assert.equal(gravelArt.family, "block");
assert.equal(gravelArt.variant, "gravel");
assert.ok(gravelArt.runs.length >= 35, "inventory gravel uses a dense pixel-pebble treatment");
assert.notDeepEqual(gravelArt.runs, getItemIconArt("stone").runs);
assert.notDeepEqual(gravelArt.runs, getItemIconArt("cobblestone").runs);
const heldSource = readFileSync(new URL("../client/components/ItemGlyph.tsx", import.meta.url), "utf8");
assert.match(heldSource, /ITEMS\[itemId\]\.category\s*===\s*"block"/);
assert.doesNotMatch(heldSource, /HELD_SPRITE_BLOCKS[^;]*gravel/s, "gravel is not downgraded to a flat held sprite");
assert.match(heldSource, /data-block=\{blockId\}/, "first-person gravel inherits the three-face material cube");

const remoteSource = readFileSync(new URL("../client/game/remotePlayerRenderer.ts", import.meta.url), "utf8");
assert.match(remoteSource, /gravelItem:\s*\[0\.47,\s*0\.45,\s*0\.42\]/);
assert.match(remoteSource, /case\s+"gravel":\s*return\s+COLORS\.gravelItem/);

console.log("lakecraft gravel visual tests: ok");
