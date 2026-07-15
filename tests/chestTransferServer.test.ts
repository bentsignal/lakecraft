import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePlayerStateJson } from "../shared/chestTransfers.ts";
import {
  CHEST_RECEIPT_OVERFLOW_PRUNE_LIMIT,
  MAX_CHEST_TRANSFER_RECEIPTS_PER_USER,
  compareStoredPlayerState,
  decodeChestTransferReceipt,
  encodeChestTransferReceipt,
  selectChestTransferReceiptOverflow,
} from "../server/chestTransferReceipts.ts";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const transferMutation = server.slice(
  server.indexOf("transferChest: mutation"),
  server.indexOf("claimUsername: mutation"),
);
assert.ok(transferMutation.includes("playerRows.length !== 1"), "a chest transfer requires the server-owned initialized inventory row");
assert.ok(transferMutation.includes('reason: "inventory_required"'));
assert.equal(transferMutation.includes("ctx.db.inventories.insert"), false, "a forged client ledger can never bootstrap through a chest");

const stored = JSON.stringify([{ itemId: "stone", count: 4 }]);
const canonical = validatePlayerStateJson(stored);
assert.equal(canonical.ok, true);
if (!canonical.ok) throw new Error("fixture should validate");
assert.equal(compareStoredPlayerState(stored, canonical.playerStateJson), "match");

const fabricated = validatePlayerStateJson(JSON.stringify([{ itemId: "stone", count: 64 }]));
assert.equal(fabricated.ok, true);
if (!fabricated.ok) throw new Error("fixture should validate");
assert.equal(compareStoredPlayerState(stored, fabricated.playerStateJson), "mismatch");
assert.equal(compareStoredPlayerState("{", canonical.playerStateJson), "invalid");

const committed = {
  ok: true,
  replayed: false,
  moved: { itemId: "stone", count: 2 },
  player: { id: "p1", updatedAt: "player-post-transfer" },
  chest: { id: "c1", updatedAt: "chest-post-transfer" },
};
const receipt = encodeChestTransferReceipt(committed);
assert.deepEqual(decodeChestTransferReceipt(receipt), { ...committed, replayed: true });
assert.equal(decodeChestTransferReceipt("{"), null);
assert.equal(decodeChestTransferReceipt(JSON.stringify({ ...committed, ok: false })), null);

const withinCap = Array.from(
  { length: MAX_CHEST_TRANSFER_RECEIPTS_PER_USER },
  (_, index) => ({ id: `receipt-${index}` }),
);
assert.deepEqual(selectChestTransferReceiptOverflow(withinCap, "receipt-0"), []);

const overCap = Array.from(
  { length: MAX_CHEST_TRANSFER_RECEIPTS_PER_USER + CHEST_RECEIPT_OVERFLOW_PRUNE_LIMIT },
  (_, index) => ({ id: `receipt-${index}` }),
);
assert.deepEqual(
  selectChestTransferReceiptOverflow(overCap, "receipt-0"),
  overCap.slice(MAX_CHEST_TRANSFER_RECEIPTS_PER_USER).map((receipt) => receipt.id),
);

// Timestamp ties can place the committed row last; retain it and evict another
// old row so an immediate identical retry remains exactly replayable.
const committedLast = [...overCap.slice(0, -1), { id: "just-committed" }];
const committedLastOverflow = selectChestTransferReceiptOverflow(committedLast, "just-committed");
assert.equal(committedLastOverflow.includes("just-committed"), false);
assert.equal(committedLastOverflow.length, CHEST_RECEIPT_OVERFLOW_PRUNE_LIMIT);
assert.equal(
  committedLast.length - committedLastOverflow.length,
  MAX_CHEST_TRANSFER_RECEIPTS_PER_USER,
);

console.log("lakecraft atomic chest server receipt tests: ok");
