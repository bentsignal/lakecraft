import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_ROWS,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "./generated/textureAtlas.ts";
import { BLOCK, type BlockId } from "./types.ts";

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
  [BLOCK.COAL_ORE]: "coal_ore",
  [BLOCK.IRON_ORE]: "iron_ore",
  [BLOCK.COBBLESTONE]: "cobblestone",
  [BLOCK.SAND]: "sand",
  [BLOCK.GLASS]: "glass",
  [BLOCK.GOLD_ORE]: "gold_ore",
  [BLOCK.DIAMOND_ORE]: "diamond_ore",
};

const ATLAS_WIDTH = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
const ATLAS_HEIGHT = TEXTURE_ATLAS_ROWS * TEXTURE_TILE_SIZE;
const HALF_TEXEL_U = 0.5 / ATLAS_WIDTH;
const HALF_TEXEL_V = 0.5 / ATLAS_HEIGHT;
const TEXTURE_UV_BY_NAME = {} as Record<TextureAtlasName, TextureUvBounds>;
for (let index = 0; index < TEXTURE_ATLAS_NAMES.length; index += 1) {
  const name = TEXTURE_ATLAS_NAMES[index];
  const column = index % TEXTURE_ATLAS_COLUMNS;
  const row = Math.floor(index / TEXTURE_ATLAS_COLUMNS);
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
