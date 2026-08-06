import assert from "node:assert/strict";
import { INVENTORY_SIZE, ITEMS, type Inventory } from "../shared/game.ts";
import {
  MAX_WORLD_BLOCK_OPERATION_ID_LENGTH,
  MAX_WORLD_BLOCK_REVISION,
  isValidWorldBlockOperationId,
  nextWorldBlockRevision,
  normalizeWorldBlockRevision,
  parseWorldBlockOperation,
  parseWorldBlockRevision,
  placedWorldBlockForItem,
  resolveWorldBlockOperation,
  worldBlockOperationFingerprint,
} from "../shared/worldBlockOperations.ts";

const mine = {
  operationId: "mine_request_0001",
  kind: "mine",
  x: -12,
  y: 7,
  z: 99,
  expectedBlock: "stone",
  selectedHotbar: 0,
  expectedHeldItem: "wooden_pickaxe",
  expectedInventoryRevision: "8",
  expectedChunkRevision: "13",
} as const;

const place = {
  operationId: "place_request_001",
  kind: "place",
  x: 1,
  y: 2,
  z: 3,
  expectedBlock: "air",
  placedBlock: "wood",
  selectedHotbar: 4,
  expectedHeldItem: "log",
  expectedInventoryRevision: "0",
  expectedChunkRevision: "1",
} as const;

const toggle = {
  operationId: "toggle_request_01",
  kind: "toggle",
  x: 1,
  y: 2,
  z: 3,
  expectedBlock: "door_closed",
  expectedChunkRevision: "2",
} as const;

for (const request of [mine, place, toggle]) {
  const parsed = parseWorldBlockOperation(request);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.request, request);
    assert.equal(parsed.fingerprint, worldBlockOperationFingerprint(parsed.request));
    assert.equal(parsed.fingerprint, parseWorldBlockOperation({ ...request }).ok
      ? (parseWorldBlockOperation({ ...request }) as { ok: true; fingerprint: string }).fingerprint
      : "unreachable");
  }
}

assert.equal(parseWorldBlockRevision("0"), 0);
assert.equal(parseWorldBlockRevision(String(MAX_WORLD_BLOCK_REVISION)), MAX_WORLD_BLOCK_REVISION);
assert.equal(normalizeWorldBlockRevision("19"), "19");
assert.equal(nextWorldBlockRevision("19"), "20");
assert.equal(nextWorldBlockRevision(String(MAX_WORLD_BLOCK_REVISION)), null);
for (const invalid of [null, 1, "", "00", "01", "+1", "-1", " 1", "1 ", "1e3", "9007199254740992", "9999999999999999"]) {
  assert.equal(parseWorldBlockRevision(invalid), null, `revision ${String(invalid)} must fail closed`);
  assert.equal(normalizeWorldBlockRevision(invalid), null);
}

assert.equal(isValidWorldBlockOperationId("1234567890abcdef"), true);
assert.equal(isValidWorldBlockOperationId("id_with-safe-characters"), true);
assert.equal(isValidWorldBlockOperationId("short"), false);
assert.equal(isValidWorldBlockOperationId("x".repeat(MAX_WORLD_BLOCK_OPERATION_ID_LENGTH + 1)), false);
assert.equal(isValidWorldBlockOperationId("1234567890abcde!"), false);

function reason(value: unknown): string {
  const parsed = parseWorldBlockOperation(value);
  assert.equal(parsed.ok, false);
  return parsed.ok ? "" : parsed.reason;
}

