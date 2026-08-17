import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  ATLAS_BLOCK_GUI_ICON_SIZE,
  atlasBlockItemGuiIcon,
  atlasBlockItemIconRuns,
  paintAtlasBlockGuiIcon,
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
  assert.equal(icon.length, ATLAS_BLOCK_GUI_ICON_SIZE ** 2 * 4);
  assert.equal(icon[3], 0, `${itemId} preserves a transparent top-left model edge`);
  assert.equal(icon[(ATLAS_BLOCK_GUI_ICON_SIZE ** 2 - 1) * 4 + 3], 0,
    `${itemId} preserves a transparent bottom-right model edge`);

  let occupied = 0;
  const colors = new Set<string>();
  for (let offset = 0; offset < icon.length; offset += 4) {
    if (!icon[offset + 3]) continue;
    occupied += 1;
    colors.add(`${icon[offset]},${icon[offset + 1]},${icon[offset + 2]},${icon[offset + 3]}`);
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

class PixelContext {
  imageSmoothingEnabled = true;
  pixels = new Uint8ClampedArray();
  createImageData(width: number, height: number): ImageData {
    return { data: new Uint8ClampedArray(width * height * 4), width, height } as ImageData;
  }
  putImageData(image: ImageData): void { this.pixels = new Uint8ClampedArray(image.data); }
}
function renderedPixels(itemId: "dirt" | "glass"): Uint8ClampedArray {
  const context = new PixelContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => kind === "2d" ? context : null,
  } as unknown as HTMLCanvasElement;
  const icon = atlasBlockItemGuiIcon(itemId)!;
  paintAtlasBlockGuiIcon(canvas, icon);
  assert.equal(context.imageSmoothingEnabled, false, `${itemId} disables canvas interpolation`);
  assert.equal(canvas.width, ATLAS_BLOCK_GUI_ICON_SIZE); assert.equal(canvas.height, ATLAS_BLOCK_GUI_ICON_SIZE);
  assert.deepEqual(context.pixels, icon, `${itemId} rendered pixels exactly match the cached RGBA`);
  return context.pixels;
}
const opaquePixels = renderedPixels("dirt");
const cutoutPixels = renderedPixels("glass");
assert.ok(opaquePixels.some((value, index) => index % 4 === 3 && value === 255 && cutoutPixels[index] === 0),
  "alpha-cutout glass keeps transparent projected texels where opaque dirt paints pixels");

for (const itemId of ["dirt", "sand"] as const) {
  const icon = atlasBlockItemGuiIcon(itemId)!;
  let minX = 64; let minY = 64; let maxX = -1; let maxY = -1; let sumX = 0; let sumY = 0; let count = 0;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    if (!icon[(y * 64 + x) * 4 + 3]) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    sumX += x; sumY += y; count += 1;
  }
  assert.deepEqual([minX, minY, maxX, maxY], [0, 0, 63, 63], `${itemId} fills the canonical 16px GUI projection`);
  assert.deepEqual([sumX / count, sumY / count], [31.5, 31.5], `${itemId} is exactly centered rather than inset or offset`);
}

for (const flatOrSpecial of ["iron_ingot", "coal", "leather", "chest", "oak_fence"] as const) {
  assert.equal(atlasBlockItemGuiIcon(flatOrSpecial), undefined,
    `${flatOrSpecial} keeps its exact installed sprite or installed special-model render`);
}
for (const shaped of ["stone_brick_slab", "oak_slab", "cobblestone_stairs", "brick_stairs"] as const) {
  const icon = atlasBlockItemGuiIcon(shaped)!;
  assert.ok(icon.some((value, index) => index % 4 === 3 && value === 255),
    `${shaped} uses a textured runtime-rendered building silhouette`);
  let minX = 64; let minY = 64; let maxX = -1; let maxY = -1;
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    if (!icon[(y * 64 + x) * 4 + 3]) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  assert.ok(minX >= 4 && minY >= 4 && maxX <= 59 && maxY <= 59,
    `${shaped} stays inside the installed GUI-model envelope instead of touching slot chrome`);
  if (shaped.endsWith("_stairs")) {
    let upperX = 0; let upperPixels = 0;
    for (let y = 0; y < 24; y += 1) for (let x = 0; x < 64; x += 1) {
      if (!icon[(y * 64 + x) * 4 + 3]) continue;
      upperX += x; upperPixels += 1;
    }
    assert.ok(upperPixels > 0 && upperX / upperPixels < 28,
      `${shaped} rises at the back-left and opens toward the front-right like Minecraft's GUI model`);
  }
}

const itemGlyphSource = readFileSync(new URL("../client/components/ItemGlyph.tsx", import.meta.url), "utf8");
assert.match(itemGlyphSource, /atlasBlockItemGuiIcon\(stack\.itemId\)/,
  "inventory, hotbar, creative, chest, and Visual Lab ItemIcon surfaces share the GUI model raster");
assert.match(itemGlyphSource, /<canvas[\s\S]*data-source-resolution=\{ATLAS_BLOCK_GUI_ICON_SIZE\}[\s\S]*paintAtlasBlockIcon/,
  "high-resolution block models paint into one bounded canvas rather than thousands of DOM pixels");
assert.match(itemGlyphSource, /paintedBlockCanvases\.get\(canvas\) === icon/,
  "routine parent rerenders do not allocate or repaint an unchanged block canvas");
assert.match(itemGlyphSource, /paintedBlockCanvases\.set\(canvas, icon\)/,
  "each mounted block canvas records the exact cached RGBA source it has already painted");
assert.match(itemGlyphSource, /paintAtlasBlockGuiIcon\(canvas, icon\)/,
  "every mounted block canvas paints the exact cached RGBA through the shared pixel copier");
assert.match(itemGlyphSource, /<svg[\s\S]*art\.runs\.map/,
  "installed flat item sprites retain their exact 16×16 SVG path");

const contactSheetSource = readFileSync(new URL("../client/game/contactSheetExport.ts", import.meta.url), "utf8");
assert.match(contactSheetSource, /const guiBlock = atlasBlockItemGuiIcon\(cell\.itemId\)/,
  "exported production contact sheets use the same high-resolution block model source");
assert.match(contactSheetSource, /paintAtlasBlockGuiIcon\(blockCanvas, guiBlock\)[\s\S]*?drawImage\(blockCanvas, cell\.iconX, cell\.iconY, plan\.iconSize, plan\.iconSize\)/,
  "contact sheets draw the exact cached RGBA from one detached canvas with nearest-neighbor scaling");

const atlasSource = readFileSync(new URL("../client/components/atlasBlockItemIcon.ts", import.meta.url), "utf8");
assert.doesNotMatch(atlasSource, /type Grid = string\[\]\[\]|gridRuns|grid!|get runs/,
  "cached 64px GUI icons retain RGBA only, never a string grid or derived run list");
assert.match(atlasSource, /block\/stairs\.json[\s\S]*?box\(0, \.5, 0, \.5, 1, 1\)/,
  "the installed stair upper element is turned into its front-facing 135-degree GUI presentation");

for (const renderer of ["firstPersonRenderer.ts", "voxelEngine.ts", "droppedItemRenderer.ts"] as const) {
  const source = readFileSync(new URL(`../client/game/${renderer}`, import.meta.url), "utf8");
  assert.doesNotMatch(source, /atlasBlockItemGuiIcon/,
    `${renderer} is isolated from the GUI-only fidelity path`);
}

console.log(`high-resolution GUI block icon fidelity checks passed (${ordinaryBlockItems.length} atlas models)`);
