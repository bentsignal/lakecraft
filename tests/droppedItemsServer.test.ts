import assert from "node:assert/strict";
import {
  DROPPED_ITEM_EXPIRY_PRUNE_LIMIT,
  MAX_DROPPED_ITEM_RECEIPTS_PER_USER,
  authoritativeDroppedItemPosition,
  buildDroppedItemRow,
  canCreateDroppedItem,
  compareDroppedItemStoredPlayerState,
  decideDroppedItemInventoryCas,
  decideDroppedItemReplay,
  decodeDroppedItemReceipt,
  encodeDroppedItemReceipt,
  selectDroppedItemReceiptOverflow,
  selectExpiredDroppedItemIds,
  type DroppedItemReceiptResult,
} from "../server/droppedItems.ts";
import { DROPPED_ITEM_TTL_MS, createPersistedDroppedItem } from "../shared/droppedItems.ts";
import { validatePlayerStateJson } from "../shared/chestTransfers.ts";
import { createSerializablePlayerState } from "../shared/game.ts";

const now = 1_000_000;
const presence = {
  userId: "user-a",
  online: true,
  heartbeatAt: String(now - 100),
  x: "2.5",
  y: "8",
  z: "-4.25",
};
assert.deepEqual(authoritativeDroppedItemPosition(presence, "user-a", now), { x: 2.5, y: 8, z: -4.25 });
assert.equal(authoritativeDroppedItemPosition({ ...presence, userId: "user-b" }, "user-a", now), null);
assert.equal(authoritativeDroppedItemPosition({ ...presence, online: false }, "user-a", now), null);
assert.equal(authoritativeDroppedItemPosition({ ...presence, heartbeatAt: String(now - 10_001) }, "user-a", now), null);
assert.equal(authoritativeDroppedItemPosition({ ...presence, x: "1000001" }, "user-a", now), null);

const spawned = buildDroppedItemRow("user-a", "drop_operation_1234", { itemId: "dirt", count: 1 }, { x: 2.5, y: 8, z: -4.25 }, 0, now);
assert.ok(spawned);
if (!spawned) throw new Error("spawn should build");
assert.equal(Number(spawned.x), 2.5);
assert.equal(Number(spawned.y), 9.1);
assert.equal(Number(spawned.z), -5.05);
assert.equal(buildDroppedItemRow("user-a", "drop_operation_1234", { itemId: "dirt", count: 1 }, { x: 2.5, y: 8, z: -4.25 }, NaN, now), null);
assert.equal(buildDroppedItemRow("user-a", "drop_operation_1234", { itemId: "dirt", count: 1 }, { x: 2.5, y: 8, z: -4.25 }, 100_001, now), null);

assert.equal(decideDroppedItemReplay(null, "fp"), "new");
assert.equal(decideDroppedItemReplay("fp", "fp"), "replay");
assert.equal(decideDroppedItemReplay("first", "second"), "operation_id_reused");
assert.equal(decideDroppedItemInventoryCas(null, ""), "apply");
assert.equal(decideDroppedItemInventoryCas("token", "token"), "apply");
assert.equal(decideDroppedItemInventoryCas("new", "old"), "conflict");

const canonical = JSON.stringify(createSerializablePlayerState([{ itemId: "dirt", count: 1 }]));
const canonicalValidation = validatePlayerStateJson(canonical);
assert.equal(canonicalValidation.ok, true);
if (!canonicalValidation.ok) throw new Error("state should validate");
assert.equal(compareDroppedItemStoredPlayerState(canonical, canonicalValidation.playerStateJson), "match");
assert.equal(compareDroppedItemStoredPlayerState(canonical, JSON.stringify(createSerializablePlayerState([{ itemId: "diamond" as never, count: 64 }]))), "mismatch");
assert.equal(compareDroppedItemStoredPlayerState("not json", canonical), "invalid");

const receipt: DroppedItemReceiptResult = {
  ok: true,
  replayed: false,
  operation: "drop",
  dropId: spawned.dropId,
  moved: { itemId: "dirt", count: 1 },
  inventory: { id: "inventory-row" },
  droppedItem: { id: "drop-row" },
};
assert.deepEqual(decodeDroppedItemReceipt(encodeDroppedItemReceipt(receipt)), { ...receipt, replayed: true });
assert.equal(decodeDroppedItemReceipt("{}"), null);
assert.equal(decodeDroppedItemReceipt(JSON.stringify({ ...receipt, replayed: true })), null);

const receipts = Array.from({ length: MAX_DROPPED_ITEM_RECEIPTS_PER_USER + 5 }, (_, index) => ({ id: `receipt-${index}` }));
assert.deepEqual(
  selectDroppedItemReceiptOverflow(receipts, "receipt-0"),
  receipts.slice(MAX_DROPPED_ITEM_RECEIPTS_PER_USER).map(({ id }) => id),
);
assert.equal(canCreateDroppedItem(0), true);
assert.equal(canCreateDroppedItem(63), true);
assert.equal(canCreateDroppedItem(64), false);
assert.equal(canCreateDroppedItem(-1), false);

const active = createPersistedDroppedItem("user-a", "drop_operation_1234", { itemId: "dirt", count: 1 }, { x: 0, y: 8, z: 0 }, now);
const expired = createPersistedDroppedItem("user-a", "drop_operation_5678", { itemId: "stone", count: 1 }, { x: 0, y: 8, z: 0 }, now - DROPPED_ITEM_TTL_MS);
assert.ok(active && expired);
const rows = [
  { id: "expired", ...expired! },
  { id: "corrupt", bad: true },
  { id: "active", ...active! },
];
assert.deepEqual(selectExpiredDroppedItemIds(rows, now), ["expired", "corrupt"]);
const manyCorrupt = Array.from({ length: DROPPED_ITEM_EXPIRY_PRUNE_LIMIT + 4 }, (_, index) => ({ id: `bad-${index}` }));
assert.equal(selectExpiredDroppedItemIds(manyCorrupt, now).length, DROPPED_ITEM_EXPIRY_PRUNE_LIMIT);

console.log("lakecraft dropped item server helper tests: ok");
