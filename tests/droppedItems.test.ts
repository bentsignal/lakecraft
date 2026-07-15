import assert from "node:assert/strict";
import {
  DROPPED_ITEM_OWNER_PICKUP_DELAY_MS,
  DROPPED_ITEM_PICKUP_RADIUS,
  DROPPED_ITEM_TTL_MS,
  MAX_DROPPED_ITEM_REQUEST_LENGTH,
  MAX_VISIBLE_DROPPED_ITEM_CHUNKS,
  applyDropItemToInventory,
  applyPickupDroppedItem,
  createDroppedItemId,
  createPersistedDroppedItem,
  droppedItemChunkKey,
  normalizeDroppedItemRow,
  validateDropItemRequestJson,
  validateDroppedItemPosition,
  validateDroppedItemStack,
  validateDroppedItemStackJson,
  validatePickupDroppedItemRequestJson,
  validateVisibleDroppedItemChunkKeys,
  type DropItemRequest,
  type PickupDroppedItemRequest,
} from "../shared/droppedItems.ts";
import { createEmptyInventory, createSerializablePlayerState, type ItemStack } from "../shared/game.ts";

const operationId = "drop_operation_1234";
const pickupOperationId = "pickup_operation_1";
const state = createSerializablePlayerState([{ itemId: "dirt", count: 12 }]);
const playerStateJson = JSON.stringify(state);

assert.deepEqual(validateDroppedItemStack({ itemId: "dirt", count: 12 }), { itemId: "dirt", count: 12 });
assert.deepEqual(
  validateDroppedItemStack({ itemId: "wooden_pickaxe", count: 1 }),
  { itemId: "wooden_pickaxe", count: 1, durability: 59 },
  "legacy tools canonicalize to full durability",
);
assert.deepEqual(
  validateDroppedItemStack({ itemId: "wooden_pickaxe", count: 1, durability: 17 }),
  { itemId: "wooden_pickaxe", count: 1, durability: 17 },
);
for (const invalid of [
  null,
  { itemId: "obsidian", count: 1 },
  { itemId: "dirt", count: 0 },
  { itemId: "dirt", count: 65 },
  { itemId: "dirt", count: 1, durability: 1 },
  { itemId: "wooden_pickaxe", count: 2 },
  { itemId: "wooden_pickaxe", count: 1, durability: 0 },
  { itemId: "wooden_pickaxe", count: 1, durability: 60 },
  { itemId: "wooden_pickaxe", count: 1, durability: 1.5 },
  { itemId: "dirt", count: 1, injected: true },
]) assert.equal(validateDroppedItemStack(invalid), null, JSON.stringify(invalid));
assert.equal(validateDroppedItemStackJson("{").ok, false);
assert.equal(validateDroppedItemStackJson(JSON.stringify({ itemId: "dirt", count: 1 })).ok, true);

assert.deepEqual(validateDroppedItemPosition({ x: -1_000_000, y: -64, z: 1_000_000 }), { x: -1_000_000, y: -64, z: 1_000_000 });
assert.equal(validateDroppedItemPosition({ x: 1_000_001, y: 2, z: 3 }), null);
assert.equal(validateDroppedItemPosition({ x: 1, y: Infinity, z: 3 }), null);
assert.equal(droppedItemChunkKey(-1, -17), "-1:-2");
assert.deepEqual(validateVisibleDroppedItemChunkKeys(["1:2", "-1:0", "1:2"]), { ok: true, chunkKeys: ["-1:0", "1:2"] });
assert.deepEqual(validateVisibleDroppedItemChunkKeys("1:2"), { ok: false, reason: "invalid_chunk_keys" });
assert.deepEqual(validateVisibleDroppedItemChunkKeys(["62501:0"]), { ok: false, reason: "invalid_chunk_keys" });
assert.deepEqual(
  validateVisibleDroppedItemChunkKeys(new Array(MAX_VISIBLE_DROPPED_ITEM_CHUNKS + 1).fill("0:0")),
  { ok: false, reason: "too_many_chunks" },
);
assert.equal(createDroppedItemId("user-a", operationId), createDroppedItemId("user-a", operationId));
assert.notEqual(createDroppedItemId("user-b", operationId), createDroppedItemId("user-a", operationId));
assert.match(createDroppedItemId("user-a", operationId), /^di_[a-z0-9]{14}$/);

