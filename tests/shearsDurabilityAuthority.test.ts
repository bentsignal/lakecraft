import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INVENTORY_SIZE,
  ITEMS,
  createItemStack,
  maxItemDurability,
  type Inventory,
  type ItemId,
} from "../shared/game.ts";
import { resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";

const SHEARS = "shears" as ItemId;
const maximum = maxItemDurability(SHEARS);
assert.ok(maximum !== null && maximum > 1, "shears must use bounded utility durability");
assert.equal(ITEMS[SHEARS].tool, undefined, "shears must not inherit axe mining or attack semantics");
assert.deepEqual(createItemStack(SHEARS), { itemId: SHEARS, count: 1, durability: maximum });

function emptyInventory(): Inventory {
  return Array.from({ length: INVENTORY_SIZE }, () => null);
}

const request = {
  operationId: "shears_leaf_mine_0001",
  kind: "mine",
  x: 31,
  y: 12,
  z: -47,
  expectedBlock: "leaves",
  selectedHotbar: 0,
  expectedHeldItem: SHEARS,
  expectedInventoryRevision: "4",
  expectedChunkRevision: "9",
} as const;
const inventory = emptyInventory();
inventory[0] = createItemStack(SHEARS);
const before = structuredClone(inventory);
const first = resolveWorldBlockOperation(request, {
  currentBlock: "leaves",
  inventory,
  inventoryRevision: "4",
  chunkRevision: "9",
});
assert.equal(first.ok, true);
if (!first.ok) throw new Error("sheared leaf fixture must resolve");
assert.deepEqual(first.effect.drop, { itemId: "leaves", count: 1 }, "shears preserve the mined leaf block");
assert.equal(first.effect.toolUse.used, true);
assert.equal(first.effect.toolUse.broke, false);
assert.equal(first.effect.toolUse.itemId, SHEARS);
assert.equal(first.effect.toolUse.remainingDurability, maximum - 1);
assert.equal(first.effect.toolUse.inventory[0]?.durability, maximum - 1);
assert.equal(first.effect.toolUse.inventory[1], null, "the wear result itself cannot mint the block drop");
assert.equal(first.effect.inventory[0]?.durability, maximum - 1, "one confirmed leaf break spends exactly one use");
assert.equal(first.effect.inventoryRevision, "5");
assert.deepEqual(inventory, before, "resolution never mutates the caller's canonical inventory snapshot");

const committedInventory = structuredClone(first.effect.inventory);
assert.deepEqual(resolveWorldBlockOperation(request, {
  currentBlock: first.effect.nextBlock,
  inventory: committedInventory,
  inventoryRevision: first.effect.inventoryRevision,
  chunkRevision: first.effect.chunkRevision,
}), { ok: false, reason: "stale_chunk_revision" }, "a duplicate cannot resolve a second mining use");
assert.deepEqual(committedInventory, first.effect.inventory, "duplicate rejection cannot spend durability");

const fullInventory: Inventory = Array.from({ length: INVENTORY_SIZE }, (_, index) => index === 0
  ? { itemId: SHEARS, count: 1, durability: maximum }
  : { itemId: "dirt", count: 64 });
const fullBefore = structuredClone(fullInventory);
assert.deepEqual(resolveWorldBlockOperation({ ...request, operationId: "shears_leaf_full_0001" }, {
  currentBlock: "leaves",
  inventory: fullInventory,
  inventoryRevision: "4",
  chunkRevision: "9",
}), { ok: false, reason: "inventory_full" }, "a rejected conserved drop cannot commit provisional wear");
assert.deepEqual(fullInventory, fullBefore, "inventory-capacity rejection preserves exact shears durability");

assert.deepEqual(resolveWorldBlockOperation({ ...request, operationId: "shears_leaf_stale_001", expectedChunkRevision: "8" }, {
  currentBlock: "leaves",
  inventory,
  inventoryRevision: "4",
  chunkRevision: "9",
}), { ok: false, reason: "stale_chunk_revision" });
assert.deepEqual(inventory, before, "revision rejection preserves exact shears durability");

const toggled = resolveWorldBlockOperation({
  operationId: "shears_door_toggle_001",
  kind: "toggle",
  x: 31,
  y: 12,
  z: -47,
  expectedBlock: "door_closed",
  expectedChunkRevision: "9",
}, {
  currentBlock: "door_closed",
  inventory,
  inventoryRevision: "4",
  chunkRevision: "9",
});
assert.equal(toggled.ok, true);
if (toggled.ok) {
  assert.equal(toggled.effect.toolUse, null, "non-mining world operations never wear shears");
  assert.deepEqual(toggled.effect.inventory, inventory);
}

const stone = resolveWorldBlockOperation({
  ...request,
  operationId: "shears_stone_mine_0001",
  expectedBlock: "stone",
}, {
  currentBlock: "stone",
  inventory,
  inventoryRevision: "4",
  chunkRevision: "9",
});
assert.equal(stone.ok, true);
if (stone.ok) {
  assert.equal(stone.effect.toolUse.used, false, "shears only wear when used for their leaf-clipping purpose");
  assert.deepEqual(stone.effect.inventory[0], inventory[0]);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = fs.readFileSync(path.join(root, "client/singleplayer/SinglePlayerApp.tsx"), "utf8");
const worldAuthority = fs.readFileSync(path.join(root, "shared/worldBlockOperations.ts"), "utf8");
assert.match(local, /edit\.block === BLOCK\.AIR && previousBlock !== BLOCK\.AIR[\s\S]*?held === "shears" && gameBlock === "leaves"[\s\S]*?applyConfirmedDurableItemUse/,
  "offline wear is downstream of the engine's confirmed solid-block break callback");
assert.match(worldAuthority, /expectedHeldItem === "shears" && gameBlock === "leaves"[\s\S]*?applyConfirmedDurableItemUse/,
  "Lakebed resolution uses generic durable utility wear without granting tool semantics");
assert.doesNotMatch(local, /setInterval\([^)]*shears|setTimeout\([^)]*shears/,
  "shears add no durability request or timer loop");

console.log("shears local and Lakebed-authoritative durability tests passed");
