import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maintainUserReceipts } from "../server/receiptMaintenance.ts";
import { selectInventoryActionReceiptOverflow } from "../shared/inventoryActions.ts";
import { selectWorldBlockOperationReceiptOverflow } from "../server/worldBlockOperationReceipts.ts";

const calls: unknown[][] = [];
const newestRows = [{ id: "new-1" }, { id: "overflow" }];
const staleRows = [{ id: "stale" }];
let queryNumber = 0;
const table = {
  withIndex(index: string, range?: (query: any) => any) {
    calls.push(["withIndex", index]);
    const query = {
      eq(field: string, value: unknown) { calls.push(["eq", field, value]); return this; },
      lt(field: string, value: unknown) { calls.push(["lt", field, value]); return this; },
      gt() { return this; }, gte() { return this; }, lte() { return this; },
    };
    range?.(query);
    const current = queryNumber++;
    return {
      order(direction: "asc" | "desc") { calls.push(["order", direction]); return this; },
      async collect() { return []; }, async first() { return null; },
      async take(count: number) { calls.push(["take", count]); return current === 0 ? newestRows : staleRows; },
    };
  },
  async delete(id: string) { calls.push(["delete", id]); },
};
await maintainUserReceipts(table, "user", "committed", 20_000, 32, 8, 15_000, (rows, committed) => {
  calls.push(["select", rows.map((row) => row.id), committed]);
  return ["overflow"];
});
assert.deepEqual(calls, [
  ["withIndex", "by_user_created"], ["eq", "userId", "user"], ["order", "desc"], ["take", 40],
  ["select", ["new-1", "overflow"], "committed"], ["delete", "overflow"],
  ["withIndex", "by_user_created"], ["eq", "userId", "user"], ["lt", "receiptCreatedAt", "5000"],
  ["order", "asc"], ["take", 8], ["delete", "stale"],
], "receipt helper preserves index/range/order/bounds, selector policy, and sequential deletion order");

const failure = new Error("selector failure");
await assert.rejects(
  maintainUserReceipts(table, "user", "committed", 1, 1, 1, 1, () => { throw failure; }),
  (error) => error === failure,
  "receipt helper preserves policy and database errors by identity",
);

const tiedRows = Array.from({ length: 80 }, (_, index) => ({ id: `r${index}` }));
assert.equal(selectInventoryActionReceiptOverflow(tiedRows, "r70")[0], "r63",
  "set-based policy reserves committed id inside its 64-receipt cap");
assert.equal(selectWorldBlockOperationReceiptOverflow(tiedRows, "r70")[0], "r64",
  "slice-based policy retains the newest 64 plus an out-of-window committed id");
for (const selector of [selectInventoryActionReceiptOverflow, selectWorldBlockOperationReceiptOverflow]) {
  assert.equal(selector(tiedRows, "r70").includes("r70"), false, "every policy retains the committed id");
}

const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8").replace(/\s+/g, " ");
const policies = [
  ["worldBlockOperationReceipts", "MAX_WORLD_BLOCK_OPERATION_RECEIPTS_PER_USER", "WORLD_BLOCK_OPERATION_RECEIPT_PRUNE_LIMIT", "WORLD_BLOCK_OPERATION_RECEIPT_TTL_MS", "selectWorldBlockOperationReceiptOverflow"],
  ["treeGrowthReceipts", "MAX_TREE_GROWTH_RECEIPTS_PER_USER", "TREE_GROWTH_RECEIPT_PRUNE_LIMIT", "TREE_GROWTH_RECEIPT_TTL_MS", "selectTreeGrowthReceiptOverflow"],
  ["droppedItemReceipts", "MAX_DROPPED_ITEM_RECEIPTS_PER_USER", "DROPPED_ITEM_RECEIPT_PRUNE_LIMIT", "DROPPED_ITEM_RECEIPT_TTL_MS", "selectDroppedItemReceiptOverflow"],
  ["playerCombatReceipts", "MAX_PLAYER_COMBAT_RECEIPTS_PER_USER", "PLAYER_COMBAT_RECEIPT_PRUNE_LIMIT", "PLAYER_COMBAT_RECEIPT_TTL_MS", "selectPlayerCombatReceiptOverflow"],
  ["inventoryActionReceipts", "MAX_INVENTORY_ACTION_RECEIPTS_PER_USER", "INVENTORY_ACTION_RECEIPT_PRUNE_LIMIT", "INVENTORY_ACTION_RECEIPT_TTL_MS", "selectInventoryActionReceiptOverflow"],
  ["rangedCombatReceipts", "MAX_RANGED_COMBAT_RECEIPTS_PER_USER", "RANGED_COMBAT_RECEIPT_PRUNE_LIMIT", "RANGED_COMBAT_RECEIPT_TTL_MS", "selectRangedCombatReceiptOverflow"],
];
assert.equal((serverSource.match(/\bmaintainUserReceipts\(/g) ?? []).length, policies.length,
  "only the six reviewed user-scoped receipt policies use the shared helper");
for (const [tableName, maximum, prune, ttl, selector] of policies) {
  assert.ok(serverSource.includes(
    `maintainUserReceipts(db.${tableName}, userId, committedReceiptId, now, ${maximum}, ${prune}, ${ttl}, ${selector})`,
  ), `${tableName} keeps its exact maximum, prune limit, TTL, and overflow policy`);
}

console.log("server receipt maintenance order, bounds, policy, and error parity: ok");
