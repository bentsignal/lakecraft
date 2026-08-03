import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ENGINE_TO_GAME,
  ENGINE_TO_PROTOCOL,
  ITEM_TO_ENGINE,
  PROTOCOL_TO_ENGINE,
  audioSurfaceForBlock,
  reverseBlockMap,
} from "../client/game/blockBridge.ts";
import { BLOCK, type BlockId as EngineBlockId } from "../client/game/types.ts";
import { BLOCKS } from "../shared/game.ts";
import { BLOCK_TYPES } from "../shared/protocol.ts";

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
const editableProtocols = ENGINE_TO_PROTOCOL.filter((block): block is NonNullable<typeof block> => block !== undefined);
const sharedEditableProtocols = BLOCK_TYPES.filter((block) => block !== "bedrock");
assert.equal(new Set(editableProtocols).size, editableProtocols.length, "editable protocol identities are unique");
assert.deepEqual([...editableProtocols].sort(), [...sharedEditableProtocols].sort(),
  "the engine bridge contains exactly the shared protocol catalog except natural bedrock");
assert.deepEqual(Object.keys(PROTOCOL_TO_ENGINE).sort(), [...BLOCK_TYPES, "log"].sort(),
  "the reverse bridge contains every shared protocol identity plus only the legacy log alias");
const gameBlocks = Object.keys(BLOCKS).sort();
const bridgedGameBlocks = ENGINE_TO_GAME.filter((block): block is NonNullable<typeof block> => block !== undefined);
assert.deepEqual([...new Set(bridgedGameBlocks)].sort(), gameBlocks,
  "the engine bridge contains exactly the shared game block catalog");
assert.deepEqual(Object.keys(ITEM_TO_ENGINE).sort(), gameBlocks,
  "the item reverse bridge has exactly one key for every shared game block");
assert.equal(new Set(Object.values(ITEM_TO_ENGINE)).size, gameBlocks.length,
  "every shared block item resolves to one unique placeable engine state");
for (const block of gameBlocks) {
  const engine = ITEM_TO_ENGINE[block as keyof typeof ITEM_TO_ENGINE];
  assert.notEqual(engine, undefined, `shared game block ${block} is placeable`);
  assert.equal(ENGINE_TO_GAME[engine!], block, `shared game block ${block} round-trips through its placeable engine state`);
}
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
assert.equal(Object.hasOwn(BLOCKS, "bedrock"), false, "natural bedrock is explicitly absent from shared inventory blocks");
assert.equal(Object.hasOwn(ITEM_TO_ENGINE, "bedrock"), false, "natural bedrock cannot enter the item reverse bridge");
assert.equal(PROTOCOL_TO_ENGINE.undefined, undefined, "an intentional engine-ID hole cannot leak into the reverse map");
const futureProtocol = reverseBlockMap([...ENGINE_TO_PROTOCOL, "future_block"]);
assert.equal(futureProtocol.future_block, 34, "a future append after the bedrock hole retains engine ID 34");
assert.equal(futureProtocol.undefined, undefined, "a future append still filters the reserved bedrock hole");
assert.throws(() => reverseBlockMap([...ENGINE_TO_PROTOCOL, "stone"]),
  /Duplicate block bridge identity: stone/,
  "a future append cannot silently remap an existing persisted protocol identity");
assert.throws(() => reverseBlockMap([...ENGINE_TO_PROTOCOL, "future_block", "future_block"]),
  /Duplicate block bridge identity: future_block/,
  "two future blocks cannot silently share one protocol identity");
assert.throws(() => reverseBlockMap([...ENGINE_TO_PROTOCOL, "air"]),
  /Duplicate block bridge identity: air/,
  "duplicate detection also protects the engine-zero protocol identity");
for (const [label, relative, sharedImport] of [
  ["multiplayer", "../client/index.tsx", /from "\.\/game\/blockBridge\.ts"/],
  ["single-player", "../client/singleplayer/SinglePlayerApp.tsx", /from "\.\.\/game\/blockBridge\.ts"/],
] as const) {
  assert.match(readFileSync(new URL(relative, import.meta.url), "utf8"), sharedImport,
    `${label} consumes the tested shared bridge instead of a private mapping table`);
}
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
