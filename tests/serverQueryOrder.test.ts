import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  newestByIndex,
  newestMatchingRow,
  newestMatchingRows,
  newestUserRows,
  oldestByIndex,
  type IndexedTable,
  type OrderedIndexQuery,
} from "../server/queryOrder.ts";
import { newestUserOperationReceipt, userOperationReceiptRows } from "../server/receiptMaintenance.ts";

const calls: unknown[][] = [];
const ordered: OrderedIndexQuery<{ id: string }> = {
  order(direction) { calls.push(["order", direction]); return this; },
  async collect() { calls.push(["collect"]); return [{ id: "row" }]; },
  async first() { calls.push(["first"]); return { id: "row" }; },
  async take(count) { calls.push(["take", count]); return [{ id: "row" }]; },
};
const table: IndexedTable<{ id: string }> = {
  withIndex(index, range) {
    const query = {
      eq(field: string, value: unknown) { calls.push(["eq", field, value]); return this; },
      gt() { return this; }, gte() { return this; }, lt() { return this; }, lte() { return this; },
    };
    calls.push(["withIndex", index]);
    range?.(query);
    return ordered;
  },
};
const result = await newestByIndex(table, "by_user", (q) => q.eq("userId", "u1")).take(2);
assert.deepEqual(result, [{ id: "row" }]);
assert.deepEqual(calls, [
  ["withIndex", "by_user"], ["eq", "userId", "u1"], ["order", "desc"], ["take", 2],
], "helper preserves table/index/predicate/order/terminal sequence and values");

calls.length = 0;
await oldestByIndex(table, "by_user", (q) => q.eq("userId", "u1")).first();
assert.deepEqual(calls, [["withIndex", "by_user"], ["eq", "userId", "u1"], ["order", "asc"], ["first"]]);

calls.length = 0;
await newestMatchingRows(table, "by_coord", "coordKey", "1:2:3");
assert.deepEqual(calls, [
  ["withIndex", "by_coord"], ["eq", "coordKey", "1:2:3"], ["order", "desc"], ["take", 2],
], "duplicate-detecting singleton helper preserves the caller's index/range before descending take(2)");

calls.length = 0;
await newestMatchingRow(table, "by_drop", "dropId", "drop-1");
assert.deepEqual(calls, [
  ["withIndex", "by_drop"], ["eq", "dropId", "drop-1"], ["order", "desc"], ["first"],
], "latest-row helper preserves the caller's index/range before descending first()");

calls.length = 0;
await newestUserRows(table, "u2");
assert.deepEqual(calls, [
  ["withIndex", "by_user"], ["eq", "userId", "u2"], ["order", "desc"], ["take", 2],
], "user singleton helper stays pinned to by_user/userId and duplicate detection");

calls.length = 0;
await userOperationReceiptRows(table, "u3", "op-1");
assert.deepEqual(calls, [
  ["withIndex", "by_user_operation"], ["eq", "userId", "u3"], ["eq", "operationId", "op-1"],
  ["order", "desc"], ["take", 2],
], "receipt duplicate detection preserves its compound user/operation range and descending order");

calls.length = 0;
await newestUserOperationReceipt(table, "u4", "op-2");
assert.deepEqual(calls, [
  ["withIndex", "by_user_operation"], ["eq", "userId", "u4"], ["eq", "operationId", "op-2"],
  ["order", "desc"], ["first"],
], "receipt latest-row lookup preserves its compound user/operation range and descending order");

const failure = new Error("index failure");
assert.throws(
  () => newestByIndex({ withIndex() { throw failure; } }, "by_failure"),
  (error) => error === failure,
  "helper preserves database errors by identity",
);
assert.throws(
  () => oldestByIndex({ withIndex() { throw failure; } }, "by_failure"),
  (error) => error === failure,
  "ascending helper preserves database errors by identity",
);

const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const reviewedHelpers = [
  "newestByIndex",
  "oldestByIndex",
  "newestMatchingRows",
  "newestMatchingRow",
  "newestUserRows",
  "userOperationReceiptRows",
  "newestUserOperationReceipt",
] as const;

