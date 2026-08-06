import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  ATLAS_BLOCK_GUI_ICON_SIZE,
  atlasBlockItemGuiIcon,
  atlasBlockItemIconRuns,
} from "../client/components/atlasBlockItemIcon.ts";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import type { ItemId } from "../shared/game.ts";

const ordinaryBlockItems = [
  "grass", "dirt", "stone", "cobblestone", "sand", "gravel", "glass", "coal_ore", "iron_ore",
  "gold_ore", "diamond_ore", "log", "leaves", "planks", "crafting_table", "furnace", "tnt",
  "wool", "stone_bricks", "clay", "bricks",
] as const satisfies readonly ItemId[];

assert.equal(ATLAS_BLOCK_GUI_ICON_SIZE, 64, "GUI block models rasterize above every normal 34–40px inventory surface");
const started = performance.now();
for (const itemId of ordinaryBlockItems) {
  const icon = atlasBlockItemGuiIcon(itemId)!;
  assert.ok(icon, `${itemId} has a high-resolution GUI model`);
  assert.strictEqual(atlasBlockItemGuiIcon(itemId), icon, `${itemId} GUI pixels are reconstructed only once`);
  assert.equal(icon.size, ATLAS_BLOCK_GUI_ICON_SIZE);
  assert.equal(icon.rgba.length, icon.size * icon.size * 4);
  assert.equal(icon.rgba[3], 0, `${itemId} preserves a transparent top-left model edge`);
  assert.equal(icon.rgba[(icon.size * icon.size - 1) * 4 + 3], 0,
    `${itemId} preserves a transparent bottom-right model edge`);

  let occupied = 0;
  const colors = new Set<string>();
  for (let offset = 0; offset < icon.rgba.length; offset += 4) {
    if (!icon.rgba[offset + 3]) continue;
    occupied += 1;
    colors.add(`${icon.rgba[offset]},${icon.rgba[offset + 1]},${icon.rgba[offset + 2]},${icon.rgba[offset + 3]}`);
  }
  assert.ok(occupied > (itemId === "glass" ? 300 : 1_000),
    `${itemId} uses the full projected UI model while preserving installed alpha cutouts`);
  assert.ok(colors.size >= 3, `${itemId} retains installed texture variation and directional face lighting`);

  const legacy = atlasBlockItemIconRuns(itemId)!;
  assert.ok(legacy.every(({ x, y, width }) => x >= 0 && y >= 0 && x + width <= 16 && y < 16),
    `${itemId} keeps its canonical 16×16 art for non-GUI consumers`);
  assert.deepEqual(getItemIconArt(itemId).runs, legacy,
    `${itemId} held/dropped sprite callers retain their reviewed canonical art pixels`);
}
assert.ok(performance.now() - started < 750,
  "all ordinary GUI models rasterize within a bounded one-time startup budget");

for (const flatOrSpecial of ["iron_ingot", "coal", "leather", "chest", "oak_fence", "stone_brick_slab"] as const) {
  assert.equal(atlasBlockItemGuiIcon(flatOrSpecial), undefined,
    `${flatOrSpecial} keeps its exact installed sprite or installed special-model render`);
}

const itemGlyphSource = readFileSync(new URL("../client/components/ItemGlyph.tsx", import.meta.url), "utf8");
assert.match(itemGlyphSource, /atlasBlockItemGuiIcon\(stack\.itemId\)/,
  "inventory, hotbar, creative, chest, and Visual Lab ItemIcon surfaces share the GUI model raster");
assert.match(itemGlyphSource, /<canvas[\s\S]*data-source-resolution=\{guiBlock\.size\}[\s\S]*paintAtlasBlockIcon/,
  "high-resolution block models paint into one bounded canvas rather than thousands of DOM pixels");
assert.match(itemGlyphSource, /paintedBlockCanvases\.get\(canvas\) === icon/,
  "routine parent rerenders do not allocate or repaint an unchanged block canvas");
assert.match(itemGlyphSource, /paintedBlockCanvases\.set\(canvas, icon\)/,
  "each mounted block canvas records the exact cached RGBA source it has already painted");
assert.match(itemGlyphSource, /<svg[\s\S]*art\.runs\.map/,
  "installed flat item sprites retain their exact 16×16 SVG path");

const contactSheetSource = readFileSync(new URL("../client/game/contactSheetExport.ts", import.meta.url), "utf8");
assert.match(contactSheetSource, /const guiBlock = atlasBlockItemGuiIcon\(cell\.itemId\)/,
  "exported production contact sheets use the same high-resolution block model source");
assert.match(contactSheetSource, /plan\.iconSize \/ \(guiBlock\?\.size \?\? ITEM_ICON_SIZE\)/,
  "contact sheets scale each source at its native resolution without enlarging a 16px cube raster");

for (const renderer of ["firstPersonRenderer.ts", "voxelEngine.ts", "droppedItemRenderer.ts"] as const) {
  const source = readFileSync(new URL(`../client/game/${renderer}`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /atlasBlockItemGuiIcon/,
    `${renderer} is isolated from the GUI-only fidelity path`);
}

console.log(`high-resolution GUI block icon fidelity checks passed (${ordinaryBlockItems.length} atlas models)`);
