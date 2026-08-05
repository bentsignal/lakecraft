import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockTextureForFace, type BlockFace } from "../client/game/blockTextures.ts";
import { TEXTURE_ATLAS_COLUMNS, TEXTURE_ATLAS_NAMES, TEXTURE_ATLAS_RGBA, TEXTURE_TILE_SIZE } from "../client/game/generated/textureAtlas.ts";
import { BLOCK } from "../client/game/types.ts";
import { REMOTE_HELD_ITEM_MAX_RECTS, remoteHeldItemRects } from "../client/game/remotePlayerRenderer.ts";

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
const heldSource = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
assert.ok(heldSource.includes("blockTextureForFace(block, face[0])") && heldSource.includes("textureAtlasUv(texture)"),
  "first-person gravel inherits the canonical six-face world-atlas cube");
assert.match(heldSource, /blockTextureForFace\(block, face\[0\]\)/,
  "the block branch remains atlas-backed even though non-block items use canonical icon art");

const remoteGravel = remoteHeldItemRects("gravel");
assert.ok(remoteGravel.length >= 16 && remoteGravel.length <= REMOTE_HELD_ITEM_MAX_RECTS,
  "remote gravel keeps a dense but strictly bounded canonical pebble mip");
const gravelPalette = new Set(gravelArt.runs.map((run) => run.color.toLowerCase()));
for (const rect of remoteGravel) {
  const color = `#${rect.color.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
  assert.ok(gravelPalette.has(color), "remote gravel uses only canonical catalog colors");
}

console.log("lakecraft gravel visual tests: ok");