assert.equal(reason(null), "invalid_request");
assert.equal(reason({ ...mine, surprise: true }), "invalid_request");
const { expectedBlock: _missing, ...missing } = mine;
assert.equal(reason(missing), "invalid_request");
assert.equal(reason({ ...mine, operationId: "tiny" }), "invalid_operation_id");
assert.equal(reason({ ...mine, operationId: "x".repeat(65) }), "invalid_operation_id");
assert.equal(reason({ ...mine, kind: "smelt" }), "invalid_kind");
assert.equal(reason({ ...mine, x: 1.25 }), "invalid_coordinate");
assert.equal(reason({ ...mine, y: 193 }), "invalid_coordinate");
assert.equal(reason({ ...mine, z: 1_000_001 }), "invalid_coordinate");
assert.equal(reason({ ...mine, expectedChunkRevision: "01" }), "invalid_revision");
assert.equal(reason({ ...mine, expectedInventoryRevision: "-1" }), "invalid_revision");
assert.equal(reason({ ...mine, selectedHotbar: 9 }), "invalid_hotbar_slot");
assert.equal(reason({ ...mine, expectedHeldItem: "admin_sword" }), "invalid_held_item");
assert.equal(reason({ ...mine, expectedBlock: "air" }), "invalid_block");
assert.equal(reason({ ...place, expectedBlock: "stone" }), "invalid_block");
assert.equal(reason({ ...place, placedBlock: "air" }), "invalid_block");
assert.equal(reason({ ...toggle, expectedBlock: "stone" }), "invalid_block");
assert.equal(reason({ ...toggle, selectedHotbar: 0 }), "invalid_request");
assert.equal(reason({ ...mine, padding: "🙂".repeat(1_100) }), "request_too_large");

assert.equal(placedWorldBlockForItem("log"), "wood");
assert.equal(placedWorldBlockForItem("door"), "door_closed");
assert.equal(placedWorldBlockForItem("diamond"), null);

function emptyInventory(): Inventory {
  return Array.from({ length: INVENTORY_SIZE }, () => null);
}

const miningInventory = emptyInventory();
miningInventory[0] = { itemId: "wooden_pickaxe", count: 1, durability: ITEMS.wooden_pickaxe.tool!.maxDurability };
const miningBefore = structuredClone(miningInventory);
const mined = resolveWorldBlockOperation(mine, {
  currentBlock: "stone",
  inventory: miningInventory,
  inventoryRevision: "8",
  chunkRevision: "13",
});
assert.equal(mined.ok, true);
if (mined.ok) {
  assert.equal(mined.effect.kind, "mine");
  assert.equal(mined.effect.nextBlock, "air");
  assert.deepEqual(mined.effect.drop, { itemId: "cobblestone", count: 1 });
  assert.equal(mined.effect.toolUse.remainingDurability, ITEMS.wooden_pickaxe.tool!.maxDurability - 1);
  assert.deepEqual(mined.effect.inventory[1], { itemId: "cobblestone", count: 1 });
  assert.equal(mined.effect.inventoryRevision, "9");
  assert.equal(mined.effect.chunkRevision, "14");
  assert.equal(mined.effect.inventoryChanged, true);

  const duplicate = resolveWorldBlockOperation(mine, {
    currentBlock: mined.effect.nextBlock,
    inventory: mined.effect.inventory,
    inventoryRevision: mined.effect.inventoryRevision,
    chunkRevision: mined.effect.chunkRevision,
  });
  assert.deepEqual(duplicate, { ok: false, reason: "stale_chunk_revision" });
}
assert.deepEqual(miningInventory, miningBefore, "successful resolution must not mutate its input inventory");

const weakPickInventory = emptyInventory();
weakPickInventory[0] = { itemId: "wooden_pickaxe", count: 1, durability: 10 };
const weakPickMine = resolveWorldBlockOperation({ ...mine, expectedBlock: "diamond_ore" }, {
  currentBlock: "diamond_ore",
  inventory: weakPickInventory,
  inventoryRevision: "8",
  chunkRevision: "13",
});
assert.equal(weakPickMine.ok, true);
if (weakPickMine.ok) {
  assert.equal(weakPickMine.effect.drop, null, "an inadequate tool breaks the block without minting its drop");
  assert.equal(weakPickMine.effect.toolUse.remainingDurability, 9);
  assert.equal(weakPickMine.effect.inventoryRevision, "9");
}

const handMine = resolveWorldBlockOperation({ ...mine, expectedHeldItem: null }, {
  currentBlock: "stone",
  inventory: emptyInventory(),
  inventoryRevision: "8",
  chunkRevision: "13",
});
assert.equal(handMine.ok, true);
if (handMine.ok) {
  assert.equal(handMine.effect.drop, null);
  assert.equal(handMine.effect.inventoryChanged, false);
  assert.equal(handMine.effect.inventoryRevision, "8", "unchanged inventory rows keep their revision");
}

