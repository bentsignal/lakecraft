import assert from "node:assert/strict";
import { planOakTreeGrowth } from "../shared/treeGrowth.ts";
import { worldEditChunkKey } from "../shared/worldChunks.ts";
import {
  MAX_TREE_GROWTH_RECEIPTS_PER_USER,
  decodeTreeGrowthReceipt,
  encodeTreeGrowthReceipt,
  isValidTreeGrowthOperationId,
  selectTreeGrowthReceiptOverflow,
  treeGrowthFingerprint,
  treeGrowthProtocolEdit,
  type TreeGrowthReceiptResult,
} from "../server/treeGrowthReceipts.ts";

const x = 7;
const y = 10;
const z = -3;
const growth = planOakTreeGrowth({
  x,
  y,
  z,
  blockAt: (sampleX, sampleY, sampleZ) => {
    if (sampleX === x && sampleY === y && sampleZ === z) return "sapling";
    if (sampleX === x && sampleY === y - 1 && sampleZ === z) return "grass";
    return "air";
  },
});
assert.equal(growth.ok, true);
if (!growth.ok) throw new Error("oak receipt fixture must plan");
const result: TreeGrowthReceiptResult = {
  ok: true,
  replayed: false,
  operationId: "tree_growth_receipt_001",
  x,
  y,
  z,
  consumed: "bone_meal",
  inventoryRevision: "9",
  edits: growth.edits.map(treeGrowthProtocolEdit),
  chunks: [...new Set(growth.edits.map((edit) => worldEditChunkKey(edit.x, edit.z)))]
    .map((chunkKey) => ({ chunkKey, revision: "12" })),
  serverNow: 1_750_000_000_000,
};
const encoded = encodeTreeGrowthReceipt(result);
assert.deepEqual(decodeTreeGrowthReceipt(encoded), result, "valid bounded receipts preserve every committed edit/revision");
assert.ok(result.edits.some((edit) => edit.blockType === "wood"), "planner log identity is adapted to the protocol's stable wood identity");
assert.equal(result.edits.some((edit) => edit.blockType === "log" as never), false);

assert.equal(isValidTreeGrowthOperationId(result.operationId), true);
for (const invalid of ["short", "spaces are invalid 001", "x".repeat(65), null]) {
  assert.equal(isValidTreeGrowthOperationId(invalid), false);
}
assert.equal(treeGrowthFingerprint(result.operationId, x, y, z), treeGrowthFingerprint(result.operationId, x, y, z));
assert.notEqual(treeGrowthFingerprint(result.operationId, x, y, z), treeGrowthFingerprint(result.operationId, x + 1, y, z));

for (const corrupted of [
  "{}",
  JSON.stringify({ ...result, replayed: true }),
  JSON.stringify({ ...result, consumed: "bone" }),
  JSON.stringify({ ...result, edits: [] }),
  JSON.stringify({ ...result, chunks: [] }),
  JSON.stringify({ ...result, edits: [{ ...result.edits[0], blockType: "admin_block" }] }),
  JSON.stringify({ ...result, edits: [result.edits[0], result.edits[0]] }),
  JSON.stringify({ ...result, chunks: [result.chunks[0], result.chunks[0]] }),
]) assert.equal(decodeTreeGrowthReceipt(corrupted), null, "corrupt server receipt must fail closed");

const rows = Array.from({ length: MAX_TREE_GROWTH_RECEIPTS_PER_USER + 8 }, (_, index) => ({ id: `r${index}` }));
const overflow = selectTreeGrowthReceiptOverflow(rows, "committed");
assert.equal(overflow.length, 8);
assert.equal(overflow.includes("committed"), false);
assert.deepEqual(selectTreeGrowthReceiptOverflow(rows, "r40").includes("r40"), false, "just-committed receipt is retained across timestamp ties");

console.log("bounded exact-replay tree-growth receipt tests passed");
