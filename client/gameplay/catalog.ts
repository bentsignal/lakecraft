import type { BlockId, ItemId } from "../../shared/game.ts";
import { BLOCK, blockStateName, type BlockId as EngineBlockId } from "../game/types.ts";
import type { GameAudioSurface } from "../game/audio.ts";
import { EXPANDED_BLOCK_ITEM_IDS, EXPANDED_BLOCK_STATE_TYPES, EXTRA_WOOD_FAMILIES, NATURAL_DECORATION_ITEMS } from "../../shared/expandedBuildingCatalog.ts";

const EXPANDED_WOOD_SHAPE_PREFIXES = [...EXTRA_WOOD_FAMILIES, "bamboo"] as const;

function gameItemForExpandedState(state: string): BlockId | null {
  const stairs = state.indexOf("_stairs_");
  if (stairs >= 0) return `${state.slice(0, stairs)}_stairs` as BlockId;
  const door = state.indexOf("_door_");
  if (door >= 0) return (state.slice(0, door) === "oak" ? "door" : `${state.slice(0, door)}_door`) as BlockId;
  return (EXPANDED_BLOCK_ITEM_IDS as readonly string[]).includes(state) ? state as BlockId : null;
}

/** Canonical gameplay/catalog bridge shared by every authority mode. */
const BASE_ENGINE_TO_GAME: Partial<Record<EngineBlockId, BlockId>> = {
  [BLOCK.GRASS]: "grass", [BLOCK.DIRT]: "dirt", [BLOCK.STONE]: "stone",
  [BLOCK.COBBLESTONE]: "cobblestone", [BLOCK.SAND]: "sand", [BLOCK.GRAVEL]: "gravel", [BLOCK.GLASS]: "glass",
  [BLOCK.COAL_ORE]: "coal_ore", [BLOCK.IRON_ORE]: "iron_ore", [BLOCK.GOLD_ORE]: "gold_ore",
  [BLOCK.DIAMOND_ORE]: "diamond_ore", [BLOCK.WOOD]: "log", [BLOCK.LEAVES]: "leaves",
  [BLOCK.PLANKS]: "planks", [BLOCK.CRAFTING_TABLE]: "crafting_table", [BLOCK.FURNACE]: "furnace",
  [BLOCK.TORCH]: "torch", [BLOCK.CHEST]: "chest", [BLOCK.DOOR_CLOSED]: "door", [BLOCK.DOOR_OPEN]: "door",
  [BLOCK.BED]: "bed", [BLOCK.LADDER]: "ladder", [BLOCK.TNT]: "tnt", [BLOCK.WOOL]: "wool",
  [BLOCK.SAPLING]: "sapling", [BLOCK.STONE_BRICKS]: "stone_bricks", [BLOCK.OAK_FENCE]: "oak_fence",
  [BLOCK.OAK_FENCE_GATE_CLOSED]: "oak_fence_gate", [BLOCK.OAK_FENCE_GATE_OPEN]: "oak_fence_gate",
  [BLOCK.STONE_BRICK_SLAB]: "stone_brick_slab", [BLOCK.CLAY]: "clay", [BLOCK.BRICKS]: "bricks",
  [BLOCK.TORCH_WALL_EAST]: "torch", [BLOCK.TORCH_WALL_NORTH]: "torch",
  [BLOCK.TORCH_WALL_SOUTH]: "torch", [BLOCK.TORCH_WALL_WEST]: "torch",
  [BLOCK.OAK_SLAB]: "oak_slab", [BLOCK.COBBLESTONE_SLAB]: "cobblestone_slab", [BLOCK.BRICK_SLAB]: "brick_slab",
  [BLOCK.OAK_STAIRS_EAST]: "oak_stairs", [BLOCK.OAK_STAIRS_NORTH]: "oak_stairs",
  [BLOCK.OAK_STAIRS_SOUTH]: "oak_stairs", [BLOCK.OAK_STAIRS_WEST]: "oak_stairs",
  [BLOCK.COBBLESTONE_STAIRS_EAST]: "cobblestone_stairs", [BLOCK.COBBLESTONE_STAIRS_NORTH]: "cobblestone_stairs",
  [BLOCK.COBBLESTONE_STAIRS_SOUTH]: "cobblestone_stairs", [BLOCK.COBBLESTONE_STAIRS_WEST]: "cobblestone_stairs",
  [BLOCK.STONE_BRICK_STAIRS_EAST]: "stone_brick_stairs", [BLOCK.STONE_BRICK_STAIRS_NORTH]: "stone_brick_stairs",
  [BLOCK.STONE_BRICK_STAIRS_SOUTH]: "stone_brick_stairs", [BLOCK.STONE_BRICK_STAIRS_WEST]: "stone_brick_stairs",
  [BLOCK.BRICK_STAIRS_EAST]: "brick_stairs", [BLOCK.BRICK_STAIRS_NORTH]: "brick_stairs",
  [BLOCK.BRICK_STAIRS_SOUTH]: "brick_stairs", [BLOCK.BRICK_STAIRS_WEST]: "brick_stairs",
  [BLOCK.OAK_STAIRS_UPSIDE_EAST]: "oak_stairs", [BLOCK.OAK_STAIRS_UPSIDE_NORTH]: "oak_stairs",
  [BLOCK.OAK_STAIRS_UPSIDE_SOUTH]: "oak_stairs", [BLOCK.OAK_STAIRS_UPSIDE_WEST]: "oak_stairs",
  [BLOCK.COBBLESTONE_STAIRS_UPSIDE_EAST]: "cobblestone_stairs", [BLOCK.COBBLESTONE_STAIRS_UPSIDE_NORTH]: "cobblestone_stairs",
  [BLOCK.COBBLESTONE_STAIRS_UPSIDE_SOUTH]: "cobblestone_stairs", [BLOCK.COBBLESTONE_STAIRS_UPSIDE_WEST]: "cobblestone_stairs",
  [BLOCK.STONE_BRICK_STAIRS_UPSIDE_EAST]: "stone_brick_stairs", [BLOCK.STONE_BRICK_STAIRS_UPSIDE_NORTH]: "stone_brick_stairs",
  [BLOCK.STONE_BRICK_STAIRS_UPSIDE_SOUTH]: "stone_brick_stairs", [BLOCK.STONE_BRICK_STAIRS_UPSIDE_WEST]: "stone_brick_stairs",
  [BLOCK.BRICK_STAIRS_UPSIDE_EAST]: "brick_stairs", [BLOCK.BRICK_STAIRS_UPSIDE_NORTH]: "brick_stairs",
  [BLOCK.BRICK_STAIRS_UPSIDE_SOUTH]: "brick_stairs", [BLOCK.BRICK_STAIRS_UPSIDE_WEST]: "brick_stairs",
};
export const ENGINE_TO_GAME: Readonly<Partial<Record<EngineBlockId, BlockId>>> = Object.freeze({
  ...BASE_ENGINE_TO_GAME,
  ...Object.fromEntries(EXPANDED_BLOCK_STATE_TYPES.map((state, index) => [57 + index, gameItemForExpandedState(state)])),
  ...Object.fromEntries(NATURAL_DECORATION_ITEMS.map((item) => [BLOCK[item.toUpperCase() as keyof typeof BLOCK], item])),
});

