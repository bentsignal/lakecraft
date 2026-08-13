import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { blockTextureForFace, type BlockFace } from "../client/game/blockTextures.ts";
import { TEXTURE_ATLAS_CELLS, TEXTURE_ATLAS_COLUMNS, TEXTURE_ATLAS_NAMES, TEXTURE_ATLAS_RGBA, TEXTURE_TILE_SIZE } from "../client/game/generated/textureAtlas.ts";
import { BLOCK } from "../client/game/types.ts";
import { remoteHeldItemGeometry } from "../client/game/remotePlayerRenderer.ts";
import { decodePng } from "../scripts/png-rgba.mjs";

const installedBlocks = (JSON.parse(readFileSync(
  new URL("../scripts/generated/minecraft-visual-assets-v26.2.json", import.meta.url),
  "utf8",
)) as { blocks: Readonly<Record<string, string>> }).blocks;

const faces: readonly BlockFace[] = ["east", "west", "top", "bottom", "south", "north"];
for (const face of faces) assert.equal(blockTextureForFace(BLOCK.GRAVEL, face), "gravel");

const gravelIndex = TEXTURE_ATLAS_NAMES.indexOf("gravel");
const gravelCell = TEXTURE_ATLAS_CELLS[gravelIndex];
assert.ok(gravelIndex >= 0, "gravel has a generated nearest-neighbor world tile");
const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const colors = new Map<string, number>();
const installedGravel = decodePng(Buffer.from(installedBlocks.gravel, "base64"));
assert.deepEqual([installedGravel.width, installedGravel.height], [16, 16]);
for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) {
  for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const tileX = gravelCell % TEXTURE_ATLAS_COLUMNS;
    const tileY = Math.floor(gravelCell / TEXTURE_ATLAS_COLUMNS);
    const offset = ((tileY * TEXTURE_TILE_SIZE + y) * atlasWidth + tileX * TEXTURE_TILE_SIZE + x) * 4;
    const key = `${TEXTURE_ATLAS_RGBA[offset]},${TEXTURE_ATLAS_RGBA[offset + 1]},${TEXTURE_ATLAS_RGBA[offset + 2]}`;
    colors.set(key, (colors.get(key) ?? 0) + 1);
    assert.equal(TEXTURE_ATLAS_RGBA[offset + 3], 255, "gravel remains in the opaque terrain pass");
    assert.deepEqual([...TEXTURE_ATLAS_RGBA.subarray(offset, offset + 4)],
      [...installedGravel.rgba.subarray((y * TEXTURE_TILE_SIZE + x) * 4, (y * TEXTURE_TILE_SIZE + x) * 4 + 4)],
      `gravel atlas pixel ${x},${y} exactly preserves its installed source`);
  }
}
assert.ok(colors.size >= 8, "installed gravel retains a busy, readable pebble palette");
const gravelBrightness = [...colors.keys()].map((rgb) => rgb.split(",").map(Number).slice(0, 3)
  .reduce((sum, channel) => sum + channel, 0) / 3);
assert.ok(Math.max(...gravelBrightness) - Math.min(...gravelBrightness) >= 70,
  "installed gravel keeps enough light/dark aggregate contrast to remain readable");

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

const remoteGravel = remoteHeldItemGeometry("gravel");
assert.equal(remoteGravel.length / 6, 9_216, "remote gravel uses the exact authored 16x16 face geometry shared with local F5");
assert.ok(new Set(Array.from({ length: remoteGravel.length / 6 }, (_, vertex) => remoteGravel[vertex * 6 + 2])).size > 1,
  "remote gravel retains front/back depth instead of becoming a flat hand quad");

console.log("lakecraft gravel visual tests: ok");
