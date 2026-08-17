import type { ItemId } from "../../shared/game.ts";
import { blockIdForCubeItem } from "../game/blockItemCubeGeometry.ts";
import { blockTextureForFace } from "../game/blockTextures.ts";
import { ITEM_TO_ENGINE } from "../gameplay/catalog.ts";
import {
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "../game/generated/textureAtlas.ts";

export type AtlasBlockIconRun = Readonly<{ x: number; y: number; width: number; color: string }>;
export type AtlasBlockGuiIcon = Uint8ClampedArray;

/**
 * GUI block models need more raster samples than their 16px source textures.
 * At 64px every projected face can sample all 16 installed texels before CSS
 * scales the finished model into a hotbar, inventory, or Visual Lab slot.
 */
export const ATLAS_BLOCK_GUI_ICON_SIZE = 64;

type Point = readonly [x: number, y: number, u: number, v: number];
const guiCache = new Map<ItemId, AtlasBlockGuiIcon>();

function color(texture: TextureAtlasName, u: number, v: number, shade: number): number {
  const index = TEXTURE_ATLAS_NAMES.indexOf(texture);
  if (index < 0) throw new Error();
  const cell = TEXTURE_ATLAS_CELLS[index];
  const x = Math.max(0, Math.min(15, Math.floor(u * TEXTURE_TILE_SIZE)));
  const y = Math.max(0, Math.min(15, Math.floor(v * TEXTURE_TILE_SIZE)));
  const offset = ((Math.floor(cell / TEXTURE_ATLAS_COLUMNS) * 16 + y) * TEXTURE_ATLAS_COLUMNS * 16
    + cell % TEXTURE_ATLAS_COLUMNS * 16 + x) * 4;
  if (TEXTURE_ATLAS_RGBA[offset + 3] < 48) return -1;
  return Math.round(TEXTURE_ATLAS_RGBA[offset] * shade) << 16
    | Math.round(TEXTURE_ATLAS_RGBA[offset + 1] * shade) << 8
    | Math.round(TEXTURE_ATLAS_RGBA[offset + 2] * shade);
}

function triangle(rgba: Uint8ClampedArray, size: number, texture: TextureAtlasName, a: Point, b: Point, c: Point, shade: number): void {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))); y <= Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1]))); y += 1) {
    for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))); x <= Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0]))); x += 1) {
      const sampleX = x + 0.5; const sampleY = y + 0.5;
      const wa = ((b[1] - c[1]) * (sampleX - c[0]) + (c[0] - b[0]) * (sampleY - c[1])) / denominator;
      const wb = ((c[1] - a[1]) * (sampleX - c[0]) + (a[0] - c[0]) * (sampleY - c[1])) / denominator;
      const wc = 1 - wa - wb;
      if (wa < -0.001 || wb < -0.001 || wc < -0.001) continue;
      const pixel = color(texture, wa * a[2] + wb * b[2] + wc * c[2], wa * a[3] + wb * b[3] + wc * c[3], shade);
      if (pixel < 0) continue;
      const offset = (y * size + x) * 4;
      rgba[offset] = pixel >> 16; rgba[offset + 1] = pixel >> 8 & 255; rgba[offset + 2] = pixel & 255; rgba[offset + 3] = 255;
    }
  }
}

function face(rgba: Uint8ClampedArray, size: number, texture: TextureAtlasName, points: readonly [Point, Point, Point, Point], shade: number): void {
  triangle(rgba, size, texture, points[0], points[1], points[2], shade);
  triangle(rgba, size, texture, points[0], points[2], points[3], shade);
}

function rgbaRuns(rgba: Uint8ClampedArray, size: number): readonly AtlasBlockIconRun[] {
  const result: AtlasBlockIconRun[] = [];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size;) {
    const offset = (y * size + x) * 4;
    if (!rgba[offset + 3]) { x += 1; continue; }
    let end = x + 1;
    while (end < size) {
      const next = (y * size + end) * 4;
      if (rgba[next] !== rgba[offset] || rgba[next + 1] !== rgba[offset + 1]
        || rgba[next + 2] !== rgba[offset + 2] || rgba[next + 3] !== rgba[offset + 3]) break;
      end += 1;
    }
    const hex = (rgba[offset] << 16 | rgba[offset + 1] << 8 | rgba[offset + 2]).toString(16).padStart(6, "0");
    result.push(Object.freeze({ x, y, width: end - x, color: `#${hex}` }));
    x = end;
  }
  return Object.freeze(result);
}