const dropRequest: DropItemRequest = {
  operationId,
  sourceSlot: 0,
  count: 5,
  expectedInventoryUpdatedAt: "inventory-token",
  playerStateJson,
};
const validatedDrop = validateDropItemRequestJson(JSON.stringify(dropRequest));
assert.equal(validatedDrop.ok, true);
if (!validatedDrop.ok) throw new Error("drop request should validate");
assert.match(validatedDrop.request.fingerprint, /^\["drop"/);
const appliedDrop = applyDropItemToInventory(validatedDrop.request);
assert.equal(appliedDrop.ok, true);
if (!appliedDrop.ok) throw new Error("drop should apply");
assert.deepEqual(appliedDrop.dropped, { itemId: "dirt", count: 5 });
assert.deepEqual(appliedDrop.inventory[0], { itemId: "dirt", count: 7 });

for (const [change, reason] of [
  [{ operationId: "short" }, "invalid_operation_id"],
  [{ operationId: "bad operation id!!" }, "invalid_operation_id"],
  [{ sourceSlot: 27 }, "invalid_source_slot"],
  [{ count: 0 }, "invalid_count"],
  [{ expectedInventoryUpdatedAt: "x".repeat(129) }, "invalid_token"],
  [{ playerStateJson: "{}" }, "invalid_player_state"],
  [{ injectedItem: { itemId: "diamond", count: 64 } }, "invalid_shape"],
] as const) {
  const result = validateDropItemRequestJson(JSON.stringify({ ...dropRequest, ...change }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, reason);
}
assert.deepEqual(validateDropItemRequestJson(" ".repeat(MAX_DROPPED_ITEM_REQUEST_LENGTH + 1)), { ok: false, reason: "too_large" });

const now = 10_000;
const row = createPersistedDroppedItem("user-a", operationId, appliedDrop.dropped, { x: 1.25, y: 8, z: -2.5 }, now);
assert.ok(row);
assert.equal(createPersistedDroppedItem("user-a", "short", appliedDrop.dropped, { x: 1.25, y: 8, z: -2.5 }, now), null);
if (!row) throw new Error("row should build");
assert.equal(row.ownerPickupAt, String(now + DROPPED_ITEM_OWNER_PICKUP_DELAY_MS));
assert.equal(row.expiresAt, String(now + DROPPED_ITEM_TTL_MS));
const normalized = normalizeDroppedItemRow(row, now);
assert.ok(normalized);
if (!normalized) throw new Error("row should normalize");
assert.deepEqual(normalized.item, { itemId: "dirt", count: 5 });
assert.equal(normalizeDroppedItemRow(row, now + DROPPED_ITEM_TTL_MS), null, "expired drops stay out of renderer queries");
assert.ok(normalizeDroppedItemRow(row, now + DROPPED_ITEM_TTL_MS, true), "server cleanup can inspect expired rows");
assert.equal(normalizeDroppedItemRow({ ...row, x: "NaN" }, now), null);
assert.equal(normalizeDroppedItemRow({ ...row, x: null }, now), null);
assert.equal(normalizeDroppedItemRow({ ...row, chunkKey: "forged" }, now), null);
assert.equal(normalizeDroppedItemRow({ ...row, itemJson: JSON.stringify({ itemId: "dirt", count: 5, injected: 1 }) }, now), null);

const pickupRequest: PickupDroppedItemRequest = {
  operationId: pickupOperationId,
  dropId: normalized.dropId,
  expectedInventoryUpdatedAt: "inventory-token",
  playerStateJson: JSON.stringify(createSerializablePlayerState([])),
};
const validatedPickup = validatePickupDroppedItemRequestJson(JSON.stringify(pickupRequest));
assert.equal(validatedPickup.ok, true);
if (validatedPickup.ok) assert.match(validatedPickup.request.fingerprint, /^\["pickup"/);
for (const [change, reason] of [
  [{ operationId: "short" }, "invalid_operation_id"],
  [{ dropId: "not-a-drop" }, "invalid_drop_id"],
  [{ expectedInventoryUpdatedAt: "x".repeat(129) }, "invalid_token"],
  [{ playerStateJson: "{}" }, "invalid_player_state"],
  [{ x: 0 }, "invalid_shape"],
] as const) {
  const result = validatePickupDroppedItemRequestJson(JSON.stringify({ ...pickupRequest, ...change }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, reason);
}

const empty = createEmptyInventory();
assert.deepEqual(
  applyPickupDroppedItem(empty, normalized, "user-a", { x: normalized.x, y: normalized.y, z: normalized.z }, now + 499),
  { ok: false, reason: "owner_pickup_delay" },
);
assert.equal(
  applyPickupDroppedItem(empty, normalized, "user-b", { x: normalized.x, y: normalized.y, z: normalized.z }, now + 1).ok,
  true,
  "another player may immediately collect a shared drop",
);
assert.deepEqual(
  applyPickupDroppedItem(empty, normalized, "user-a", { x: normalized.x + DROPPED_ITEM_PICKUP_RADIUS + 0.01, y: normalized.y, z: normalized.z }, now + 500),
  { ok: false, reason: "too_far" },
);
assert.deepEqual(
  applyPickupDroppedItem(empty, normalized, "user-a", { x: normalized.x, y: normalized.y, z: normalized.z }, now + DROPPED_ITEM_TTL_MS),
  { ok: false, reason: "expired" },
);

const partialInventory = createEmptyInventory();
partialInventory[0] = { itemId: "dirt", count: 62 };
for (let index = 1; index < partialInventory.length; index += 1) partialInventory[index] = { itemId: "stone", count: 64 };
const partialPickup = applyPickupDroppedItem(partialInventory, normalized, "user-a", normalized, now + 500);
assert.equal(partialPickup.ok, true);
if (!partialPickup.ok) throw new Error("partial pickup should apply");
assert.deepEqual(partialPickup.inventory[0], { itemId: "dirt", count: 64 });
assert.deepEqual(partialPickup.picked, { itemId: "dirt", count: 2 });
assert.deepEqual(partialPickup.remaining, { itemId: "dirt", count: 3 });

const full = createEmptyInventory();
for (let index = 0; index < full.length; index += 1) full[index] = { itemId: "stone", count: 64 };
assert.deepEqual(applyPickupDroppedItem(full, normalized, "user-b", normalized, now + 1), { ok: false, reason: "no_capacity" });

const durableItem = { itemId: "wooden_pickaxe", count: 1, durability: 7 } as ItemStack;
const durableRow = createPersistedDroppedItem("user-a", operationId, durableItem, { x: 0, y: 8, z: 0 }, now);
assert.ok(durableRow);
const durableNormalized = durableRow && normalizeDroppedItemRow(durableRow, now);
assert.ok(durableNormalized);
if (durableNormalized) {
  const pickup = applyPickupDroppedItem(empty, durableNormalized, "user-b", durableNormalized, now + 1);
  assert.equal(pickup.ok, true);
  if (pickup.ok) assert.deepEqual(pickup.inventory[0], durableItem, "pickup preserves exact tool durability");
}

console.log("lakecraft dropped item model tests: ok");
