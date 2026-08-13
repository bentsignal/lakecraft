import type { BlockId, ItemId } from "../../shared/game.ts";
import { BLOCK, type BlockId as EngineBlockId } from "../game/types.ts";
import type { GameAudioSurface } from "../game/audio.ts";

/** Canonical gameplay/catalog bridge shared by every authority mode. */
export const ENGINE_TO_GAME: Readonly<Partial<Record<EngineBlockId, BlockId>>> = Object.freeze({
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
});

export const ITEM_TO_ENGINE: Readonly<Partial<Record<ItemId, EngineBlockId>>> = Object.freeze({
  grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND, gravel: BLOCK.GRAVEL, glass: BLOCK.GLASS, coal_ore: BLOCK.COAL_ORE, iron_ore: BLOCK.IRON_ORE,
  gold_ore: BLOCK.GOLD_ORE, diamond_ore: BLOCK.DIAMOND_ORE, log: BLOCK.WOOD, leaves: BLOCK.LEAVES,
  planks: BLOCK.PLANKS, crafting_table: BLOCK.CRAFTING_TABLE, furnace: BLOCK.FURNACE, torch: BLOCK.TORCH,
  chest: BLOCK.CHEST, door: BLOCK.DOOR_CLOSED, bed: BLOCK.BED, ladder: BLOCK.LADDER, tnt: BLOCK.TNT,
  wool: BLOCK.WOOL, sapling: BLOCK.SAPLING, stone_bricks: BLOCK.STONE_BRICKS, oak_fence: BLOCK.OAK_FENCE,
  oak_fence_gate: BLOCK.OAK_FENCE_GATE_CLOSED, stone_brick_slab: BLOCK.STONE_BRICK_SLAB,
  clay: BLOCK.CLAY, bricks: BLOCK.BRICKS,
});

export function audioSurfaceForBlock(block: EngineBlockId): GameAudioSurface {
  if (block === BLOCK.GRASS || block === BLOCK.DIRT || block === BLOCK.LEAVES || block === BLOCK.SAPLING
    || block === BLOCK.BED || block === BLOCK.WOOL) return "grass";
  if (block === BLOCK.WOOD || block === BLOCK.PLANKS || block === BLOCK.CRAFTING_TABLE
    || block === BLOCK.CHEST || block === BLOCK.DOOR_CLOSED || block === BLOCK.DOOR_OPEN || block === BLOCK.LADDER
    || block === BLOCK.OAK_FENCE || block === BLOCK.OAK_FENCE_GATE_CLOSED || block === BLOCK.OAK_FENCE_GATE_OPEN) return "wood";
  if (block === BLOCK.SAND) return "sand";
  if (block === BLOCK.GRAVEL || block === BLOCK.CLAY) return "gravel";
  if (block === BLOCK.GLASS) return "glass";
  if (block === BLOCK.IRON_ORE || block === BLOCK.GOLD_ORE || block === BLOCK.DIAMOND_ORE || block === BLOCK.FURNACE) return "metal";
  if (block === BLOCK.STONE || block === BLOCK.COBBLESTONE || block === BLOCK.COAL_ORE
    || block === BLOCK.STONE_BRICKS || block === BLOCK.STONE_BRICK_SLAB || block === BLOCK.BRICKS) return "stone";
  return "generic";
}

