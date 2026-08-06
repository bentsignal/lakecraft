import type { ItemId } from "../../shared/game.ts";
import { blockTextureForFace } from "../game/blockTextures.ts";
import {
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "../game/generated/textureAtlas.ts";
import { BLOCK, type BlockId } from "../game/types.ts";

export type AtlasBlockIconRun = Readonly<{ x: number; y: number; width: number; color: string }>;
export type AtlasBlockGuiIcon = Readonly<{
  size: number;
  rgba: Uint8ClampedArray;
  runs: readonly AtlasBlockIconRun[];
}>;

/**
 * GUI block models need more raster samples than their 16px source textures.
 * At 64px every projected face can sample all 16 installed texels before CSS
 * scales the finished model into a hotbar, inventory, or Visual Lab slot.
 */
export const ATLAS_BLOCK_GUI_ICON_SIZE = 64;

const BLOCK_BY_ITEM: Readonly<Partial<Record<ItemId, BlockId>>> = {
  grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND, gravel: BLOCK.GRAVEL, glass: BLOCK.GLASS, coal_ore: BLOCK.COAL_ORE,
  iron_ore: BLOCK.IRON_ORE, gold_ore: BLOCK.GOLD_ORE, diamond_ore: BLOCK.DIAMOND_ORE,
  log: BLOCK.WOOD, leaves: BLOCK.LEAVES, planks: BLOCK.PLANKS,
  crafting_table: BLOCK.CRAFTING_TABLE, furnace: BLOCK.FURNACE, tnt: BLOCK.TNT,
  wool: BLOCK.WOOL, stone_bricks: BLOCK.STONE_BRICKS, clay: BLOCK.CLAY, bricks: BLOCK.BRICKS,
};

type Point = readonly [x: number, y: number, u: number, v: number];
type Grid = string[][];
const guiCache = new Map<ItemId, AtlasBlockGuiIcon>();

function color(texture: TextureAtlasName, u: number, v: number, shade: number): string {
  const index = TEXTURE_ATLAS_NAMES.indexOf(texture);
  if (index < 0) throw new Error();
  const cell = TEXTURE_ATLAS_CELLS[index];
  const x = Math.max(0, Math.min(15, Math.floor(u * TEXTURE_TILE_SIZE)));
  const y = Math.max(0, Math.min(15, Math.floor(v * TEXTURE_TILE_SIZE)));
  const offset = ((Math.floor(cell / TEXTURE_ATLAS_COLUMNS) * 16 + y) * TEXTURE_ATLAS_COLUMNS * 16
    + cell % TEXTURE_ATLAS_COLUMNS * 16 + x) * 4;
  if (TEXTURE_ATLAS_RGBA[offset + 3] < 48) return "";
  const channel = (value: number) => Math.round(value * shade).toString(16).padStart(2, "0");
  return `#${channel(TEXTURE_ATLAS_RGBA[offset])}${channel(TEXTURE_ATLAS_RGBA[offset + 1])}${channel(TEXTURE_ATLAS_RGBA[offset + 2])}`;
}

function triangle(grid: Grid, texture: TextureAtlasName, a: Point, b: Point, c: Point, shade: number): void {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))); y <= Math.min(grid.length - 1, Math.ceil(Math.max(a[1], b[1], c[1]))); y += 1) {
    for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))); x <= Math.min(grid.length - 1, Math.ceil(Math.max(a[0], b[0], c[0]))); x += 1) {
      const sampleX = x + 0.5; const sampleY = y + 0.5;
      const wa = ((b[1] - c[1]) * (sampleX - c[0]) + (c[0] - b[0]) * (sampleY - c[1])) / denominator;
      const wb = ((c[1] - a[1]) * (sampleX - c[0]) + (a[0] - c[0]) * (sampleY - c[1])) / denominator;
      const wc = 1 - wa - wb;
      if (wa < -0.001 || wb < -0.001 || wc < -0.001) continue;
      const pixel = color(texture, wa * a[2] + wb * b[2] + wc * c[2], wa * a[3] + wb * b[3] + wc * c[3], shade);
      if (pixel) grid[y][x] = pixel;
    }
  }
}

function face(grid: Grid, texture: TextureAtlasName, points: readonly [Point, Point, Point, Point], shade: number): void {
  triangle(grid, texture, points[0], points[1], points[2], shade);
  triangle(grid, texture, points[0], points[2], points[3], shade);
}

function gridRuns(grid: Grid): readonly AtlasBlockIconRun[] {
  const result: AtlasBlockIconRun[] = [];
  for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < grid.length;) {
    const value = grid[y][x];
    if (!value) { x += 1; continue; }
    let end = x + 1;
    while (end < grid.length && grid[y][end] === value) end += 1;
    result.push(Object.freeze({ x, y, width: end - x, color: value }));
    x = end;
  }
  return Object.freeze(result);
}

function blockItemGrid(itemId: ItemId, size: number): Grid | undefined {
  const block = BLOCK_BY_ITEM[itemId];
  if (block === undefined) return undefined;
  const top = blockTextureForFace(block, "top");
  const left = blockTextureForFace(block, "north");
  const right = blockTextureForFace(block, "east");
  if (!top || !left || !right) throw new Error(`Missing atlas faces for ${itemId}.`);
  const grid: Grid = Array.from({ length: size }, () => Array<string>(size).fill(""));
  const scale = size / 16;
  const p = (x: number, y: number, u: number, v: number): Point => [x * scale, y * scale, u, v];
  face(grid, top, [p(8, 1, .5, 0), p(14, 4, 1, .5), p(8, 8, .5, 1), p(1, 4, 0, .5)], 1);
  face(grid, left, [p(1, 4, 0, 0), p(8, 8, 1, 0), p(8, 14, 1, 1), p(1, 10, 0, 1)], .8);
  face(grid, right, [p(8, 8, 0, 0), p(14, 4, 1, 0), p(14, 10, 1, 1), p(8, 14, 0, 1)], .6);
  return grid;
}

/** High-resolution UI-only block model; held and world geometry never call this path. */
export function atlasBlockItemGuiIcon(itemId: ItemId): AtlasBlockGuiIcon | undefined {
  const cached = guiCache.get(itemId);
  if (cached) return cached;
  const size = ATLAS_BLOCK_GUI_ICON_SIZE;
  let grid = blockItemGrid(itemId, size);
  if (!grid) return undefined;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (grid[y][x]) {
    const value = Number.parseInt(grid[y][x].slice(1), 16); const offset = (y * size + x) * 4;
    pixels[offset] = value >> 16; pixels[offset + 1] = value >> 8 & 255; pixels[offset + 2] = value & 255; pixels[offset + 3] = 255;
  }
  let iconRuns: readonly AtlasBlockIconRun[] | undefined;
  const icon: AtlasBlockGuiIcon = Object.freeze({
    size,
    rgba: pixels,
    get runs(): readonly AtlasBlockIconRun[] {
      if (!iconRuns) { iconRuns = gridRuns(grid!); grid = undefined; }
      return iconRuns;
    },
  });
  guiCache.set(itemId, icon);
  return icon;
}

/** Reconstruct atlas-backed block icons once, losslessly replacing redundant serialized run data. */
export function atlasBlockItemIconRuns(itemId: ItemId): readonly AtlasBlockIconRun[] | undefined {
  const grid = blockItemGrid(itemId, 16);
  return grid && gridRuns(grid);
}
