import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BLOCKS, ITEMS, type ArmorSlot, type BlockId, type ItemId, type ToolKind, type ToolTier } from "../shared/game.ts";
import * as BS from "../shared/bundleStrings.ts";
import { blockTextureForFace } from "../client/game/blockTextures.ts";
import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "../client/game/generated/textureAtlas.ts";
import { BLOCK, type BlockId as EngineBlockId } from "../client/game/types.ts";
import { encodeStaticBytes } from "./static-byte-encoding.mjs";

export const ITEM_ICON_SIZE = 16;
export type ItemIconFamily = "block" | "material" | "tool" | "armor" | "food";
export type ItemIconRun = Readonly<{ x: number; y: number; width: number; color: string }>;
export type ItemIconArt = Readonly<{ family: ItemIconFamily; variant: string; runs: readonly ItemIconRun[] }>;

type Grid = string[][];
type Palette = Record<string, string>;
const cache = new Map<ItemId, ItemIconArt>();

const ENGINE_BLOCK_BY_ITEM: Readonly<Partial<Record<BlockId, EngineBlockId>>> = Object.freeze({
  grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND, gravel: BLOCK.GRAVEL, glass: BLOCK.GLASS, coal_ore: BLOCK.COAL_ORE,
  iron_ore: BLOCK.IRON_ORE, gold_ore: BLOCK.GOLD_ORE, diamond_ore: BLOCK.DIAMOND_ORE,
  log: BLOCK.WOOD, leaves: BLOCK.LEAVES, planks: BLOCK.PLANKS,
  crafting_table: BLOCK.CRAFTING_TABLE, furnace: BLOCK.FURNACE, tnt: BLOCK.TNT,
  wool: BLOCK.WOOL, stone_bricks: BLOCK.STONE_BRICKS, clay: BLOCK.CLAY, bricks: BLOCK.BRICKS,
});

/** Original deterministic 16x16 art shared by every inventory-like surface. */
export function getItemIconArt(itemId: ItemId): ItemIconArt {
  const cached = cache.get(itemId);
  if (cached) return cached;
  const item = ITEMS[itemId];
  const grid = makeGrid();
  let palette: Palette;
  let variant = itemId;
  if (itemId === "sapling") palette = sapling(grid);
  else if (itemId === BS.oakFence) palette = oakFence(grid);
  else if (itemId === BS.oakFenceGate) palette = oakFenceGate(grid);
  else if (itemId === BS.stoneBrickSlab) palette = stoneBrickSlab(grid);
  else if (item.category === "block") palette = block(grid, itemId as BlockId);
  else if (itemId === "bow") {
    palette = bow(grid);
  } else if (itemId === BS.flintAndSteel) {
    palette = flintAndSteel(grid);
  } else if (itemId === "shears") {
    palette = shears(grid);
  } else if (item.category === "tool" && item.tool) {
    palette = tool(grid, item.tool.kind, item.tool.tier);
    variant = `${item.tool.tier}-${item.tool.kind}`;
  } else if (item.category === "armor" && item.armor) {
    palette = armor(grid, item.armor.slot, item.color);
    variant = `${armorMaterial(itemId)}-${item.armor.slot}`;
  } else if (item.category === "food") palette = food(grid, itemId);
  else palette = material(grid, itemId);
  const art = Object.freeze({ family: item.category, variant, runs: Object.freeze(runs(grid, palette)) });
  cache.set(itemId, art);
  return art;
}

const makeGrid = (): Grid => Array.from({ length: ITEM_ICON_SIZE }, () => Array<string>(ITEM_ICON_SIZE).fill(""));
function px(g: Grid, x: number, y: number, tone: string): void { if (x >= 0 && y >= 0 && x < 16 && y < 16) g[y][x] = tone; }
function box(g: Grid, x: number, y: number, w: number, h: number, tone: string): void {
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) px(g, xx, yy, tone);
}
function dots(g: Grid, tone: string, cells: readonly (readonly [number, number])[]): void { for (const [x, y] of cells) px(g, x, y, tone); }
function diagonal(g: Grid, x: number, y: number, dx: number, dy: number, length: number, tone: string, thick = 1): void {
  for (let i = 0; i < length; i += 1) box(g, x + dx * i, y + dy * i, thick, thick, tone);
}
function line(g: Grid, fromX: number, fromY: number, toX: number, toY: number, tone: string): void {
  let x = fromX; let y = fromY;
  const dx = Math.abs(toX - fromX); const sx = fromX < toX ? 1 : -1;
  const dy = -Math.abs(toY - fromY); const sy = fromY < toY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    px(g, x, y, tone);
    if (x === toX && y === toY) return;
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
}

/** Bresenham line with an orthogonal bridge at every diagonal step. */
function connectedLine(g: Grid, fromX: number, fromY: number, toX: number, toY: number, tone: string): void {
  let x = fromX; let y = fromY;
  const dx = Math.abs(toX - fromX); const sx = fromX < toX ? 1 : -1;
  const dy = -Math.abs(toY - fromY); const sy = fromY < toY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    px(g, x, y, tone);
    if (x === toX && y === toY) return;
    const doubled = error * 2;
    let nextX = x; let nextY = y;
    if (doubled >= dy) { error += dy; nextX += sx; }
    if (doubled <= dx) { error += dx; nextY += sy; }
    if (nextX !== x && nextY !== y) px(g, nextX, y, tone);
    x = nextX; y = nextY;
  }
}

/** Stamp a reviewed 16×16 pixel plan. Dots are transparent; letters are palette tones. */
function stamp(g: Grid, rows: readonly string[]): void {
  for (let y = 0; y < Math.min(ITEM_ICON_SIZE, rows.length); y += 1) {
    for (let x = 0; x < Math.min(ITEM_ICON_SIZE, rows[y].length); x += 1) {
      if (rows[y][x] !== ".") px(g, x, y, rows[y][x]);
    }
  }
}

type TexturePoint = readonly [x: number, y: number, u: number, v: number];

function atlasPixel(name: TextureAtlasName, u: number, v: number): readonly [number, number, number, number] {
  const index = TEXTURE_ATLAS_NAMES.indexOf(name);
  const tileX = index % TEXTURE_ATLAS_COLUMNS;
  const tileY = Math.floor(index / TEXTURE_ATLAS_COLUMNS);
  const x = Math.max(0, Math.min(TEXTURE_TILE_SIZE - 1, Math.floor(u * TEXTURE_TILE_SIZE)));
  const y = Math.max(0, Math.min(TEXTURE_TILE_SIZE - 1, Math.floor(v * TEXTURE_TILE_SIZE)));
  const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
  const offset = ((tileY * TEXTURE_TILE_SIZE + y) * atlasWidth + tileX * TEXTURE_TILE_SIZE + x) * 4;
  return [TEXTURE_ATLAS_RGBA[offset], TEXTURE_ATLAS_RGBA[offset + 1], TEXTURE_ATLAS_RGBA[offset + 2], TEXTURE_ATLAS_RGBA[offset + 3]];
}