const swordInventory = emptyInventory();
swordInventory[0] = { itemId: "iron_sword", count: 1, durability: 10 };
const swordMine = resolveWorldBlockOperation({ ...mine, expectedBlock: "dirt", expectedHeldItem: "iron_sword" }, {
  currentBlock: "dirt",
  inventory: swordInventory,
  inventoryRevision: "8",
  chunkRevision: "13",
});
assert.equal(swordMine.ok, true);
if (swordMine.ok) assert.equal(swordMine.effect.toolUse.remainingDurability, 8, "swords spend two durability while mining");

const fullInventory: Inventory = Array.from({ length: INVENTORY_SIZE }, (_, index) => index === 0
  ? { itemId: "wooden_pickaxe", count: 1, durability: 10 }
  : { itemId: "dirt", count: 64 });
const fullBefore = structuredClone(fullInventory);
assert.deepEqual(resolveWorldBlockOperation(mine, {
  currentBlock: "stone",
  inventory: fullInventory,
  inventoryRevision: "8",
  chunkRevision: "13",
}), { ok: false, reason: "inventory_full" });
assert.deepEqual(fullInventory, fullBefore, "failed drop capacity checks must not spend durability");

const breakingInventory: Inventory = Array.from({ length: INVENTORY_SIZE }, (_, index) => index === 0
  ? { itemId: "wooden_pickaxe", count: 1, durability: 1 }
  : { itemId: "dirt", count: 64 });
const breakingMine = resolveWorldBlockOperation(mine, {
  currentBlock: "stone",
  inventory: breakingInventory,
  inventoryRevision: "8",
  chunkRevision: "13",
});
assert.equal(breakingMine.ok, true);
if (breakingMine.ok) {
  assert.equal(breakingMine.effect.toolUse.broke, true);
  assert.deepEqual(breakingMine.effect.inventory[0], { itemId: "cobblestone", count: 1 }, "the drop may occupy the slot freed by a broken tool");
}

const placeInventory = emptyInventory();
placeInventory[4] = { itemId: "log", count: 2 };
placeInventory[8] = { itemId: "log", count: 7 };
const placeBefore = structuredClone(placeInventory);
const placed = resolveWorldBlockOperation(place, {
  currentBlock: "air",
  inventory: placeInventory,
  inventoryRevision: "0",
  chunkRevision: "1",
});
assert.equal(placed.ok, true);
if (placed.ok) {
  assert.equal(placed.effect.kind, "place");
  assert.equal(placed.effect.nextBlock, "wood");
  assert.equal(placed.effect.consumed, "log");
  assert.deepEqual(placed.effect.inventory[4], { itemId: "log", count: 1 });
  assert.deepEqual(placed.effect.inventory[8], { itemId: "log", count: 7 }, "placement consumes only the selected stack");
  assert.equal(placed.effect.inventoryRevision, "1");
  assert.equal(placed.effect.chunkRevision, "2");
}
assert.deepEqual(placeInventory, placeBefore);

const lastBlockInventory = emptyInventory();
lastBlockInventory[4] = { itemId: "log", count: 1 };
const lastBlockPlaced = resolveWorldBlockOperation(place, {
  currentBlock: "air",
  inventory: lastBlockInventory,
  inventoryRevision: "0",
  chunkRevision: "1",
});
assert.equal(lastBlockPlaced.ok, true);
if (lastBlockPlaced.ok) assert.equal(lastBlockPlaced.effect.inventory[4], null);

assert.deepEqual(resolveWorldBlockOperation(place, {
  currentBlock: "air",
  inventory: emptyInventory(),
  inventoryRevision: "0",
  chunkRevision: "1",
}), { ok: false, reason: "held_item_mismatch" });
const materialInventory = emptyInventory();
materialInventory[4] = { itemId: "diamond", count: 1 };
assert.deepEqual(resolveWorldBlockOperation({ ...place, expectedHeldItem: "diamond", placedBlock: "stone" }, {
  currentBlock: "air",
  inventory: materialInventory,
  inventoryRevision: "0",
  chunkRevision: "1",
}), { ok: false, reason: "not_placeable" });
assert.deepEqual(resolveWorldBlockOperation({ ...place, placedBlock: "stone" }, {
  currentBlock: "air",
  inventory: placeInventory,
  inventoryRevision: "0",
  chunkRevision: "1",
}), { ok: false, reason: "placed_block_mismatch" });

