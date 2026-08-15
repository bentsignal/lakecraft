import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCK_TYPES, isBlockType } from "../shared/protocol.ts";
import { INVENTORY_SIZE, ITEMS, type Inventory } from "../shared/game.ts";
import { parseWorldBlockOperation, placedWorldBlockForItem, resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";
import { audioSurfaceForBlock } from "../client/gameplay/catalog.ts";
import { BLOCK } from "../client/game/types.ts";

assert.equal(BLOCK_TYPES.indexOf("stone_bricks"), 26, "stone bricks append without renumbering deployed protocol identities");
assert.equal(isBlockType("stone_bricks"), true);
assert.equal(placedWorldBlockForItem("stone_bricks"), "stone_bricks");

const inventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
inventory[0] = { itemId: "stone_bricks", count: 2 };
inventory[1] = { itemId: "wooden_pickaxe", count: 1, durability: ITEMS.wooden_pickaxe.tool!.maxDurability };
const placeRequest = {
  operationId: "stone_bricks_place_001",
  kind: "place",
  x: -18,
  y: 14,
  z: 33,
  expectedBlock: "air",
  placedBlock: "stone_bricks",
  selectedHotbar: 0,
  expectedHeldItem: "stone_bricks",
  expectedInventoryRevision: "4",
  expectedChunkRevision: "8",
} as const;
assert.equal(parseWorldBlockOperation(placeRequest).ok, true);
const placed = resolveWorldBlockOperation(placeRequest, {
  currentBlock: "air",
  inventory,
  inventoryRevision: "4",
  chunkRevision: "8",
});
assert.equal(placed.ok, true);
if (!placed.ok) throw new Error("stone-brick placement fixture must resolve");
assert.equal(placed.effect.nextBlock, "stone_bricks");
assert.deepEqual(placed.effect.inventory[0], { itemId: "stone_bricks", count: 1 }, "placement consumes exactly one block");

const mineRequest = {
  operationId: "stone_bricks_mine_0001",
  kind: "mine",
  x: -18,
  y: 14,
  z: 33,
  expectedBlock: "stone_bricks",
  selectedHotbar: 1,
  expectedHeldItem: "wooden_pickaxe",
  expectedInventoryRevision: placed.effect.inventoryRevision,
  expectedChunkRevision: placed.effect.chunkRevision,
} as const;
assert.equal(parseWorldBlockOperation(mineRequest).ok, true);
const mined = resolveWorldBlockOperation(mineRequest, {
  currentBlock: "stone_bricks",
  inventory: placed.effect.inventory,
  inventoryRevision: placed.effect.inventoryRevision,
  chunkRevision: placed.effect.chunkRevision,
});
assert.equal(mined.ok, true);
if (!mined.ok) throw new Error("stone-brick mining fixture must resolve");
assert.equal(mined.effect.nextBlock, "air");
assert.deepEqual(mined.effect.drop, { itemId: "stone_bricks", count: 1 });
assert.deepEqual(mined.effect.inventory[0], { itemId: "stone_bricks", count: 2 }, "pickaxe mining returns exactly the placed block");
assert.equal(mined.effect.toolUse.remainingDurability, ITEMS.wooden_pickaxe.tool!.maxDurability - 1);

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const single = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const singleSave = readFileSync(new URL("../client/singleplayer/localSave.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../client/gameplay/catalog.ts", import.meta.url), "utf8");
assert.match(catalog, /\[BLOCK\.STONE_BRICKS\]:\s*"stone_bricks"/);
assert.match(catalog, /stone_bricks:\s*BLOCK\.STONE_BRICKS/);
assert.equal(audioSurfaceForBlock(BLOCK.STONE_BRICKS), "stone");
assert.equal(audioSurfaceForBlock(BLOCK.STONE_BRICK_SLAB), "stone");
assert.equal(audioSurfaceForBlock(BLOCK.BRICKS), "stone");
assert.equal(audioSurfaceForBlock(BLOCK.QUARTZ_STAIRS_UPSIDE_WEST), "stone");
assert.match(singleSave, /candidate\.block, BLOCK\.AIR, BLOCK\.CRYING_OBSIDIAN/, "single-player saves retain stone bricks and every newer append-only block ID");

const mutation = server.slice(server.indexOf("editWorldBlock: mutation(async"), server.indexOf("startPresenceSession: mutation("));
assert.ok(mutation.includes("parseWorldBlockOperation(rawRequest)"));
assert.ok(mutation.includes("resolveWorldBlockOperation(request"));
assert.ok(mutation.includes("blockType: effect.nextBlock"));
assert.match(server, /const PLACEABLE_BLOCKS = new Set<string>\(BLOCK_TYPES\.filter\(\(block\) => block !== "air" && block !== "bedrock"\)\)/,
  "Lakebed derives stone-brick acceptance from the append-only shared protocol catalog");
assert.doesNotMatch(mutation, /setInterval|setTimeout|fetch\(/, "stone bricks stay on the existing discrete exact-once world mutation");

console.log("stone-brick multiplayer/single-player/Lakebed place, mine, self-drop, save, and audio wiring tests passed");
