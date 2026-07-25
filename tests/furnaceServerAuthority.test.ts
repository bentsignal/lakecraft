import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_FURNACE_TRANSFER_RECEIPTS_PER_USER,
  decideFurnaceReceiptReplay,
  decideFurnaceTransferCas,
  decodeFurnaceReceipt,
  encodeFurnaceReceipt,
  selectFurnaceReceiptOverflow,
  validateFurnaceTransferRequestJson,
} from "../server/furnaceReceipts.ts";

const operationId = "furnace_op_0123456789";
const request = {
  operationId,
  coordKey: "120:7:-900",
  action: { kind: "deposit_input", inventorySlot: 4, count: 12 },
  expectedInventoryUpdatedAt: "inventory-token-a",
  expectedFurnaceRevision: "7",
  expectedBlockInstanceToken: "world-row-a:updated-a",
};
const validated = validateFurnaceTransferRequestJson(JSON.stringify(request));
assert.ok(validated);
assert.deepEqual(validated?.action, request.action);
const refreshed = validateFurnaceTransferRequestJson(JSON.stringify({
  ...request,
  expectedInventoryUpdatedAt: "inventory-token-b",
  expectedFurnaceRevision: "8",
}));
assert.equal(refreshed?.fingerprint, validated?.fingerprint,
  "CAS refreshes do not change one semantic operation's receipt identity");
const replacement = validateFurnaceTransferRequestJson(JSON.stringify({
  ...request,
  expectedBlockInstanceToken: "world-row-a:updated-b",
}));
assert.notEqual(replacement?.fingerprint, validated?.fingerprint,
  "a replacement block is a different semantic furnace operation");
assert.equal(decideFurnaceReceiptReplay(null, validated!.fingerprint), "new");
assert.equal(decideFurnaceReceiptReplay(validated!.fingerprint, validated!.fingerprint), "replay");
assert.equal(decideFurnaceReceiptReplay(validated!.fingerprint, `${validated!.fingerprint}x`), "operation_id_reused");

for (const invalid of [
  { ...request, coordKey: "1000001:7:0" },
  { ...request, operationId: "short" },
  { ...request, action: { kind: "deposit_input", inventorySlot: 36, count: 1 } },
  { ...request, action: { kind: "deposit_fuel", inventorySlot: 0, count: 65 } },
  { ...request, action: { kind: "take_output", count: 0 } },
  { ...request, expectedFurnaceRevision: "-1" },
  { ...request, expectedBlockInstanceToken: "" },
  { ...request, extra: true },
]) assert.equal(validateFurnaceTransferRequestJson(JSON.stringify(invalid)), null, JSON.stringify(invalid));

const receiptResult = {
  ok: true,
  replayed: false,
  moved: { direction: "to_furnace", itemId: "raw_iron", count: 3 },
  player: { id: "player-row" },
  furnace: { revision: "8" },
  serverNow: 1_700_000_000_000,
};
assert.deepEqual(decodeFurnaceReceipt(encodeFurnaceReceipt(receiptResult)), receiptResult);
assert.equal(decodeFurnaceReceipt("{}"), null);

const rows = Array.from({ length: MAX_FURNACE_TRANSFER_RECEIPTS_PER_USER + 8 }, (_, index) => ({ id: `r${index}` }));
const overflow = selectFurnaceReceiptOverflow(rows, "r20");
assert.ok(overflow.length <= 8);
assert.equal(overflow.includes("r20"), false);

for (let scenario = 0; scenario < 1_000; scenario += 1) {
  const fingerprint = JSON.stringify([1, `${scenario}:7:0`, `block-${scenario}:time-1`, { kind: "take_output", count: 1 }]);
  assert.equal(decideFurnaceReceiptReplay(null, fingerprint), "new");
  assert.equal(decideFurnaceReceiptReplay(fingerprint, fingerprint), "replay");
  assert.equal(decideFurnaceReceiptReplay(fingerprint, `${fingerprint}:${scenario}`), "operation_id_reused");
}

