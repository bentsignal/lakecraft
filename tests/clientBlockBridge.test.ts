import assert from "node:assert/strict";
import {
  ENGINE_TO_GAME,
  ENGINE_TO_PROTOCOL,
  ITEM_TO_ENGINE,
  PROTOCOL_TO_ENGINE,
  audioSurfaceForBlock,
  reverseBlockMap,
} from "../client/game/blockBridge.ts";
import { BLOCK, type BlockId as EngineBlockId } from "../client/game/types.ts";

const protocol = [
  "air", "grass", "dirt", "stone", "wood", "leaves", "planks", "crafting_table", "torch", "chest",
  "door_closed", "door_open", "bed", "coal_ore", "iron_ore", "furnace", "ladder", "cobblestone", "sand",
  "glass", "gold_ore", "diamond_ore", "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence",
  "oak_fence_gate_closed", "oak_fence_gate_open", "stone_brick_slab", "clay", "bricks", undefined,
] as const;
const game = [
  undefined, "grass", "dirt", "stone", "log", "leaves", "planks", "crafting_table", "torch", "chest",
  "door", "door", "bed", "coal_ore", "iron_ore", "furnace", "ladder", "cobblestone", "sand", "glass",
  "gold_ore", "diamond_ore", "tnt", "gravel", "wool", "sapling", "stone_bricks", "oak_fence",
  "oak_fence_gate", "oak_fence_gate", "stone_brick_slab", "clay", "bricks", undefined,
] as const;

assert.deepEqual(ENGINE_TO_PROTOCOL, protocol, "every persisted protocol conversion retains its engine ID");
assert.deepEqual(ENGINE_TO_GAME, game, "every inventory conversion retains its engine ID");
assert.equal(Math.max(...Object.values(BLOCK)), BLOCK.BEDROCK, "bedrock is the current maximum named engine ID");
assert.equal(ENGINE_TO_PROTOCOL.length, BLOCK.BEDROCK + 1, "the protocol bridge explicitly reserves every named engine ID");
assert.equal(ENGINE_TO_GAME.length, BLOCK.BEDROCK + 1, "the inventory bridge explicitly reserves every named engine ID");
for (let id = 0; id < protocol.length; id += 1) {
  const block = protocol[id];
  if (block) assert.equal(PROTOCOL_TO_ENGINE[block], id, `protocol round trip at engine ID ${id}`);
}
assert.equal(PROTOCOL_TO_ENGINE.log, BLOCK.WOOD, "legacy log protocol alias remains readable");
assert.equal(PROTOCOL_TO_ENGINE.bedrock, BLOCK.BEDROCK, "natural bedrock remains readable but not placeable");
assert.equal(ENGINE_TO_PROTOCOL[BLOCK.BEDROCK], undefined, "bedrock remains absent from editable protocol output");
assert.equal(ENGINE_TO_GAME[BLOCK.BEDROCK], undefined, "bedrock remains absent from inventory output");
assert.equal(PROTOCOL_TO_ENGINE.undefined, undefined, "an intentional engine-ID hole cannot leak into the reverse map");
const futureProtocol = reverseBlockMap([...ENGINE_TO_PROTOCOL, "future_block"]);
assert.equal(futureProtocol.future_block, 34, "a future append after the bedrock hole retains engine ID 34");
assert.equal(futureProtocol.undefined, undefined, "a future append still filters the reserved bedrock hole");
for (let id = 0; id < game.length; id += 1) {
  const item = game[id];
  if (!item) continue;
  const expected = item === "door" ? BLOCK.DOOR_CLOSED
    : item === "oak_fence_gate" ? BLOCK.OAK_FENCE_GATE_CLOSED
      : id;
  assert.equal(ITEM_TO_ENGINE[item], expected, `inventory round trip for ${item}`);
}

const expectedSurfaces = new Map<EngineBlockId, ReturnType<typeof audioSurfaceForBlock>>();
for (const [surface, blocks] of [
  ["grass", [BLOCK.GRASS, BLOCK.DIRT, BLOCK.LEAVES, BLOCK.SAPLING, BLOCK.BED, BLOCK.WOOL]],
  ["wood", [BLOCK.WOOD, BLOCK.PLANKS, BLOCK.CRAFTING_TABLE, BLOCK.CHEST, BLOCK.DOOR_CLOSED, BLOCK.DOOR_OPEN,
    BLOCK.LADDER, BLOCK.OAK_FENCE, BLOCK.OAK_FENCE_GATE_CLOSED, BLOCK.OAK_FENCE_GATE_OPEN]],
  ["sand", [BLOCK.SAND]],
  ["gravel", [BLOCK.GRAVEL, BLOCK.CLAY]],
  ["glass", [BLOCK.GLASS]],
  ["metal", [BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE, BLOCK.FURNACE]],
  ["stone", [BLOCK.STONE, BLOCK.COBBLESTONE, BLOCK.COAL_ORE, BLOCK.STONE_BRICKS, BLOCK.STONE_BRICK_SLAB, BLOCK.BRICKS]],
] as const) for (const block of blocks) expectedSurfaces.set(block, surface);
for (let id = BLOCK.AIR; id <= BLOCK.BEDROCK; id += 1) {
  assert.equal(audioSurfaceForBlock(id as EngineBlockId), expectedSurfaces.get(id as EngineBlockId) ?? "generic",
    `audio surface at engine ID ${id}`);
}

console.log("client block bridge tests: ok");
