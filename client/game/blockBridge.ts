import type { BlockId as GameBlockId, ItemId } from "../../shared/game.ts";
import type { BlockType } from "../../shared/protocol.ts";
import type { GameAudioSurface } from "./audio.ts";
import { BLOCK, type BlockId as EngineBlockId } from "./types.ts";

/** Contiguous engine IDs make the protocol bridge smaller and cheaper than keyed objects. */
export const ENGINE_TO_PROTOCOL: readonly (BlockType | undefined)[] = [
  "air", "grass", "dirt", "stone", "wood", "leaves", "planks", "crafting_table", "torch", "chest",
  "door_closed", "door_open", "bed", "coal_ore", "iron_ore", "furnace", "ladder", "cobblestone", "sand",
  "glass", "gold_ore", "diamond_ore", "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence",
  "oak_fence_gate_closed", "oak_fence_gate_open", "stone_brick_slab", "clay", "bricks", undefined,
];

export const ENGINE_TO_GAME: readonly (GameBlockId | undefined)[] = [
  undefined, "grass", "dirt", "stone", "log", "leaves", "planks", "crafting_table", "torch", "chest",
  "door", "door", "bed", "coal_ore", "iron_ore", "furnace", "ladder", "cobblestone", "sand", "glass",
  "gold_ore", "diamond_ore", "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence",
  "oak_fence_gate", "oak_fence_gate", "stone_brick_slab", "clay", "bricks", undefined,
];

export const reverseBlockMap = <T extends string>(blocks: readonly (T | undefined)[]) => blocks.reduce<Record<string, number>>(
  (result, block, id) => {
    if (!block) return result;
    if (result[block] !== undefined) throw new Error(`Duplicate block bridge identity: ${block}`);
    result[block] = id;
    return result;
  }, {},
);

export const PROTOCOL_TO_ENGINE = Object.assign(
  reverseBlockMap(ENGINE_TO_PROTOCOL),
  { bedrock: BLOCK.BEDROCK, log: BLOCK.WOOD },
) as Record<string, EngineBlockId>;

export const ITEM_TO_ENGINE = ENGINE_TO_GAME.reduce<Partial<Record<ItemId, EngineBlockId>>>((result, item, id) => {
  if (item && result[item] === undefined) result[item] = id as EngineBlockId;
  return result;
}, {});

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