const BASE_ITEM_TO_ENGINE: Partial<Record<ItemId, EngineBlockId>> = {
  grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND, gravel: BLOCK.GRAVEL, glass: BLOCK.GLASS, coal_ore: BLOCK.COAL_ORE, iron_ore: BLOCK.IRON_ORE,
  gold_ore: BLOCK.GOLD_ORE, diamond_ore: BLOCK.DIAMOND_ORE, log: BLOCK.WOOD, leaves: BLOCK.LEAVES,
  planks: BLOCK.PLANKS, crafting_table: BLOCK.CRAFTING_TABLE, furnace: BLOCK.FURNACE, torch: BLOCK.TORCH,
  chest: BLOCK.CHEST, door: BLOCK.DOOR_CLOSED, bed: BLOCK.BED, ladder: BLOCK.LADDER, tnt: BLOCK.TNT,
  wool: BLOCK.WOOL, sapling: BLOCK.SAPLING, stone_bricks: BLOCK.STONE_BRICKS, oak_fence: BLOCK.OAK_FENCE,
  oak_fence_gate: BLOCK.OAK_FENCE_GATE_CLOSED, stone_brick_slab: BLOCK.STONE_BRICK_SLAB,
  clay: BLOCK.CLAY, bricks: BLOCK.BRICKS,
  oak_slab: BLOCK.OAK_SLAB, cobblestone_slab: BLOCK.COBBLESTONE_SLAB, brick_slab: BLOCK.BRICK_SLAB,
  oak_stairs: BLOCK.OAK_STAIRS_NORTH, cobblestone_stairs: BLOCK.COBBLESTONE_STAIRS_NORTH,
  stone_brick_stairs: BLOCK.STONE_BRICK_STAIRS_NORTH, brick_stairs: BLOCK.BRICK_STAIRS_NORTH,
  water_bucket: BLOCK.WATER, lava_bucket: BLOCK.LAVA,
};
export const ITEM_TO_ENGINE: Readonly<Partial<Record<ItemId, EngineBlockId>>> = Object.freeze({
  ...BASE_ITEM_TO_ENGINE,
  ...Object.fromEntries(EXPANDED_BLOCK_ITEM_IDS.map((item) => {
    const family = item.endsWith("_stairs") ? `${item}_north`
      : item.endsWith("_door") ? `${item.slice(0, -5)}_door_closed_north` : item;
    return [item, (BLOCK as Readonly<Record<string, EngineBlockId>>)[family.toUpperCase()]];
  })),
});

