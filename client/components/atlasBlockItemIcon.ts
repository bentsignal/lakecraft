import type { ItemId } from "../../shared/game.ts";
import { blockIdForCubeItem } from "../game/blockItemCubeGeometry.ts";
import { blockTextureForFace } from "../game/blockTextures.ts";
import {
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "../game/generated/textureAtlas.ts";

export type AtlasBlockIconRun = Readonly<{ x: number; y: number; width: number; color: string }>;

type Point = readonly [x: number, y: number, u: number, v: number];
type Grid = string[][];

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
  for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))); y <= Math.min(15, Math.ceil(Math.max(a[1], b[1], c[1]))); y += 1) {
    for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))); x <= Math.min(15, Math.ceil(Math.max(a[0], b[0], c[0]))); x += 1) {
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

/** Reconstruct atlas-backed block icons once, losslessly replacing redundant serialized run data. */
export function atlasBlockItemIconRuns(itemId: ItemId): readonly AtlasBlockIconRun[] | undefined {
  const block = blockIdForCubeItem(itemId);
  if (block === null) return undefined;
  const top = blockTextureForFace(block, "top");
  const left = blockTextureForFace(block, "north");
  const right = blockTextureForFace(block, "east");
  if (!top || !left || !right) throw new Error(`Missing atlas faces for ${itemId}.`);
  const grid: Grid = Array.from({ length: 16 }, () => Array<string>(16).fill(""));
  face(grid, top, [[8, 1, 0.5, 0], [14, 4, 1, 0.5], [8, 8, 0.5, 1], [1, 4, 0, 0.5]], 1);
  face(grid, left, [[1, 4, 0, 0], [8, 8, 1, 0], [8, 14, 1, 1], [1, 10, 0, 1]], 0.8);
  face(grid, right, [[8, 8, 0, 0], [14, 4, 1, 0], [14, 10, 1, 1], [8, 14, 0, 1]], 0.6);
  const runs: AtlasBlockIconRun[] = [];
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16;) {
    const value = grid[y][x];
    if (!value) { x += 1; continue; }
    let end = x + 1;
    while (end < 16 && grid[y][end] === value) end += 1;
    runs.push(Object.freeze({ x, y, width: end - x, color: value }));
    x = end;
  }
  return Object.freeze(runs);
}
