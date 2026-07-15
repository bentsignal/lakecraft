import assert from "node:assert/strict";
import {
  MAX_CHEST_TRANSFER_REQUEST_LENGTH,
  MAX_OPERATION_ID_LENGTH,
  MIN_OPERATION_ID_LENGTH,
  PLAYER_STATE_VERSION,
  applyChestTransfer,
  decideChestTransferCas,
  decideChestTransferReplay,
  validateChestTransferRequestJson,
  validatePlayerStateJson,
  type ChestTransferRequest,
} from "../shared/chestTransfers.ts";
import { CHEST_SLOT_COUNT } from "../shared/chests.ts";
import { INVENTORY_SIZE, createEmptyInventory, type Inventory, type ItemId } from "../shared/game.ts";

const legacyInventory = JSON.stringify([{ itemId: "stone", count: 12 }, null, { itemId: "wooden_pickaxe", count: 1 }]);
const legacy = validatePlayerStateJson(legacyInventory);
assert.equal(legacy.ok, true);
if (!legacy.ok) throw new Error("legacy player state should validate");
assert.equal(legacy.state.version, PLAYER_STATE_VERSION);
assert.equal(legacy.state.inventory.length, INVENTORY_SIZE);
assert.deepEqual(legacy.state.inventory.slice(0, 3), [
  { itemId: "stone", count: 12 },
  null,
  { itemId: "wooden_pickaxe", count: 1 },
]);
assert.equal(legacy.state.selectedHotbar, 0);
assert.equal(legacy.state.hunger, 20);

const currentState = validatePlayerStateJson(JSON.stringify({
  inventory: [{ itemId: "dirt", count: 4 }],
  selectedHotbar: 3,
  equipment: { head: "leather_helmet", chest: null, legs: null, feet: "leather_boots" },
  respawnPoint: { x: 1.5, y: 8, z: -2.5, yaw: 0.4, pitch: -0.1 },
  hunger: 13,
}));
assert.equal(currentState.ok, true);
if (!currentState.ok) throw new Error("current player state should validate");
assert.equal(currentState.state.version, 2);
assert.equal(currentState.state.selectedHotbar, 3);
assert.equal(currentState.state.equipment.head, "leather_helmet");
assert.equal(currentState.state.respawnPoint?.z, -2.5);
assert.equal(currentState.state.hunger, 13);
assert.deepEqual(validatePlayerStateJson(currentState.playerStateJson), currentState, "canonical state should be stable");

for (const [raw, reason] of [
  ["{", "invalid_json"],
  ["{}", "invalid_shape"],
  [JSON.stringify({ inventory: "not-an-array" }), "invalid_inventory"],
  [JSON.stringify({ inventory: [{ itemId: "obsidian", count: 1 }] }), "invalid_inventory"],
  [JSON.stringify({ inventory: [{ itemId: "stone", count: 65 }] }), "invalid_inventory"],
  [JSON.stringify({ inventory: [], selectedHotbar: 9 }), "invalid_selected_hotbar"],
  [JSON.stringify({ inventory: [], equipment: { head: "stone", chest: null, legs: null, feet: null } }), "invalid_equipment"],
  [JSON.stringify({ inventory: [], respawnPoint: { x: 1, y: 8, z: 1, yaw: 0, pitch: 9 } }), "invalid_respawn_point"],
  [JSON.stringify({ inventory: [], hunger: -1 }), "invalid_hunger"],
  [JSON.stringify({ version: 99, inventory: [] }), "invalid_version"],
  [JSON.stringify({ inventory: [], injected: true }), "invalid_shape"],
] as const) {
  assert.deepEqual(validatePlayerStateJson(raw), { ok: false, reason }, raw);
}

const operationId = "transfer_12345678";
assert.equal(operationId.length >= MIN_OPERATION_ID_LENGTH, true);
const request: ChestTransferRequest = {
  operationId,
  coordKey: "01:8:-02",
  direction: "to_chest",
  sourceSlot: 0,
  count: 7,
  expectedChestUpdatedAt: "chest-token",
  expectedInventoryUpdatedAt: "inventory-token",
  playerStateJson: legacyInventory,
};
const validatedRequest = validateChestTransferRequestJson(JSON.stringify(request));
assert.equal(validatedRequest.ok, true);
if (!validatedRequest.ok) throw new Error("request should validate");
assert.equal(validatedRequest.request.coordKey, "1:8:-2");
assert.equal(validatedRequest.request.canonicalPlayerStateJson, legacy.playerStateJson);
assert.ok(validatedRequest.request.fingerprint.includes(operationId));
const equivalentRequest = validateChestTransferRequestJson(JSON.stringify({
  ...request,
  coordKey: "1:8:-2",
  playerStateJson: legacy.playerStateJson,
}));
assert.equal(equivalentRequest.ok, true);
if (equivalentRequest.ok) assert.equal(equivalentRequest.request.fingerprint, validatedRequest.request.fingerprint);