/** Authorize a placed directional state by its canonical inventory identity. */
export function placementBlockMatchesItem(itemId: ItemId, block: EngineBlockId): boolean {
  return ITEM_TO_ENGINE[itemId] !== undefined && ENGINE_TO_GAME[block] === itemId;
}

export function audioSurfaceForBlock(block: EngineBlockId): GameAudioSurface {
  const state = blockStateName(block);
  if ((NATURAL_DECORATION_ITEMS as readonly string[]).includes(state)) return "grass";
  if (state.includes("_planks") || state.includes("_log") || state.includes("_leaves") || state.includes("_door_")
    || (state.includes("_slab") || state.includes("_stairs_"))
      && EXPANDED_WOOD_SHAPE_PREFIXES.some((family) => state.startsWith(`${family}_`))) return "wood";
  if (state) return "stone";
  if (block === BLOCK.GRASS || block === BLOCK.DIRT || block === BLOCK.LEAVES || block === BLOCK.SAPLING
    || block === BLOCK.BED || block === BLOCK.WOOL) return "grass";
  if (block === BLOCK.WOOD || block === BLOCK.PLANKS || block === BLOCK.CRAFTING_TABLE
    || block === BLOCK.CHEST || block === BLOCK.DOOR_CLOSED || block === BLOCK.DOOR_OPEN || block === BLOCK.LADDER
    || block === BLOCK.OAK_FENCE || block === BLOCK.OAK_FENCE_GATE_CLOSED || block === BLOCK.OAK_FENCE_GATE_OPEN) return "wood";
  if (block === BLOCK.SAND) return "sand";
  if (block === BLOCK.GRAVEL || block === BLOCK.CLAY) return "gravel";
  if (block === BLOCK.GLASS || state.endsWith("_stained_glass")) return "glass";
  if (block === BLOCK.IRON_ORE || block === BLOCK.GOLD_ORE || block === BLOCK.DIAMOND_ORE || block === BLOCK.FURNACE) return "metal";
  if (block === BLOCK.STONE || block === BLOCK.COBBLESTONE || block === BLOCK.COAL_ORE
    || block === BLOCK.STONE_BRICKS || block === BLOCK.STONE_BRICK_SLAB || block === BLOCK.BRICKS
    || block === BLOCK.COBBLESTONE_SLAB || block === BLOCK.BRICK_SLAB
    || block >= BLOCK.COBBLESTONE_STAIRS_EAST && block <= BLOCK.BRICK_STAIRS_WEST
    || block >= BLOCK.COBBLESTONE_STAIRS_UPSIDE_EAST && block <= BLOCK.BRICK_STAIRS_UPSIDE_WEST) return "stone";
  if (block === BLOCK.OAK_SLAB || block >= BLOCK.OAK_STAIRS_EAST && block <= BLOCK.OAK_STAIRS_WEST
    || block >= BLOCK.OAK_STAIRS_UPSIDE_EAST && block <= BLOCK.OAK_STAIRS_UPSIDE_WEST) return "wood";
  return "generic";
}