function helperCallSites(source: string, helper: string): string[] {
  const sites: string[] = [];
  const pattern = new RegExp(`\\b${helper}\\s*\\(`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const start = match.index;
    const open = source.indexOf("(", start);
    let depth = 0;
    let quote = "";
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let end = -1;
    for (let index = open; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (lineComment) {
        if (character === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (character === "*" && next === "/") { blockComment = false; index += 1; }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "/" && next === "/") { lineComment = true; index += 1; continue; }
      if (character === "/" && next === "*") { blockComment = true; index += 1; continue; }
      if (character === "\"" || character === "'" || character === "`") { quote = character; continue; }
      if (character === "(") depth += 1;
      else if (character === ")" && --depth === 0) { end = index + 1; break; }
    }
    assert.notEqual(end, -1, `${helper} call is syntactically closed`);
    let terminalEnd = end;
    const terminal = /^\s*\.\s*(?:first|take|collect)\s*\([^)]*\)/.exec(source.slice(end));
    if (terminal) terminalEnd += terminal[0].length;
    sites.push(source.slice(start, terminalEnd).replace(/\s+/g, " ").trim());
    pattern.lastIndex = end;
  }
  return sites;
}

const helperCalls = Object.fromEntries(reviewedHelpers.map((helper) => [helper, helperCallSites(serverSource, helper)]));
assert.deepEqual(
  Object.fromEntries(reviewedHelpers.map((helper) => [helper, helperCalls[helper].length])),
  {
    newestByIndex: 35,
    oldestByIndex: 14,
    newestMatchingRows: 39,
    newestMatchingRow: 51,
    newestUserRows: 44,
    userOperationReceiptRows: 6,
    newestUserOperationReceipt: 7,
  },
  "reviewed direct and delegated ordered-read helper live sets changed",
);
const orderedReadFingerprint = createHash("sha256").update(JSON.stringify(
  reviewedHelpers.flatMap((helper) => helperCalls[helper].map((call) => ({ helper, call }))),
)).digest("hex");
assert.equal(
  orderedReadFingerprint,
  "10f5eadf8dc9a2df96a239086221c28cb77215fb9ad2a82ce37524ce8bedf1ae",
  "ordered-read tables, indexes, ranges, bounds, or receipt routing changed",
);
assert.doesNotMatch(
  serverSource,
  /\b(?:const|let|var)\s+newestByIndex\s*=\s*[^;]*\bnewestByIndex\s*\(/,
  "helper calls must never be shadowed inside their own initializer",
);
assert.doesNotMatch(
  serverSource,
  /\b(?:const|let|var)\s+oldestByIndex\s*=\s*[^;]*\boldestByIndex\s*\(/,
  "ascending helper calls must never be shadowed inside their own initializer",
);
assert.equal((serverSource.match(/\.order\("desc"\)/g) ?? []).length, 0,
  "server call sites keep descending order centralized in the reviewed helpers");
assert.equal((serverSource.match(/\.order\("asc"\)/g) ?? []).length, 5, "only reviewed complex ascending chains remain direct");
const directFirstCalls = [...helperCalls.newestByIndex, ...helperCalls.oldestByIndex]
  .filter((call) => /\.\s*first\s*\(\s*\)$/.test(call));
assert.equal((serverSource.match(/\.\s*first\s*\(\s*\)/g) ?? []).length, directFirstCalls.length,
  "every direct first() singleton read stays routed through explicit newest/oldest ordering");
const directTakeTwoCalls = helperCalls.newestByIndex.filter((call) => /\.\s*take\s*\(\s*2\s*\)$/.test(call));
assert.equal((serverSource.match(/\.\s*take\s*\(\s*2\s*\)/g) ?? []).length, directTakeTwoCalls.length,
  "every direct take(2) singleton read stays routed through descending ordering");
const helperTakeCalls = [...helperCalls.newestByIndex, ...helperCalls.oldestByIndex]
  .filter((call) => /\.\s*take\s*\(/.test(call));
assert.equal((serverSource.match(/\.take\(/g) ?? []).length, helperTakeCalls.length + 5,
  "every bounded take stays routed through a reviewed newest/oldest helper or one of five explicit ascending prune chains");
assert.equal((serverSource.match(/\.collect\(\)/g) ?? []).length, 1, "collect terminals are untouched");
assert.doesNotMatch(
  serverSource,
  /\b(?:ctx\.db|db)\.[A-Za-z0-9_]+\s*\.withIndex\([^\n]+\)\s*\.order\("desc"\)/,
  "simple descending chains must stay routed through the typed helper",
);

console.log("server descending index helper structural and error parity: ok");