for (const [change, reason] of [
  [{ operationId: "short" }, "invalid_operation_id"],
  [{ operationId: "x".repeat(MAX_OPERATION_ID_LENGTH + 1) }, "invalid_operation_id"],
  [{ operationId: "invalid operation id" }, "invalid_operation_id"],
  [{ coordKey: "65:1:1" }, "invalid_coordinate"],
  [{ direction: "sideways" }, "invalid_direction"],
  [{ sourceSlot: CHEST_SLOT_COUNT }, "invalid_source_slot"],
  [{ count: 0 }, "invalid_count"],
  [{ expectedChestUpdatedAt: "x".repeat(129) }, "invalid_token"],
  [{ playerStateJson: "{}" }, "invalid_player_state"],
] as const) {
  const result = validateChestTransferRequestJson(JSON.stringify({ ...request, ...change }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, reason);
}
assert.deepEqual(
  validateChestTransferRequestJson(" ".repeat(MAX_CHEST_TRANSFER_REQUEST_LENGTH + 1)),
  { ok: false, reason: "too_large" },
);

assert.equal(decideChestTransferCas(null, null, "", ""), "apply");
assert.equal(decideChestTransferCas("inv", "chest", "inv", "chest"), "apply");
assert.equal(decideChestTransferCas("new-inv", "chest", "old-inv", "chest"), "inventory_conflict");
assert.equal(decideChestTransferCas("inv", "new-chest", "inv", "old-chest"), "chest_conflict");
assert.equal(decideChestTransferCas("new-inv", "new-chest", "old-inv", "old-chest"), "both_conflict");
assert.equal(decideChestTransferReplay(null, "fingerprint"), "new");
assert.equal(decideChestTransferReplay("fingerprint", "fingerprint"), "replay");
assert.equal(decideChestTransferReplay("first", "different"), "operation_id_reused");

function totals(...inventories: readonly Inventory[]): Map<ItemId, number> {
  const result = new Map<ItemId, number>();
  for (const inventory of inventories) {
    for (const stack of inventory) if (stack) result.set(stack.itemId, (result.get(stack.itemId) ?? 0) + stack.count);
  }
  return result;
}

const player = createEmptyInventory();
player[0] = { itemId: "stone", count: 10 };
player[5] = { itemId: "stone", count: 20 };
const chest = createEmptyInventory(CHEST_SLOT_COUNT);
const deposited = applyChestTransfer({ direction: "to_chest", sourceSlot: 0, count: 4 }, player, chest);
assert.equal(deposited.ok, true);
if (!deposited.ok) throw new Error("deposit should apply");
assert.deepEqual(deposited.playerInventory[0], { itemId: "stone", count: 6 });
assert.deepEqual(deposited.playerInventory[5], { itemId: "stone", count: 20 }, "only the selected source slot may shrink");
assert.deepEqual(deposited.chestInventory[0], { itemId: "stone", count: 4 });
assert.deepEqual(deposited.moved, { itemId: "stone", count: 4 });
assert.deepEqual(totals(deposited.playerInventory, deposited.chestInventory), totals(player, chest));

const nearlyFullChest = createEmptyInventory(CHEST_SLOT_COUNT);
nearlyFullChest[0] = { itemId: "stone", count: 63 };
for (let index = 1; index < nearlyFullChest.length; index += 1) nearlyFullChest[index] = { itemId: "dirt", count: 64 };
const capacityBounded = applyChestTransfer({ direction: "to_chest", sourceSlot: 0, count: 8 }, player, nearlyFullChest);
assert.equal(capacityBounded.ok, true);
if (capacityBounded.ok) {
  assert.equal(capacityBounded.moved.count, 1);
  assert.deepEqual(capacityBounded.playerInventory[0], { itemId: "stone", count: 9 });
  assert.deepEqual(capacityBounded.chestInventory[0], { itemId: "stone", count: 64 });
  assert.deepEqual(totals(capacityBounded.playerInventory, capacityBounded.chestInventory), totals(player, nearlyFullChest));
}

const withdrawn = applyChestTransfer({ direction: "from_chest", sourceSlot: 0, count: 3 }, deposited.playerInventory, deposited.chestInventory);
assert.equal(withdrawn.ok, true);
if (withdrawn.ok) {
  assert.deepEqual(withdrawn.chestInventory[0], { itemId: "stone", count: 1 });
  assert.deepEqual(totals(withdrawn.playerInventory, withdrawn.chestInventory), totals(deposited.playerInventory, deposited.chestInventory));
}
assert.deepEqual(
  applyChestTransfer({ direction: "from_chest", sourceSlot: 4, count: 1 }, player, chest),
  { ok: false, reason: "empty_source" },
);
const fullChest = createEmptyInventory(CHEST_SLOT_COUNT);
for (let index = 0; index < fullChest.length; index += 1) fullChest[index] = { itemId: "dirt", count: 64 };
assert.deepEqual(
  applyChestTransfer({ direction: "to_chest", sourceSlot: 0, count: 1 }, player, fullChest),
  { ok: false, reason: "no_capacity" },
);

console.log("lakecraft atomic chest transfer model tests: ok");