const toggleInventory = emptyInventory();
toggleInventory[0] = { itemId: "diamond", count: 3 };
const toggled = resolveWorldBlockOperation(toggle, {
  currentBlock: "door_closed",
  inventory: toggleInventory,
  inventoryRevision: "55",
  chunkRevision: "2",
});
assert.equal(toggled.ok, true);
if (toggled.ok) {
  assert.equal(toggled.effect.nextBlock, "door_open");
  assert.equal(toggled.effect.inventoryRevision, "55");
  assert.equal(toggled.effect.chunkRevision, "3");
  assert.equal(toggled.effect.inventoryChanged, false);
  assert.deepEqual(toggled.effect.inventory, toggleInventory);
  assert.notEqual(toggled.effect.inventory, toggleInventory);
}

assert.deepEqual(resolveWorldBlockOperation(mine, {
  currentBlock: "stone",
  inventory: miningInventory,
  inventoryRevision: "7",
  chunkRevision: "13",
}), { ok: false, reason: "stale_inventory_revision" });
assert.deepEqual(resolveWorldBlockOperation(mine, {
  currentBlock: "stone",
  inventory: miningInventory,
  inventoryRevision: "8",
  chunkRevision: "12",
}), { ok: false, reason: "stale_chunk_revision" });
assert.deepEqual(resolveWorldBlockOperation(mine, {
  currentBlock: "dirt",
  inventory: miningInventory,
  inventoryRevision: "8",
  chunkRevision: "13",
}), { ok: false, reason: "block_mismatch" });
assert.deepEqual(resolveWorldBlockOperation({ ...mine, expectedHeldItem: "stone_pickaxe" }, {
  currentBlock: "stone",
  inventory: miningInventory,
  inventoryRevision: "8",
  chunkRevision: "13",
}), { ok: false, reason: "held_item_mismatch" });
assert.deepEqual(resolveWorldBlockOperation({ ...mine, surprise: true } as never, {
  currentBlock: "stone",
  inventory: miningInventory,
  inventoryRevision: "8",
  chunkRevision: "13",
}), { ok: false, reason: "invalid_request" });
const malformedInventory = emptyInventory();
malformedInventory[0] = { itemId: "wooden_pickaxe", count: 0, durability: 10 };
assert.deepEqual(resolveWorldBlockOperation(mine, {
  currentBlock: "stone",
  inventory: malformedInventory,
  inventoryRevision: "8",
  chunkRevision: "13",
}), { ok: false, reason: "invalid_state" }, "non-canonical inventory rows must fail closed");
assert.deepEqual(resolveWorldBlockOperation({ ...mine, expectedChunkRevision: String(MAX_WORLD_BLOCK_REVISION) }, {
  currentBlock: "stone",
  inventory: miningInventory,
  inventoryRevision: "8",
  chunkRevision: String(MAX_WORLD_BLOCK_REVISION),
}), { ok: false, reason: "revision_overflow" });

let replayState = {
  currentBlock: "door_closed" as "door_closed" | "door_open",
  inventory: emptyInventory(),
  inventoryRevision: "0",
  chunkRevision: "0",
};
for (let index = 0; index < 1_000; index += 1) {
  const request = {
    operationId: `toggle_request_${String(index).padStart(4, "0")}`,
    kind: "toggle" as const,
    x: 0,
    y: 2,
    z: 0,
    expectedBlock: replayState.currentBlock,
    expectedChunkRevision: replayState.chunkRevision,
  };
  const first = resolveWorldBlockOperation(request, replayState);
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("unreachable");
  const committedState = {
    currentBlock: first.effect.nextBlock,
    inventory: first.effect.inventory,
    inventoryRevision: first.effect.inventoryRevision,
    chunkRevision: first.effect.chunkRevision,
  };
  assert.deepEqual(resolveWorldBlockOperation(request, committedState), {
    ok: false,
    reason: "stale_chunk_revision",
  }, `stale replay ${index} must not resolve a second transition`);
  replayState = committedState;
}

console.log("world block operation model tests passed");