function blockItemRgba(itemId: ItemId, size: number): Uint8ClampedArray | undefined {
  const shaped = itemId.endsWith("_slab") || itemId.endsWith("_stairs");
  const block = shaped ? ITEM_TO_ENGINE[itemId] ?? null : blockIdForCubeItem(itemId);
  if (block === null) return undefined;
  const top = blockTextureForFace(block, "top");
  const left = blockTextureForFace(block, "north");
  const right = blockTextureForFace(block, "east");
  if (!top || !left || !right) throw new Error(`Missing atlas faces for ${itemId}.`);
  const rgba = new Uint8ClampedArray(size * size * 4);
  const scale = size / 16;
  const p = (x: number, y: number, u: number, v: number): Point => [x * scale, y * scale, u, v];
  if (shaped) {
    // Minecraft 26.2's installed block/stairs.json authors the upper element
    // at x=8..16 and its GUI display at [30,135,0]/0.625. Our isometric basis
    // already supplies the 135-degree view, so the model-space upper half must
    // be turned into that view: its rise is on the back-left and its tread
    // opens toward the front-right, exactly like the installed GUI model.
    const gui = .84;
    const point = (x: number, y: number, z: number, u: number, v: number): Point =>
      p(8 + (8 * x - 8 * z) * gui, 8 + (4 * x + 4 * z - 8 * y) * gui, u, v);
    const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
      face(rgba, size, top, [point(x0, y1, z0, x0, z0), point(x1, y1, z0, x1, z0),
        point(x1, y1, z1, x1, z1), point(x0, y1, z1, x0, z1)], 1);
      face(rgba, size, left, [point(x0, y1, z1, x0, 1 - y1), point(x1, y1, z1, x1, 1 - y1),
        point(x1, y0, z1, x1, 1 - y0), point(x0, y0, z1, x0, 1 - y0)], .8);
      face(rgba, size, right, [point(x1, y1, z1, z1, 1 - y1), point(x1, y1, z0, z0, 1 - y1),
        point(x1, y0, z0, z0, 1 - y0), point(x1, y0, z1, z1, 1 - y0)], .6);
    };
    box(0, 0, 0, 1, .5, 1);
    if (itemId.endsWith("_stairs")) box(0, .5, 0, .5, 1, 1);
    return rgba;
  }
  face(rgba, size, top, [p(8, 0, .5, 0), p(16, 4, 1, .5), p(8, 8, .5, 1), p(0, 4, 0, .5)], 1);
  face(rgba, size, left, [p(0, 4, 0, 0), p(8, 8, 1, 0), p(8, 16, 1, 1), p(0, 12, 0, 1)], .8);
  face(rgba, size, right, [p(8, 8, 0, 0), p(16, 4, 1, 0), p(16, 12, 1, 1), p(8, 16, 0, 1)], .6);
  return rgba;
}

/** High-resolution UI-only block model; held and world geometry never call this path. */
export function atlasBlockItemGuiIcon(itemId: ItemId): AtlasBlockGuiIcon | undefined {
  const cached = guiCache.get(itemId);
  if (cached) return cached;
  const rgba = blockItemRgba(itemId, ATLAS_BLOCK_GUI_ICON_SIZE);
  if (!rgba) return undefined;
  guiCache.set(itemId, rgba);
  return rgba;
}

/** Copy exact cached pixels into a canvas without browser interpolation. */
export function paintAtlasBlockGuiIcon(canvas: HTMLCanvasElement, icon: AtlasBlockGuiIcon): boolean {
  canvas.width = canvas.height = ATLAS_BLOCK_GUI_ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.imageSmoothingEnabled = false;
  const image = context.createImageData(ATLAS_BLOCK_GUI_ICON_SIZE, ATLAS_BLOCK_GUI_ICON_SIZE);
  image.data.set(icon);
  context.putImageData(image, 0, 0);
  return true;
}

/** Reconstruct atlas-backed block icons once, losslessly replacing redundant serialized run data. */
export function atlasBlockItemIconRuns(itemId: ItemId): readonly AtlasBlockIconRun[] | undefined {
  const rgba = blockItemRgba(itemId, 16);
  return rgba && rgbaRuns(rgba, 16);
}
