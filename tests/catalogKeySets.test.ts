import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCKS, ITEMS, type BlockId, type ItemId } from "../shared/game.ts";

const EXPECTED_BLOCK_IDS = [
  "grass", "dirt", "stone", "cobblestone", "sand", "gravel", "glass", "coal_ore", "iron_ore", "gold_ore",
  "diamond_ore", "log", "leaves", "planks", "crafting_table", "furnace", "torch", "chest", "door", "bed",
  "ladder", "tnt", "wool", "sapling", "stone_bricks", "oak_fence", "oak_fence_gate", "stone_brick_slab", "clay", "bricks",
] as const satisfies readonly BlockId[];
const EXPECTED_ITEM_IDS = [
  ...EXPECTED_BLOCK_IDS,
  "stick", "string", "bone", "bone_meal", "feather", "arrow", "leather", "coal", "charcoal", "raw_iron",
  "iron_ingot", "raw_gold", "gold_ingot", "diamond", "gunpowder", "flint", "clay_ball", "brick", "flint_and_steel", "shears", "bow",
  "apple", "pork", "beef", "mutton", "raw_chicken", "cooked_pork", "cooked_beef", "cooked_mutton", "cooked_chicken", "rotten_flesh",
  "wooden_pickaxe", "wooden_axe", "wooden_shovel", "wooden_sword", "stone_pickaxe", "stone_axe", "stone_shovel", "stone_sword",
  "iron_pickaxe", "iron_axe", "iron_shovel", "iron_sword", "golden_pickaxe", "golden_axe", "golden_shovel", "golden_sword",
  "diamond_pickaxe", "diamond_axe", "diamond_shovel", "diamond_sword",
  "leather_helmet", "leather_chestplate", "leather_leggings", "leather_boots", "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots",
  "golden_helmet", "golden_chestplate", "golden_leggings", "golden_boots", "diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots",
] as const satisfies readonly ItemId[];
const blockIdsAreExhaustive: Exclude<BlockId, (typeof EXPECTED_BLOCK_IDS)[number]> extends never ? true : never = true;
const itemIdsAreExhaustive: Exclude<ItemId, (typeof EXPECTED_ITEM_IDS)[number]> extends never ? true : never = true;
assert.equal(blockIdsAreExhaustive && itemIdsAreExhaustive, true);

const blockKeys = Object.keys(BLOCKS).sort();
const blockItemKeys = Object.values(ITEMS)
  .filter((item) => item.category === "block")
  .map((item) => item.id)
  .sort();

assert.deepEqual(blockKeys, [...EXPECTED_BLOCK_IDS].sort(), "BLOCKS keys exactly match the pinned BlockId set");
assert.deepEqual(Object.keys(ITEMS).sort(), [...EXPECTED_ITEM_IDS].sort(), "ITEMS keys exactly match the pinned ItemId set");
assert.deepEqual(blockItemKeys, blockKeys, "every shared BlockId has exactly one placeable item definition");
assert.deepEqual(
  Object.keys(ITEMS).sort(),
  [...new Set(Object.values(ITEMS).map((item) => item.id))].sort(),
  "ITEMS keys are exactly its canonical ItemId values",
);
assert.equal("bedrock" in BLOCKS, false, "bedrock is world terrain, not a shared placeable block item");
assert.equal("bedrock" in ITEMS, false, "bedrock cannot enter inventories or creative item surfaces");

function between(source: string, start: string, end: string): string {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
for (const path of ["../client/index.tsx", "../client/singleplayer/SinglePlayerApp.tsx"]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.doesNotMatch(between(source, "const ENGINE_TO_GAME", "const ITEM_TO_ENGINE"), /bedrock|BEDROCK/,
    `${path} cannot turn world bedrock into a collectible game block`);
  assert.doesNotMatch(between(source, "const ITEM_TO_ENGINE", "function audioSurfaceForBlock"), /bedrock|BEDROCK/,
    `${path} cannot place bedrock from an item`);
}
assert.doesNotMatch(
  readFileSync(new URL("../client/game/blockItemCubeGeometry.ts", import.meta.url), "utf8"),
  /bedrock|BEDROCK/,
  "held and GUI block-item geometry has no bedrock adapter",
);

console.log("shared block/item catalog exact key-set tests passed");