function nearestTone(palette: Palette, rgba: readonly [number, number, number, number], shade: number): string {
  if (rgba[3] < 48) return "";
  const source = [rgba[0] * shade, rgba[1] * shade, rgba[2] * shade];
  let best = "t";
  let bestDistance = Infinity;
  for (const tone of ["t", "l", "r", "a", "h", "d"] as const) {
    const candidate = parse(palette[tone]);
    const distance = (source[0] - candidate[0]) ** 2 + (source[1] - candidate[1]) ** 2 + (source[2] - candidate[2]) ** 2;
    if (distance < bestDistance) { best = tone; bestDistance = distance; }
  }
  return best;
}

function texturedTriangle(
  g: Grid,
  palette: Palette,
  texture: TextureAtlasName,
  a: TexturePoint,
  b: TexturePoint,
  c: TexturePoint,
  shade: number,
): void {
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(15, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(15, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const sampleX = x + 0.5; const sampleY = y + 0.5;
    const wa = ((b[1] - c[1]) * (sampleX - c[0]) + (c[0] - b[0]) * (sampleY - c[1])) / denominator;
    const wb = ((c[1] - a[1]) * (sampleX - c[0]) + (a[0] - c[0]) * (sampleY - c[1])) / denominator;
    const wc = 1 - wa - wb;
    if (wa < -0.001 || wb < -0.001 || wc < -0.001) continue;
    const u = wa * a[2] + wb * b[2] + wc * c[2];
    const v = wa * a[3] + wb * b[3] + wc * c[3];
    const tone = nearestTone(palette, atlasPixel(texture, u, v), shade);
    if (tone) px(g, x, y, tone);
  }
}

function texturedQuad(
  g: Grid,
  palette: Palette,
  texture: TextureAtlasName,
  points: readonly [TexturePoint, TexturePoint, TexturePoint, TexturePoint],
  shade: number,
): void {
  texturedTriangle(g, palette, texture, points[0], points[1], points[2], shade);
  texturedTriangle(g, palette, texture, points[0], points[2], points[3], shade);
}

function atlasBlock(g: Grid, id: BlockId, engineBlock: EngineBlockId): Palette {
  const b = BLOCKS[id];
  const p = { o: mix(b.color, "#151817", .7), t: mix(b.color, "#ffffff", .3), l: mix(b.color, "#ffffff", .08), r: mix(b.color, "#000000", .25), a: b.accent, h: mix(b.accent, "#ffffff", .28), d: mix(b.accent, "#000000", .35) };
  const top = blockTextureForFace(engineBlock, "top");
  const left = blockTextureForFace(engineBlock, "north");
  const right = blockTextureForFace(engineBlock, "east");
  if (!top || !left || !right) return p;
  const topPoints = [[8,1,0.5,0],[14,4,1,0.5],[8,8,0.5,1],[1,4,0,0.5]] as const;
  const leftPoints = [[1,4,0,0],[8,8,1,0],[8,14,1,1],[1,10,0,1]] as const;
  const rightPoints = [[8,8,0,0],[14,4,1,0],[14,10,1,1],[8,14,0,1]] as const;
  texturedQuad(g, p, top, topPoints, 1.06);
  texturedQuad(g, p, left, leftPoints, 0.9);
  texturedQuad(g, p, right, rightPoints, 0.72);
  for (const [fromX, fromY, toX, toY] of [
    [8,1,14,4],[14,4,14,10],[14,10,8,14],[8,14,1,10],[1,10,1,4],[1,4,8,1],
    [1,4,8,8],[14,4,8,8],[8,8,8,14],
  ] as const) line(g, fromX, fromY, toX, toY, "o");
  return p;
}

function block(g: Grid, id: BlockId): Palette {
  if (id === "torch") return torch(g);
  if (id === "door") return door(g);
  if (id === "bed") return bed(g);
  if (id === "ladder") return ladder(g);
  const engineBlock = ENGINE_BLOCK_BY_ITEM[id];
  if (engineBlock !== undefined) return atlasBlock(g, id, engineBlock);
  const b = BLOCKS[id];
  const p = { o: mix(b.color, "#151817", .7), t: mix(b.color, "#ffffff", .3), l: mix(b.color, "#ffffff", .08), r: mix(b.color, "#000000", .25), a: b.accent, h: mix(b.accent, "#ffffff", .28), d: mix(b.accent, "#000000", .35) };
  // Three-faced voxel silhouette: bright top, mid left, shaded right.
  for (let y = 1; y <= 6; y += 1) {
    const start = 7 - y, end = 8 + y;
    for (let x = start; x <= end; x += 1) px(g, x, y, x === start || x === end ? "o" : "t");
  }
  for (let y = 7; y <= 13; y += 1) {
    const start = y - 6, end = 21 - y;
    for (let x = start; x <= 7; x += 1) px(g, x, y, x === start || x === 7 ? "o" : "l");
    for (let x = 8; x <= end; x += 1) px(g, x, y, x === 8 || x === end ? "o" : "r");
  }
  decorateBlock(g, id);
  return p;
}

function decorateBlock(g: Grid, id: BlockId): void {
  if ([BS.coalOre, BS.ironOre, BS.goldOre, BS.diamondOre].includes(id)) {
    dots(g, "a", [[7,3],[10,5],[5,6],[4,9],[6,11],[10,9],[12,8],[9,12]]); dots(g, "h", [[8,3],[5,9],[11,8]]); return;
  }
  switch (id) {
    case "grass": dots(g,"a",[[6,2],[9,3],[4,5],[12,5],[3,8],[6,8],[10,7],[12,9]]); dots(g,"d",[[4,10],[6,12],[11,11]]); break;
    case "dirt": case "sand": case "stone": dots(g,"a",[[7,3],[4,5],[11,5],[3,9],[6,11],[11,9],[9,12]]); break;
    case "clay":
      dots(g,"d",[[5,2],[10,3],[3,6],[8,5],[12,7],[5,9],[9,10],[6,12]]);
      dots(g,"h",[[7,3],[4,5],[11,6],[3,9],[8,11],[11,10]]);
      break;
    case "gravel":
      dots(g,"d",[[5,2],[9,3],[4,5],[7,6],[11,5],[3,8],[6,10],[10,9],[12,11],[7,12]]);
      dots(g,"h",[[7,3],[11,4],[5,6],[9,7],[4,10],[8,11],[11,10]]);
      dots(g,"a",[[6,2],[10,3],[3,6],[8,5],[12,7],[5,9],[9,10],[6,12]]);
      break;
    case BS.cobblestone: box(g,4,4,4,1,"d"); box(g,8,7,4,1,"d"); dots(g,"a",[[3,6],[7,5],[5,10],[11,10],[8,12]]); break;
    case BS.stoneBricks:
      box(g,3,5,10,1,"d"); box(g,3,9,10,1,"d");
      box(g,7,2,1,4,"d"); box(g,5,6,1,4,"d"); box(g,9,6,1,4,"d"); box(g,7,10,1,3,"d");
      dots(g,"h",[[4,4],[8,3],[10,7],[6,8],[4,11],[9,11]]);
      break;
    case "bricks":
      box(g,3,5,10,1,"d"); box(g,3,9,10,1,"d");
      box(g,7,2,1,4,"d"); box(g,5,6,1,4,"d"); box(g,9,6,1,4,"d"); box(g,7,10,1,3,"d");
      dots(g,"h",[[4,4],[8,3],[10,7],[6,8],[4,11],[9,11]]);
      dots(g,"a",[[5,3],[11,5],[4,8],[10,10]]);
      break;
    case "glass": dots(g,"h",[[6,2],[7,2],[3,5],[4,5],[3,8],[11,8],[10,10]]); break;
    case "log": box(g,5,4,6,1,"d"); dots(g,"a",[[7,2],[6,3],[9,3],[8,5],[4,8],[5,10],[11,9]]); break;
    case "leaves": dots(g,"a",[[6,2],[9,2],[4,5],[7,5],[11,5],[3,8],[6,9],[11,8],[9,11]]); dots(g,"d",[[8,3],[5,6],[10,7],[5,11]]); break;
    case "planks": box(g,3,6,10,1,"d"); box(g,3,10,4,1,"d"); box(g,9,8,4,1,"d"); break;
    case BS.craftingTable: box(g,4,4,3,2,"d"); box(g,9,4,3,2,"d"); box(g,4,9,3,2,"a"); box(g,10,9,2,2,"a"); break;
    case "furnace": box(g,4,8,4,3,"d"); box(g,9,7,3,3,"o"); dots(g,"h",[[5,8],[6,8]]); break;
    case "chest": box(g,3,8,10,1,"d"); box(g,7,7,2,4,"h"); break;
    case "tnt": box(g,3,7,10,3,"h"); box(g,4,8,8,1,"o"); dots(g,"a",[[5,2],[10,3],[4,5],[11,11],[6,12]]); break;
    case "wool":
      dots(g,"d",[[5,2],[9,3],[4,5],[7,6],[11,5],[3,8],[6,10],[10,9],[12,11],[7,12]]);
      dots(g,"h",[[7,3],[11,4],[5,6],[9,7],[4,10],[8,11],[11,10]]);
      break;
    default: dots(g,"a",[[6,3],[10,5],[4,9],[10,10]]);
  }
}

function torch(g: Grid): Palette {
  const p = { o:"#402719", w:"#9a6435", h:"#dca85a", f:"#ffdf55", a:"#ff8a2d", r:"#c8451e" };
  box(g,7,6,3,8,"o"); box(g,8,6,1,8,"w"); box(g,6,4,5,3,"r"); box(g,7,2,3,4,"a"); box(g,8,1,2,4,"f"); px(g,9,3,"h"); return p;
}
function door(g: Grid): Palette {
  const p = { o:"#422817", b:"#8c572d", l:"#c58a49", d:"#68401f", h:"#e4bd6b" };
  box(g,3,1,10,14,"o"); box(g,4,2,8,12,"b"); box(g,5,3,3,4,"d"); box(g,9,3,2,4,"l"); box(g,5,9,6,4,"l"); px(g,10,8,"h"); return p;
}
function bed(g: Grid): Palette {
  const p = { o:"#3b2924", w:"#f0ead9", s:"#c9c2b2", r:"#b54f48", d:"#78352f", l:"#ba8146" };
  box(g,1,6,14,7,"o"); box(g,2,6,5,5,"w"); box(g,7,6,7,5,"r"); box(g,3,11,2,4,"l"); box(g,11,11,2,4,"l"); box(g,7,7,1,4,"d"); px(g,3,7,"s"); return p;
}
function ladder(g: Grid): Palette {
  const p = { o:"#4a2c18", w:"#9d6635", h:"#d3a15b" };
  box(g,3,1,3,14,"o"); box(g,10,1,3,14,"o"); box(g,4,1,1,14,"h"); box(g,11,1,1,14,"w");
  for (const y of [3,7,11]) { box(g,5,y,6,2,"o"); box(g,6,y,4,1,"h"); } return p;
}

function sapling(g: Grid): Palette {
  const p = { o: "#20351d", s: "#644425", w: "#966537", d: "#37612b", m: "#568d3b", l: "#7eb653" };
  box(g, 7, 7, 2, 8, "o"); box(g, 8, 7, 1, 8, "w");
  diagonal(g, 7, 10, -1, -1, 4, "s"); diagonal(g, 8, 9, 1, -1, 4, "s");
  dots(g, "o", [[3,4],[4,3],[5,3],[6,4],[10,3],[11,2],[12,3],[13,4],[2,6],[3,5],[4,6],[5,7],[10,6],[11,5],[12,5],[13,6],[6,2],[7,1],[8,2],[9,3]]);
  dots(g, "m", [[4,4],[5,4],[3,6],[4,6],[5,6],[11,3],[12,4],[11,5],[12,5],[7,2],[8,3],[9,4]]);
  dots(g, "l", [[5,3],[3,5],[12,3],[13,5],[7,1],[10,5]]);
  dots(g, "d", [[4,7],[6,5],[10,4],[11,6],[8,4]]);
  return p;
}

function oakFence(g: Grid): Palette {
  const p = { o: "#3d2818", d: "#76502b", w: "#a8763e", h: "#d0a15b" };
  // Tall central post with two rails receding to either side.
  box(g, 6, 1, 5, 14, "o"); box(g, 7, 2, 3, 12, "w"); box(g, 7, 2, 1, 12, "h");
  for (const y of [5, 10]) {
    box(g, 1, y, 14, 4, "o"); box(g, 2, y + 1, 12, 2, "w");
    box(g, 2, y + 1, 12, 1, "h");
  }
  box(g, 8, 5, 2, 4, "d"); box(g, 8, 10, 2, 4, "d");
  return p;
}

function oakFenceGate(g: Grid): Palette {
  const p = { o: "#3d2818", d: "#76502b", w: "#a8763e", h: "#d0a15b", m: "#4e5551" };
  // Two stout posts frame paired rails and a dark hinge pin.
  box(g, 1, 1, 4, 14, "o"); box(g, 2, 2, 2, 12, "w"); box(g, 2, 2, 1, 12, "h");
  box(g, 11, 1, 4, 14, "o"); box(g, 12, 2, 2, 12, "d"); box(g, 12, 2, 1, 12, "w");
  for (const y of [5, 10]) {
    box(g, 4, y, 8, 4, "o"); box(g, 5, y + 1, 6, 2, "w"); box(g, 5, y + 1, 6, 1, "h");
  }
  box(g, 4, 4, 2, 3, "m"); box(g, 10, 9, 2, 3, "m");
  return p;
}

function stoneBrickSlab(g: Grid): Palette {
  const p = { o: "#343633", d: "#5b5e58", m: "#777a73", l: "#9da097", h: "#c0c2b8" };
  // Low isometric masonry course: broad diamond top over two half-height sides.
  for (let y = 3; y <= 7; y += 1) {
    const inset = Math.abs(5 - y) * 2;
    const start = Math.max(1, inset);
    const end = Math.min(14, 15 - inset);
    for (let x = start; x <= end; x += 1) px(g, x, y, x === start || x === end ? "o" : "l");
  }
  for (let y = 8; y <= 12; y += 1) {
    const start = y - 7;
    const end = 22 - y;
    for (let x = start; x <= 7; x += 1) px(g, x, y, x === start || x === 7 ? "o" : "m");
    for (let x = 8; x <= end; x += 1) px(g, x, y, x === 8 || x === end ? "o" : "d");
  }
  box(g, 3, 9, 5, 1, "o"); box(g, 9, 10, 5, 1, "o");
  box(g, 6, 4, 1, 3, "d"); box(g, 10, 5, 1, 3, "d");
  dots(g, "h", [[4,5],[8,4],[11,6],[5,8],[9,8]]);
  return p;
}

function tool(g: Grid, kind: Exclude<ToolKind,"hand">, tier: Exclude<ToolTier,"none">): Palette {
  const color = ({ wood:"#a86f38", gold:"#f2c93d", stone:"#858a83", iron:"#d1d6d2", diamond:"#35cfc6" } as const)[tier];
  const p = { o:"#29241e", w:"#7b4e28", h:"#ba8350", m:color, l:mix(color,"#ffffff",.38), d:mix(color,"#000000",.3) };
  if (kind === "sword") {
    // One connected slash: tapered blade, attached crossguard, then a short
    // leather grip and material pommel. The guard crosses the blade instead of
    // reading as a second floating diagonal.
    stamp(g, [
      "................",
      ".............o..",
      "............olo.",
      "...........olmo.",
      "..........olmdo.",
      ".........olmdo..",
      "........olmdo...",
      ".......olmdo....",
      "...oo.olmdo.....",
      "....oommmo......",
      ".....owwooo.....",
      "....owwo.oo.....",
      "...owwo.........",
      "..owwo..........",
      ".ommo...........",
      "................",
    ]);
    return p;
  }

  if (kind === "pickaxe") {
    // Reference-driven mining silhouette, independently authored at 16×16:
    // a continuous stair-step wooden grip enters a solid socket, the shallow
    // crown reaches farther left, and the shorter right end turns into one
    // downward tine. Every occupied pixel belongs to one 4-neighbor component;
    // there is no floating bar or open U-shaped arch.
    stamp(g, [
      "................",
      "....ooooooo.....",
      "...olllmmdoo....",
      ".....omwddoo....",
      "......omwdddoo..",
      "......owo..oddo.",
      ".....owo....odo.",
      ".....wo.....oo..",
      "....owo.........",
      "....who.........",
      "...owo..........",
      "...who..........",
      "..owo...........",
      "..who...........",
      ".ooo............",
      "................",
    ]);
  } else if (kind === "axe") {
    // Broad right blade, compact left poll, visible wooden eye, and a single
    // lower-left-to-upper-right staircase haft. Every pixel is in one
    // four-neighbor component.
    stamp(g, [
      "................",
      ".........ooooo..",
      ".......oowmmmmo.",
      ".......owmlllmo.",
      "........wmllldo.",
      ".......owwmddo..",
      "......owwwooo...",
      "......owwo......",
      ".....owwo.......",
      "....owwo........",
      "...owwo.........",
      "..owwo..........",
      ".owwo...........",
      ".wwo............",
      ".oo.............",
      "................",
    ]);
  } else {
    // A compact centered diamond spade, exactly twice the apparent shaft
    // width, flows into the same connected staircase rhythm as the haft.
    stamp(g, [
      "................",
      "..........oo....",
      ".........ommmo..",
      "........omllldo.",
      ".........ommdo..",
      "..........odo...",
      ".........oww....",
      "........oww.....",
      ".......oww......",
      "......oww.......",
      ".....oww........",
      "....oww.........",
      "...oww..........",
      "..oww...........",
      ".oww............",
      "................",
    ]);
  }
  return p;
}

function bow(g: Grid, drawStage = 0): Palette {
  const p = { o: "#322419", w: "#9b6837", h: "#d19a56", s: "#e8e3d7", a: "#8f7047", f: "#d7d2c4" };
  // The limb is a narrow, connected arc with transparent interior space. Draw
  // stages keep that authored arc fixed while progressively pulling the nock;
  // they are silhouette changes, never rigid rotations of the idle sprite.
  stamp(g, [
    "................",
    "......o.........",
    ".....ow.........",
    "....ow..........",
    "...oh...........",
    "..ow............",
    "..ow............",
    ".ow.............",
    ".oh.............",
    ".ow.............",
    "..ow............",
    "...oh...........",
    "....ow..........",
    ".....ow.........",
    "......o.........",
    "................",
  ]);
  const stage = Math.max(0, Math.min(3, drawStage));
  const nockX = [7, 8, 10, 12][stage];
  if (drawStage > 0) {
    line(g, 5, 8, 13, 8, "a");
    dots(g, "o", [[12,7],[13,7],[14,8],[13,9],[12,9]]);
    dots(g, "f", [[12,8],[13,8]]);
  }
  connectedLine(g, 6, 1, nockX, 8, "s");
  connectedLine(g, nockX, 8, 6, 14, "s");
  return p;
}

function flintAndSteel(g: Grid): Palette {
  const p = { o: "#252927", s: "#9fa8a4", l: "#e0e4df", d: "#5f6965", f: "#343a38", h: "#717b77" };
  // Open C-shaped steel striker crossing a jagged dark flint shard.
  box(g, 7, 1, 7, 2, "o"); box(g, 6, 2, 3, 8, "o"); box(g, 7, 2, 5, 2, "s");
  box(g, 7, 4, 2, 5, "s"); box(g, 8, 8, 5, 3, "o"); box(g, 8, 8, 4, 1, "l");
  dots(g, "d", [[8,3],[7,7],[9,10],[10,10]]);
  dots(g, "o", [[3,7],[4,6],[5,7],[2,9],[3,8],[4,9],[5,10],[4,11],[5,12],[6,11],[6,13],[7,12]]);
  dots(g, "f", [[4,7],[3,9],[4,9],[5,10],[5,11],[6,12]]);
  dots(g, "h", [[4,8],[5,9]]);
  return p;
}

function shears(g: Grid): Palette {
  const p = { o: "#272b2a", s: "#aeb8b5", l: "#edf1ee", d: "#68716e", h: "#77513a", r: "#bd7652" };
  // Crossed iron blades meeting at a warm pivot, with two open finger loops.
  diagonal(g, 4, 3, 1, 1, 8, "o", 2); diagonal(g, 5, 3, 1, 1, 7, "s");
  diagonal(g, 11, 2, -1, 1, 8, "o", 2); diagonal(g, 11, 3, -1, 1, 7, "s");
  dots(g, "l", [[5,3],[6,4],[10,3],[9,4],[8,6]]); dots(g, "d", [[7,7],[9,7],[10,9]]);
  box(g, 6, 8, 4, 4, "o"); box(g, 7, 9, 2, 2, "r");
  dots(g, "o", [[3,10],[2,11],[2,12],[3,13],[4,13],[5,12],[5,11], [11,10],[10,11],[10,12],[11,13],[12,13],[13,12],[13,11]]);
  dots(g, "h", [[3,11],[3,12],[4,12], [11,11],[11,12],[12,12]]);
  return p;
}

function armor(g: Grid, slot: ArmorSlot, color: string): Palette {
  const p = { o:mix(color,"#161817",.72), m:color, l:mix(color,"#ffffff",.36), d:mix(color,"#000000",.3) };
  if (slot === "head") { box(g,3,3,10,8,"o"); box(g,4,2,8,8,"m"); box(g,5,3,6,2,"l"); box(g,5,7,6,4,"d"); box(g,6,7,4,2,""); }
  else if (slot === "chest") { box(g,4,2,8,13,"o"); box(g,1,3,4,7,"o"); box(g,11,3,4,7,"o"); box(g,5,3,6,11,"m"); box(g,2,4,3,5,"m"); box(g,11,4,3,5,"m"); box(g,6,3,2,9,"l"); box(g,8,7,3,6,"d"); }
  else if (slot === "legs") { box(g,3,2,10,5,"o"); box(g,3,6,4,9,"o"); box(g,9,6,4,9,"o"); box(g,4,3,8,3,"m"); box(g,4,6,2,8,"m"); box(g,10,6,2,8,"d"); box(g,5,3,3,2,"l"); }
  else { box(g,2,6,5,8,"o"); box(g,9,6,5,8,"o"); box(g,3,7,3,5,"m"); box(g,10,7,3,5,"d"); box(g,1,11,6,3,"o"); box(g,9,11,6,3,"o"); box(g,2,11,4,2,"l"); box(g,10,11,4,2,"m"); }
  return p;
}

function material(g: Grid, id: ItemId): Palette {
  const color = ITEMS[id].color;
  const p = { o:mix(color,"#111311",.7), m:color, l:mix(color,"#ffffff",.42), d:mix(color,"#000000",.3), q:"#b8935c" };
  if (id === "clay_ball") {
    // Hand-sized kneaded clay lump: an irregular cool-gray silhouette with
    // one compressed highlight ridge, distinct from stone and ore drops.
    dots(g,"o",[[6,2],[9,2],[4,3],[5,3],[6,3],[7,3],[8,3],[9,3],[10,3],[11,3],
      [3,4],[12,4],[2,6],[13,6],[2,9],[13,9],[3,11],[12,11],[5,13],[10,13],
      [6,14],[7,14],[8,14],[9,14]]);
    box(g,4,4,8,9,"m"); box(g,3,6,10,5,"m");
    dots(g,"l",[[5,4],[6,4],[4,5],[5,5],[8,6],[9,6]]);
    dots(g,"d",[[11,5],[12,7],[10,9],[11,10],[8,12],[9,13],[5,11]]);
  }
  else if (id === "brick") {
    // Single fired brick item, drawn as a chunky angled rectangular prism.
    dots(g,"o",[[4,3],[5,2],[11,2],[12,3],[3,4],[13,4],[2,7],[13,7],[2,10],[11,12],
      [3,11],[4,12],[10,13],[5,13],[6,14],[9,14]]);
    box(g,4,4,9,7,"m"); box(g,3,6,9,5,"m");
    box(g,5,3,7,2,"l"); dots(g,"l",[[4,5],[5,5],[6,5]]);
    box(g,4,10,8,2,"d"); dots(g,"d",[[12,5],[12,6],[11,8],[10,11],[9,12]]);
  }
  else if (id === "stick") { diagonal(g,3,13,1,-1,10,"o",2); diagonal(g,4,13,1,-1,9,"m"); dots(g,"l",[[5,11],[8,8],[11,5]]); }
  else if (id === "bone_meal") {
    dots(g,"o",[[6,4],[9,4],[4,6],[11,6],[3,9],[12,9],[5,12],[10,12],[7,13],[9,13]]);
    box(g,5,6,6,6,"m"); box(g,4,8,8,3,"m");
    dots(g,"l",[[6,5],[8,5],[5,7],[7,7],[9,8],[6,9],[8,10],[5,11]]);
    dots(g,"d",[[9,6],[10,8],[7,11],[9,12],[4,9]]);
  }
  else if (id === "string") { diagonal(g,3,3,1,1,5,"o"); diagonal(g,7,7,1,-1,5,"o"); diagonal(g,7,7,1,1,5,"o"); diagonal(g,11,11,-1,1,5,"o"); diagonal(g,3,3,1,1,5,"m"); diagonal(g,7,7,1,-1,5,"m"); diagonal(g,7,7,1,1,5,"m"); diagonal(g,11,11,-1,1,5,"m"); dots(g,"l",[[3,3],[7,7],[11,3],[11,11],[7,15]]); }
  else if (id === "bone") {
    // Chunky diagonal shaft with the characteristic forked knuckles at both ends.
    diagonal(g,4,11,1,-1,8,"o",3); diagonal(g,5,11,1,-1,7,"m",2);
    dots(g,"o",[[2,10],[2,11],[3,9],[3,10],[3,11],[3,12],[4,12],[4,13],[5,12],[5,13],
      [10,2],[10,3],[11,1],[11,2],[11,3],[11,4],[12,1],[12,2],[12,3],[13,2]]);
    dots(g,"m",[[3,10],[3,11],[4,11],[4,12],[5,12],[10,3],[11,2],[11,3],[12,2]]);
    dots(g,"l",[[4,10],[5,9],[6,8],[7,7],[8,6],[9,5],[10,4],[11,2]]);
    dots(g,"d",[[3,12],[5,11],[10,3],[12,3]]);
  }
  else if (id === "feather") {
    // Broad white vane tapering toward a warm central quill.
    dots(g,"o",[[10,1],[11,1],[9,2],[10,2],[11,2],[8,3],[9,3],[10,3],[11,3],
      [7,4],[8,4],[9,4],[10,4],[6,5],[7,5],[8,5],[9,5],[5,6],[6,6],[7,6],[8,6],
      [4,7],[5,7],[6,7],[7,7],[4,8],[5,8],[6,8],[3,9],[4,9],[5,9],[3,10],[4,10],
      [4,11],[5,11],[5,12],[6,12],[6,13],[7,13],[7,14]]);
    dots(g,"m",[[10,2],[9,3],[10,3],[8,4],[9,4],[7,5],[8,5],[6,6],[7,6],[5,7],[6,7],
      [4,8],[5,8],[4,9],[4,10]]);
    dots(g,"l",[[10,2],[9,3],[8,4],[7,5],[6,6],[5,7],[4,8]]);
    dots(g,"d",[[11,2],[10,4],[9,5],[8,6],[7,7],[6,8],[5,9],[4,10]]);
    dots(g,"q",[[5,11],[6,12],[7,13],[7,14]]);
  }
  else if (id === "arrow") { diagonal(g,2,13,1,-1,11,"o",2); diagonal(g,3,13,1,-1,10,"m"); box(g,11,1,3,3,"o"); dots(g,"d",[[12,1],[13,1],[13,2]]); dots(g,"l",[[5,11],[8,8],[11,5]]); box(g,1,11,3,4,"o"); dots(g,"l",[[1,12],[2,13],[3,14]]); }
  else if (id === "leather") { box(g,4,2,8,12,"o"); box(g,2,5,12,6,"o"); box(g,4,3,7,10,"m"); box(g,3,6,10,4,"m"); dots(g,"l",[[5,4],[6,4],[4,7],[9,5]]); dots(g,"d",[[10,10],[11,8],[6,12]]); }
  else if (id === "wool") { for (const [x,y] of [[3,5],[6,3],[9,3],[11,6],[8,8],[4,9]] as const) box(g,x,y,4,4,"o"); for (const [x,y] of [[4,5],[7,4],[10,6],[7,8],[4,9]] as const) box(g,x,y,3,3,"m"); dots(g,"l",[[5,5],[8,4],[11,6],[5,9]]); }
  else if (id === "charcoal") {
    // A compact charred-log shard with a squared silhouette and pale ash cracks,
    // deliberately distinct from coal's irregular ore-lump sprite.
    dots(g,"o",[[5,2],[6,2],[7,2],[8,2],[9,2],[10,2],[4,3],[11,3],[3,4],[12,4],
      [3,5],[12,5],[3,6],[12,6],[3,7],[12,7],[3,8],[12,8],[3,9],[12,9],[3,10],[12,10],
      [4,11],[11,11],[5,12],[6,12],[7,12],[8,12],[9,12],[10,12]]);
    box(g,4,4,8,7,"m"); box(g,5,3,6,2,"m"); box(g,5,10,6,2,"d");
    dots(g,"l",[[5,4],[6,4],[9,4],[10,4],[5,5],[8,6],[9,6],[7,7],[8,7],[6,8],[7,8],[6,9]]);
    dots(g,"d",[[10,5],[11,6],[10,8],[9,9],[10,10],[5,10]]);
  }
  else if (["coal","raw_iron","raw_gold"].includes(id)) { dots(g,"o",[[6,2],[9,2],[4,4],[11,4],[2,7],[13,7],[4,12],[11,12],[7,14],[9,14]]); box(g,4,4,8,9,"m"); box(g,3,6,10,5,"m"); dots(g,"l",[[5,5],[6,4],[10,6],[4,8]]); dots(g,"d",[[9,11],[11,9],[7,12]]); }
  else if (id === "flint") { dots(g,"o",[[7,1],[8,1],[6,2],[9,2],[5,3],[10,3],[4,4],[11,4],[3,6],[10,6],[2,8],[9,8],[3,10],[8,10],[4,12],[7,12],[5,14],[6,14]]); box(g,4,4,6,7,"m"); box(g,3,6,5,4,"m"); dots(g,"l",[[6,3],[5,5],[4,7],[6,6]]); dots(g,"d",[[9,4],[8,7],[7,10],[6,12]]); }
  else if (id === BS.gunpowder) { dots(g,"o",[[6,2],[9,2],[4,4],[11,4],[3,7],[13,7],[4,11],[11,12],[7,14],[9,14]]); box(g,5,4,6,9,"m"); box(g,3,7,10,4,"m"); dots(g,"l",[[6,4],[9,5],[4,7],[7,9],[11,8],[6,12]]); dots(g,"d",[[8,3],[5,6],[10,10],[8,13],[12,7]]); }
  else if (id === BS.ironIngot || id === BS.goldIngot) { box(g,3,5,10,7,"o"); box(g,5,3,6,2,"o"); box(g,4,5,8,5,"m"); box(g,5,4,6,2,"l"); box(g,5,9,7,2,"d"); }
  else if (id === "diamond") { box(g,5,2,6,2,"o"); box(g,3,4,10,4,"o"); box(g,5,8,6,3,"o"); box(g,7,11,2,3,"o"); box(g,5,4,6,3,"m"); box(g,6,7,4,4,"m"); dots(g,"l",[[6,3],[7,3],[5,5],[6,5],[7,7]]); dots(g,"d",[[10,6],[9,9],[8,12]]); }
  else { box(g,4,4,8,8,"o"); box(g,5,5,6,6,"m"); dots(g,"l",[[6,5],[7,5]]); dots(g,"d",[[10,9],[9,10]]); }
  return p;
}

function food(g: Grid, id: ItemId): Palette {
  const color = ITEMS[id].color, cooked = id.startsWith("cooked_"), rotten = id === "rotten_flesh";
  const p = { o:"#38221f", m:color, l:mix(color,"#ffffff",cooked?.2:.38), d:mix(color,"#000000",.32), b:rotten?"#a6a15e":"#eee0bc" };
  if (id === "apple") {
    const applePalette = { o: "#421a18", m: "#c83228", l: "#ef6550", d: "#85211f", s: "#5f3b20", g: "#56823b", h: "#8db455" };
    // Rounded red fruit, indented at the stem, with one angled green leaf.
    dots(g,"o",[[6,3],[7,3],[9,3],[10,3],[4,4],[5,4],[6,4],[7,4],[8,4],[9,4],[10,4],[11,4],
      [3,5],[4,5],[5,5],[6,5],[7,5],[8,5],[9,5],[10,5],[11,5],[12,5],[3,6],[4,6],[5,6],
      [6,6],[7,6],[8,6],[9,6],[10,6],[11,6],[12,6],[3,7],[4,7],[5,7],[6,7],[7,7],[8,7],
      [9,7],[10,7],[11,7],[12,7],[3,8],[4,8],[5,8],[6,8],[7,8],[8,8],[9,8],[10,8],[11,8],
      [12,8],[4,9],[5,9],[6,9],[7,9],[8,9],[9,9],[10,9],[11,9],[4,10],[5,10],[6,10],
      [7,10],[8,10],[9,10],[10,10],[11,10],[5,11],[6,11],[7,11],[8,11],[9,11],[10,11],
      [6,12],[7,12],[8,12],[9,12]]);
    box(g,4,5,8,5,"m"); box(g,5,9,6,2,"m"); box(g,6,11,4,1,"m");
    dots(g,"l",[[5,5],[6,5],[4,6],[5,6],[4,7]]); dots(g,"d",[[11,6],[11,7],[10,9],[9,11]]);
    box(g,7,1,2,3,"s"); dots(g,"g",[[9,1],[10,1],[11,1],[9,2],[10,2]]); dots(g,"h",[[9,1],[10,1]]);
    return applePalette;
  }
  if (id === "raw_chicken" || id === "cooked_chicken") {
    // A compact diagonal drumstick: broad meat at the upper left, narrow bone
    // and two knuckles at the lower right. Cooked meat gains a crisp edge and
    // char pixels while raw meat keeps pale highlights, so both sprites read
    // independently even at native 16px scale.
    dots(g,"o",[[4,2],[5,2],[6,2],[7,2],[8,2],[3,3],[4,3],[5,3],[6,3],[7,3],[8,3],[9,3],
      [2,4],[3,4],[4,4],[5,4],[6,4],[7,4],[8,4],[9,4],[10,4],[2,5],[3,5],[4,5],[5,5],
      [6,5],[7,5],[8,5],[9,5],[10,5],[2,6],[3,6],[4,6],[5,6],[6,6],[7,6],[8,6],[9,6],
      [10,6],[3,7],[4,7],[5,7],[6,7],[7,7],[8,7],[9,7],[4,8],[5,8],[6,8],[7,8],[8,8],
      [7,9],[8,9],[8,10],[9,10],[9,11],[10,11],[10,12],[11,12],[12,11],[12,12],[13,11],
      [11,13],[12,13]]);
    box(g,4,3,5,5,"m"); box(g,3,4,7,3,"m"); box(g,4,7,5,1,"m");
    dots(g,"b",[[7,8],[8,9],[9,10],[10,11],[11,12],[12,11],[13,11],[11,13],[12,13]]);
    if (cooked) dots(g,"d",[[4,4],[5,3],[8,4],[3,6],[6,7],[9,5]]);
    else dots(g,"l",[[4,3],[5,3],[3,4],[4,4],[5,4],[3,5]]);
    return p;
  }
  if (id === "pork" || id === "cooked_pork") {
    // Broad pork cut with a pale fat edge and a clipped lower tip. Cooked
    // pixels deepen along the rim but retain the same immediately readable cut.
    dots(g,"o",[[5,2],[6,2],[7,2],[8,2],[9,2],[10,2],[3,3],[4,3],[11,3],[12,3],
      [2,4],[13,4],[2,5],[13,5],[2,6],[13,6],[2,7],[13,7],[3,8],[12,8],[3,9],[12,9],
      [4,10],[11,10],[5,11],[10,11],[6,12],[7,12],[8,12],[9,12]]);
    box(g,3,4,10,4,"m"); box(g,4,8,8,2,"m"); box(g,5,10,6,1,"m"); box(g,6,11,4,1,"m");
    dots(g,"b",[[4,3],[5,3],[3,4],[3,5],[4,5],[11,4],[12,5],[11,6],[10,7]]);
    dots(g,"l",[[5,4],[6,4],[4,5],[5,5]]); dots(g,"d",[[11,7],[10,9],[8,11],[5,9]]);
    if (cooked) dots(g,"d",[[6,3],[8,3],[12,4],[12,6],[11,9],[9,10]]);
    return p;
  }
  if (id === "beef" || id === "cooked_beef") {
    // Dense steak medallion with an inset fat eye and one squared outer edge.
    dots(g,"o",[[5,2],[6,2],[7,2],[8,2],[9,2],[10,2],[3,3],[4,3],[11,3],[12,3],
      [2,4],[13,4],[2,5],[14,5],[1,6],[14,6],[1,7],[14,7],[2,8],[14,8],[2,9],[13,9],
      [3,10],[12,10],[4,11],[11,11],[5,12],[6,12],[7,12],[8,12],[9,12],[10,12]]);
    box(g,3,4,10,7,"m"); box(g,2,6,12,3,"m"); box(g,5,3,6,2,"m"); box(g,5,11,6,1,"m");
    box(g,5,5,4,3,"b"); box(g,6,6,2,2,"d");
    dots(g,"l",[[4,4],[5,4],[3,5],[10,4]]); dots(g,"d",[[12,6],[13,7],[11,9],[9,11],[4,9]]);
    if (cooked) dots(g,"d",[[6,3],[9,3],[3,4],[13,5],[2,8],[11,10]]);
    return p;
  }
  if (id === "mutton" || id === "cooked_mutton") {
    // Compact chop on a diagonal bone; the open negative space between meat
    // and knuckle keeps it distinct from both pork and beef at hotbar scale.
    dots(g,"o",[[7,2],[8,2],[9,2],[10,2],[11,2],[5,3],[6,3],[12,3],[4,4],[13,4],
      [3,5],[13,5],[3,6],[13,6],[4,7],[12,7],[5,8],[11,8],[6,9],[10,9],
      [5,10],[6,10],[4,11],[5,11],[3,12],[4,12],[2,13],[3,13],[2,14],[3,14],[4,13]]);
    box(g,5,4,8,3,"m"); box(g,6,3,6,5,"m"); box(g,6,7,5,2,"m");
    dots(g,"l",[[6,4],[7,3],[5,5],[6,5]]); dots(g,"d",[[11,4],[12,5],[10,7],[8,8]]);
    dots(g,"b",[[6,9],[5,10],[4,11],[3,12],[2,13],[2,14],[3,14],[4,13]]);
    if (cooked) dots(g,"d",[[8,3],[10,3],[5,4],[12,4],[11,6],[9,8]]);
    return p;
  }
  if (rotten) {
    // Torn, folded strip with missing corners and sickly connective patches.
    dots(g,"o",[[5,2],[6,2],[7,2],[10,2],[11,2],[4,3],[8,3],[9,3],[12,3],
      [3,4],[13,4],[3,5],[13,5],[2,6],[12,6],[2,7],[12,7],[3,8],[13,8],[3,9],[13,9],
      [4,10],[12,10],[4,11],[11,11],[5,12],[6,12],[9,12],[10,12],[7,13],[8,13]]);
    box(g,4,4,9,2,"m"); box(g,3,6,9,2,"m"); box(g,4,8,9,3,"m"); box(g,5,11,6,1,"m");
    dots(g,"b",[[5,4],[8,4],[11,5],[4,7],[7,7],[10,8],[6,9],[9,10],[7,12]]);
    dots(g,"l",[[6,3],[5,5],[4,6]]); dots(g,"d",[[10,3],[12,4],[11,7],[12,9],[10,11],[5,10]]);
    return p;
  }
  box(g,3,4,9,9,"o"); box(g,2,6,12,5,"o"); box(g,4,4,7,8,"m"); box(g,3,6,10,4,"m"); box(g,10,9,4,2,"b"); box(g,13,8,2,2,"b"); box(g,13,11,2,2,"b"); dots(g,"l",[[5,5],[6,5],[4,7]]); dots(g,"d",[[8,10],[10,7],[6,11]]); if (rotten) dots(g,"b",[[5,8],[8,5],[10,9]]); return p;
}

const armorMaterial = (id: ItemId): string => id.startsWith("golden_") ? "gold" : id.startsWith("diamond_") ? "diamond" : id.startsWith("iron_") ? "iron" : "leather";
function runs(g: Grid, palette: Palette): ItemIconRun[] {
  const result: ItemIconRun[] = [];
  for (let y=0; y<16; y+=1) for (let x=0; x<16;) {
    const tone=g[y][x]; if (!tone) { x+=1; continue; }
    let end=x+1; while (end<16 && g[y][end]===tone) end+=1;
    result.push(Object.freeze({x,y,width:end-x,color:palette[tone]??"#ff00ff"})); x=end;
  }
  return result;
}
function mix(from: string, to: string, amount: number): string {
  const a=parse(from), b=parse(to), channel=(i:number)=>Math.round(a[i]+(b[i]-a[i])*amount).toString(16).padStart(2,"0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}
function parse(value: string): readonly [number,number,number] { const h=value.slice(1); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Pass the generated client module path.");

const bowDrawArt = ([1, 2, 3] as const).map((stage) => {
  const grid = makeGrid();
  const palette = bow(grid, stage);
  return Object.freeze({
    family: "tool" as const,
    variant: `drawing-${stage - 1}`,
    runs: Object.freeze(runs(grid, palette)),
  });
});

const bytes: number[] = [];
for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  const art = getItemIconArt(itemId);
  const colors = [...new Set(art.runs.map(({ color }) => color))];
  if (art.runs.length > 255 || colors.length > 16) throw new Error(`Icon ${itemId} exceeds the compact encoding.`);
  bytes.push(art.runs.length, colors.length);
  for (const color of colors) {
    const value = Number.parseInt(color.slice(1), 16);
    bytes.push(value >> 16, value >> 8 & 255, value & 255);
  }
  for (const run of art.runs) {
    bytes.push(run.x << 4 | run.y, (run.width - 1) << 4 | colors.indexOf(run.color));
  }
}
const itemIds = Object.keys(ITEMS) as ItemId[];
const encodedArt = [...itemIds.map((itemId) => getItemIconArt(itemId)), ...bowDrawArt];
const shapes: number[][] = [];
const shapeIndexes = new Map<string, number>();
const compactBytes: number[] = [];
const iconShapes: number[] = [];
for (const art of encodedArt) {
  const { runs } = art;
  const key = runs.map(({ x, y, width }) => `${x},${y},${width}`).join(";");
  let shapeIndex = shapeIndexes.get(key);
  if (shapeIndex === undefined) {
    shapeIndex = shapes.length;
    shapeIndexes.set(key, shapeIndex);
    shapes.push(runs.flatMap(({ x, y, width }) => [x << 4 | y, width - 1]));
  }
  iconShapes.push(shapeIndex);
}
compactBytes.push(shapes.length);
if (shapes.length > 255) throw new Error("Item icon geometry table exceeds the compact encoding.");
for (const shape of shapes) {
  compactBytes.push(shape.length / 2);
  for (let index = 0; index < shape.length; index += 2) compactBytes.push(shape[index]);
  for (let index = 1; index < shape.length; index += 4) {
    compactBytes.push(shape[index] << 4 | (shape[index + 2] ?? 0));
  }
}
for (let itemIndex = 0; itemIndex < iconShapes.length; itemIndex += 1) {
  const art = encodedArt[itemIndex];
  const colors = [...new Set(art.runs.map(({ color }) => color))];
  compactBytes.push(iconShapes[itemIndex], colors.length);
  for (const color of colors) {
    const value = Number.parseInt(color.slice(1), 16);
    compactBytes.push(value >> 16, value >> 8 & 255, value & 255);
  }
  for (let index = 0; index < art.runs.length; index += 2) {
    compactBytes.push(colors.indexOf(art.runs[index].color) << 4
      | (art.runs[index + 1] ? colors.indexOf(art.runs[index + 1].color) : 0));
  }
}
const packed: number[] = [];
for (let index = 0; index < compactBytes.length;) {
  const control = packed.length;
  packed.push(0);
  let flags = 0;
  for (let bit = 0; bit < 8 && index < compactBytes.length; bit += 1) {
    let length = 0;
    let distance = 0;
    for (let source = Math.max(0, index - 4_095); source < index; source += 1) {
      let candidate = 0;
      while (candidate < 273 && index + candidate < compactBytes.length
        && compactBytes[source + candidate] === compactBytes[index + candidate]) candidate += 1;
      if (candidate > length) {
        length = candidate;
        distance = index - source;
      }
    }
    if (length >= 3) {
      if (length === 18) length = 17;
      flags |= 1 << bit;
      const value = (Math.min(length, 18) - 3) * 4_096 + distance;
      packed.push(value >> 8, value & 255);
      if (length > 17) packed.push(length - 18);
      index += length;
    } else packed.push(compactBytes[index++]);
  }
  packed[control] = flags;
}
const payload = encodeStaticBytes(packed);
const source = `// Generated by scripts/generate-item-icon-art.ts. Do not hand-edit.\n`
  + `import { ITEMS, type ItemId } from "../../shared/game.ts";\n`
  + `import { decodeStaticBytes } from "../staticData.ts";\n`
  + `export const ITEM_ICON_SIZE = 16;\n`
  + `export type ItemIconFamily = "block" | "material" | "tool" | "armor" | "food";\n`
  + `export type ItemIconRun = Readonly<{ x: number; y: number; width: number; color: string }>;\n`
  + `export type ItemIconArt = Readonly<{ family: ItemIconFamily; variant: string; runs: readonly ItemIconRun[] }>;\n`
  + `export type BowIconStage = 0 | 1 | 2 | 3;\n`
  + `const cache = (() => { const invalid = (): never => { throw new Error("Invalid item icon data."); }, data = decodeStaticBytes(${JSON.stringify(payload)}, ${compactBytes.length}, ${packed.length}, true); let cursor = 0;\n`
  + `const shapes: number[] = []; for (let shape = data[cursor++]; shape > 0; shape -= 1) { const count = data[cursor], end = cursor + count + Math.ceil(count / 2) + 1; if (!count || end > data.length) invalid(); shapes.push(cursor); cursor = end; }\n`
  + `const read = (): readonly ItemIconRun[] => { const shape = shapes[data[cursor++]], colorCount = data[cursor++]; if (shape === undefined || !colorCount || colorCount > 16) invalid(); const count = data[shape], positions = shape + 1, widths = positions + count, end = cursor + colorCount * 3 + Math.ceil(count / 2); if (end > data.length) invalid(); const colors: string[] = [];\n`
  + `  for (let index = 0; index < colorCount; index += 1) { const value = data[cursor++] * 65_536 + data[cursor++] * 256 + data[cursor++]; colors.push(\`#\${value.toString(16).padStart(6, "0")}\`); }\n`
  + `  const indexes = cursor; cursor += Math.ceil(count / 2); const runs = Array.from({ length: count }, (_, index) => { const position = data[positions + index], width = (data[widths + (index >> 1)] >> (index % 2 ? 0 : 4) & 15) + 1, color = data[indexes + (index >> 1)] >> (index % 2 ? 0 : 4) & 15; if ((position >> 4) + width > 16 || color >= colorCount) invalid(); return Object.freeze({ x: position >> 4, y: position & 15, width, color: colors[color] }); });\n`
  + `  return Object.freeze(runs); };\n`
  + `const result = new Map<ItemId, ItemIconArt>();\n`
  + `for (const itemId of Object.keys(ITEMS) as ItemId[]) { const runs = read();\n`
  + `  const item = ITEMS[itemId], variant = item.category === "tool" && item.tool ? \`\${item.tool.tier}-\${item.tool.kind}\` : item.category === "armor" && item.armor ? \`\${itemId.startsWith("golden_") ? "gold" : itemId.startsWith("diamond_") ? "diamond" : itemId.startsWith("iron_") ? "iron" : "leather"}-\${item.armor.slot}\` : itemId;\n`
  + `  result.set(itemId, Object.freeze({ family: item.category, variant, runs })); }\n`
  + `const bowDrawArt: readonly ItemIconArt[] = Object.freeze([0, 1, 2].map((stage) => Object.freeze({ family: "tool", variant: \`drawing-\${stage}\`, runs: read() })));\n`
  + `if (cursor !== data.length) invalid(); return { result, bowDrawArt }; })();\n`
  + `export function getItemIconArt(itemId: ItemId): ItemIconArt { return cache.result.get(itemId)!; }\n`
  + `export function getBowIconArt(stage: BowIconStage): ItemIconArt { return stage === 0 ? getItemIconArt("bow") : cache.bowDrawArt[stage - 1] ?? getItemIconArt("bow"); }\n`;
await writeFile(resolve(outputPath), source);
console.log(JSON.stringify({ items: Object.keys(ITEMS).length, decodedBytes: bytes.length, formatBytes: compactBytes.length, shapes: shapes.length, packedBytes: packed.length, sourceBytes: Buffer.byteLength(source) }));
