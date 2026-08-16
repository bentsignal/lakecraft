import {
  CHEST_ATLAS_COLUMN,
  CHEST_ATLAS_ROW,
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_ROWS,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "./generated/textureAtlas.ts";
import { BLOCK, blockStateName, type BlockId } from "./types.ts";
import * as BS from "../../shared/bundleStrings.ts";
import { STONE_SHAPE_TEXTURES } from "../../shared/expandedBuildingCatalog.ts";

export type BlockFace = "east" | "west" | "top" | "bottom" | "south" | "north";

/** Position (3), atlas UV (2), and directional shade (1). */
export const TEXTURED_WORLD_VERTEX_FLOATS = 6;

export interface TextureUvBounds {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

const UNIFORM_BLOCK_TEXTURES: Readonly<Partial<Record<BlockId, TextureAtlasName>>> = {
  [BLOCK.DIRT]: "dirt",
  [BLOCK.STONE]: "stone",
  [BLOCK.LEAVES]: "leaves",
  [BLOCK.PLANKS]: "oak_planks",
  [BLOCK.COAL_ORE]: BS.coalOre,
  [BLOCK.IRON_ORE]: BS.ironOre,
  [BLOCK.COBBLESTONE]: BS.cobblestone,
  [BLOCK.STONE_BRICKS]: BS.stoneBricks,
  [BLOCK.STONE_BRICK_SLAB]: BS.stoneBricks,
  [BLOCK.CLAY]: "clay",
  [BLOCK.BRICKS]: "bricks",
  [BLOCK.BEDROCK]: "bedrock",
  [BLOCK.OAK_SLAB]: "oak_planks",
  [BLOCK.COBBLESTONE_SLAB]: BS.cobblestone,
  [BLOCK.BRICK_SLAB]: "bricks",
  [BLOCK.OAK_STAIRS_EAST]: "oak_planks",
  [BLOCK.OAK_STAIRS_NORTH]: "oak_planks",
  [BLOCK.OAK_STAIRS_SOUTH]: "oak_planks",
  [BLOCK.OAK_STAIRS_WEST]: "oak_planks",
  [BLOCK.COBBLESTONE_STAIRS_EAST]: BS.cobblestone,
  [BLOCK.COBBLESTONE_STAIRS_NORTH]: BS.cobblestone,
  [BLOCK.COBBLESTONE_STAIRS_SOUTH]: BS.cobblestone,
  [BLOCK.COBBLESTONE_STAIRS_WEST]: BS.cobblestone,
  [BLOCK.STONE_BRICK_STAIRS_EAST]: BS.stoneBricks,
  [BLOCK.STONE_BRICK_STAIRS_NORTH]: BS.stoneBricks,
  [BLOCK.STONE_BRICK_STAIRS_SOUTH]: BS.stoneBricks,
  [BLOCK.STONE_BRICK_STAIRS_WEST]: BS.stoneBricks,
  [BLOCK.BRICK_STAIRS_EAST]: "bricks",
  [BLOCK.BRICK_STAIRS_NORTH]: "bricks",
  [BLOCK.BRICK_STAIRS_SOUTH]: "bricks",
  [BLOCK.BRICK_STAIRS_WEST]: "bricks",
  [BLOCK.OAK_STAIRS_UPSIDE_EAST]: "oak_planks",
  [BLOCK.OAK_STAIRS_UPSIDE_NORTH]: "oak_planks",
  [BLOCK.OAK_STAIRS_UPSIDE_SOUTH]: "oak_planks",
  [BLOCK.OAK_STAIRS_UPSIDE_WEST]: "oak_planks",
  [BLOCK.COBBLESTONE_STAIRS_UPSIDE_EAST]: BS.cobblestone,
  [BLOCK.COBBLESTONE_STAIRS_UPSIDE_NORTH]: BS.cobblestone,
  [BLOCK.COBBLESTONE_STAIRS_UPSIDE_SOUTH]: BS.cobblestone,
  [BLOCK.COBBLESTONE_STAIRS_UPSIDE_WEST]: BS.cobblestone,
  [BLOCK.STONE_BRICK_STAIRS_UPSIDE_EAST]: BS.stoneBricks,
  [BLOCK.STONE_BRICK_STAIRS_UPSIDE_NORTH]: BS.stoneBricks,
  [BLOCK.STONE_BRICK_STAIRS_UPSIDE_SOUTH]: BS.stoneBricks,
  [BLOCK.STONE_BRICK_STAIRS_UPSIDE_WEST]: BS.stoneBricks,
  [BLOCK.BRICK_STAIRS_UPSIDE_EAST]: "bricks",
  [BLOCK.BRICK_STAIRS_UPSIDE_NORTH]: "bricks",
  [BLOCK.BRICK_STAIRS_UPSIDE_SOUTH]: "bricks",
  [BLOCK.BRICK_STAIRS_UPSIDE_WEST]: "bricks",
  [BLOCK.SAND]: "sand",
  [BLOCK.GRAVEL]: "gravel",
  [BLOCK.WOOL]: "wool",
  [BLOCK.GLASS]: "glass",
  [BLOCK.GOLD_ORE]: BS.goldOre,
  [BLOCK.DIAMOND_ORE]: BS.diamondOre,
};

const ATLAS_WIDTH = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const ATLAS_HEIGHT = TEXTURE_ATLAS_ROWS * TEXTURE_TILE_SIZE;
const HALF_TEXEL_U = 0.5 / ATLAS_WIDTH;
const HALF_TEXEL_V = 0.5 / ATLAS_HEIGHT;
const TEXTURE_UV_BY_NAME = {} as Record<TextureAtlasName, TextureUvBounds>;
const TEXTURE_CELL_BY_NAME = {} as Record<TextureAtlasName, number>;
for (let index = 0; index < TEXTURE_ATLAS_NAMES.length; index += 1) {
  const name = TEXTURE_ATLAS_NAMES[index];
  const cell = TEXTURE_ATLAS_CELLS[index];
  TEXTURE_CELL_BY_NAME[name] = cell;
  const column = cell % TEXTURE_ATLAS_COLUMNS;
  const row = Math.floor(cell / TEXTURE_ATLAS_COLUMNS);
  TEXTURE_UV_BY_NAME[name] = Object.freeze({
    left: column / TEXTURE_ATLAS_COLUMNS + HALF_TEXEL_U,
    right: (column + 1) / TEXTURE_ATLAS_COLUMNS - HALF_TEXEL_U,
    bottom: 1 - (row + 1) / TEXTURE_ATLAS_ROWS + HALF_TEXEL_V,
    top: 1 - row / TEXTURE_ATLAS_ROWS - HALF_TEXEL_V,
  });
}

/** Resolve the material tile for one exposed cube face. Special geometry returns null. */
export function blockTextureForFace(block: BlockId, face: BlockFace): TextureAtlasName | null {
  if (block === BLOCK.GRASS) {
    if (face === "top") return "grass_top";
    if (face === "bottom") return "dirt";
    return "grass_side";
  }
  if (block === BLOCK.WOOD) {
    return face === "top" || face === "bottom" ? "oak_log_end" : "oak_log";
  }
  if (block === BLOCK.CRAFTING_TABLE) {
    if (face === "top") return "crafting_table_top";
    if (face === "north") return "crafting_table_front";
    if (face === "bottom") return "oak_planks";
    return "crafting_table_side";
  }
  if (block === BLOCK.FURNACE) {
    if (face === "north") return "furnace_front";
    if (face === "top") return "furnace_top";
    return "furnace_side";
  }
  if (block === BLOCK.TNT) {
    if (face === "top") return "tnt_top";
    if (face === "bottom") return "tnt_bottom";
    return "tnt_side";
  }
  const state = blockStateName(block);
  if (state) {
    const stair = state.indexOf("_stairs_");
    const family = stair >= 0 ? state.slice(0, stair) : state.endsWith("_slab") ? state.slice(0, -5) : "";
    if (family) return (family === "oak" ? "oak_planks" : family === "cobblestone" ? "cobblestone"
      : family === "stone_brick" ? "stone_bricks" : family === "brick" ? "bricks"
        : family === "quartz" ? "quartz_block_side"
          : STONE_SHAPE_TEXTURES[family as keyof typeof STONE_SHAPE_TEXTURES] ?? `${family}_planks`) as TextureAtlasName;
    if (state.endsWith("_planks") || state.endsWith("_leaves")) return state as TextureAtlasName;
    if (state.endsWith("_log")) return (face === "top" || face === "bottom" ? `${state}_end` : state) as TextureAtlasName;
    if (state === "bamboo_block") return (face === "top" || face === "bottom" ? "bamboo_block_top" : "bamboo_block") as TextureAtlasName;
    if (state === "quartz_block") return (`quartz_block_${face === "top" ? "top" : face === "bottom" ? "bottom" : "side"}`) as TextureAtlasName;
    if (state === "quartz_pillar") return (face === "top" || face === "bottom" ? "quartz_pillar_top" : "quartz_pillar") as TextureAtlasName;
    if (state === "chiseled_quartz") return (face === "top" || face === "bottom" ? "chiseled_quartz_top" : "chiseled_quartz") as TextureAtlasName;
    if (state.endsWith("_froglight")) return `${state}_${face === "top" || face === "bottom" ? "top" : "side"}` as TextureAtlasName;
    if (["granite", "polished_granite", "diorite", "polished_diorite", "andesite", "polished_andesite", "sandstone", "cut_sandstone", "chiseled_sandstone", "smooth_stone", "calcite", "deepslate"].includes(state)) return state as TextureAtlasName;
    if ((TEXTURE_ATLAS_NAMES as readonly string[]).includes(state)) return state as TextureAtlasName;
  }
  return UNIFORM_BLOCK_TEXTURES[block] ?? null;
}

/**
 * Return half-texel-inset UV bounds for a tile in the vertically flipped WebGL
 * upload. Insetting keeps nearest sampling inside the requested 16px cell.
 */
export function textureAtlasUv(name: TextureAtlasName): TextureUvBounds {
  const uv = TEXTURE_UV_BY_NAME[name];
  if (!uv) throw new Error(`Unknown texture atlas tile: ${name}`);
  return uv;
}

/** Address a reviewed source-pixel center inside one 16x16 atlas tile. */
export function textureAtlasPixelUv(
  name: TextureAtlasName,
  sourceU: number,
  sourceV: number,
): readonly [number, number] {
  const cell = TEXTURE_CELL_BY_NAME[name];
  if (cell === undefined) throw new Error(`Unknown texture atlas tile: ${name}`);
  const column = cell % TEXTURE_ATLAS_COLUMNS;
  const row = Math.floor(cell / TEXTURE_ATLAS_COLUMNS);
  return [
    (column * TEXTURE_TILE_SIZE + sourceU) / ATLAS_WIDTH,
    1 - (row * TEXTURE_TILE_SIZE + sourceV) / ATLAS_HEIGHT,
  ];
}

/** Address one exact source texel in the contiguous 64x64 normal-chest region. */
export function chestAtlasUv(sourceU: number, sourceV: number): readonly [number, number] {
  return [
    (CHEST_ATLAS_COLUMN * TEXTURE_TILE_SIZE + sourceU + 0.5) / ATLAS_WIDTH,
    1 - (CHEST_ATLAS_ROW * TEXTURE_TILE_SIZE + sourceV + 0.5) / ATLAS_HEIGHT,
  ];
}