const originalAuthority = {
  inventoryUpdatedAt: "inventory-1",
  furnaceRevision: "0",
  blockInstanceToken: "world-row:placement-1",
};
assert.equal(decideFurnaceTransferCas(originalAuthority, originalAuthority), "apply");
assert.equal(decideFurnaceTransferCas({
  ...originalAuthority,
  blockInstanceToken: "world-row:placement-2",
}, originalAuthority), "conflict", "revision-zero replacement ABA must fail closed");

// Model two transactions that read the same revision. Lakebed serializes mutation
// commits, so the winner advances the row before the second contender rechecks.
for (let scenario = 0; scenario < 1_000; scenario += 1) {
  const expected = {
    inventoryUpdatedAt: `inventory-${scenario}`,
    furnaceRevision: String(scenario),
    blockInstanceToken: `world-${scenario}:placement-1`,
  };
  assert.equal(decideFurnaceTransferCas(expected, expected), "apply", `winner ${scenario}`);
  const committed = {
    ...expected,
    inventoryUpdatedAt: `inventory-${scenario}-committed`,
    furnaceRevision: String(scenario + 1),
  };
  assert.equal(decideFurnaceTransferCas(committed, expected), "conflict", `loser ${scenario}`);
}

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
for (const marker of [
  "furnaces: table({",
  "furnaceTransferReceipts: table({",
  "furnaceAt: query(async",
  "operateFurnace: mutation(async",
  "furnaceWithinReach(",
  'worldRows[0].blockType !== "furnace"',
  "blockInstanceToken",
  "expectedBlockInstanceToken",
  "decideFurnaceTransferCas(",
  "applyFurnaceTransfer(",
  "ctx.db.inventories.update",
  "ctx.db.furnaces.update",
  "ctx.db.furnaces.insert",
]) assert.ok(server.includes(marker), `missing furnace authority marker: ${marker}`);

const query = server.slice(server.indexOf("furnaceAt: query(async"), server.indexOf("myProfile: query", server.indexOf("furnaceAt: query(async")));
assert.equal(/\.(?:insert|update|delete)\(/.test(query), false, "wall-clock query materialization performs zero writes");
const mutation = server.slice(server.indexOf("operateFurnace: mutation(async"), server.indexOf("transferChest: mutation(async"));
assert.ok(mutation.indexOf("ctx.db.furnaceTransferReceipts") < mutation.indexOf("ctx.db.worldEdits"));
assert.ok(mutation.includes("replayInventoryRows"), "replays return current canonical player state");
assert.ok(mutation.includes("replayFurnaceRows"), "replays return current canonical furnace state");
assert.ok(mutation.indexOf("furnaceWithinReach") < mutation.indexOf("applyFurnaceTransfer"));
assert.ok(mutation.indexOf("applyFurnaceTransfer") < mutation.indexOf("ctx.db.inventories.update"));

const worldEditMutation = server.slice(server.indexOf("editWorldBlock: mutation"), server.indexOf("startPresenceSession: mutation"));
for (const marker of [
  'effect.previousBlock === "furnace"',
  "materializedFurnaceView(",
  'minedFurnaceRow.blockInstanceToken !== blockInstanceToken',
  'reason: "invalid_state"',
  "furnaceRecoveryDrops",
  "canCreateDroppedItem(activeOwnedDrops.length + index)",
  "ctx.db.droppedItems.insert",
  "ctx.db.furnaces.delete",
]) assert.ok(worldEditMutation.includes(marker), `missing mined-furnace recovery marker: ${marker}`);
assert.ok(worldEditMutation.indexOf("furnaceRecoveryDrops") < worldEditMutation.indexOf("ctx.db.worldEdits.update"),
  "recovery is validated before world mutation writes");

console.log("lakecraft furnace Lakebed authority tests: ok (1,000 receipt/replay cases)");
