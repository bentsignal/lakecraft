import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newestByIndex, oldestByIndex, type IndexedTable, type OrderedIndexQuery } from "../server/queryOrder.ts";

const calls: unknown[][] = [];
const ordered: OrderedIndexQuery<{ id: string }> = {
  order(direction) { calls.push(["order", direction]); return this; },
  async collect() { return [{ id: "row" }]; },
  async first() { return { id: "row" }; },
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
assert.deepEqual(calls, [["withIndex", "by_user"], ["eq", "userId", "u1"], ["order", "asc"]]);

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
assert.equal((serverSource.match(/\bnewestByIndex\(/g) ?? []).length, 154, "reviewed descending helper live set changed");
assert.equal((serverSource.match(/\boldestByIndex\(/g) ?? []).length, 13, "reviewed ascending helper live set changed");
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
assert.equal((serverSource.match(/\.order\("desc"\)/g) ?? []).length, 13, "only reviewed complex descending chains remain direct");
assert.equal((serverSource.match(/\.order\("asc"\)/g) ?? []).length, 5, "only reviewed complex ascending chains remain direct");
assert.equal((serverSource.match(/\.first\(\)/g) ?? []).length, 57, "first terminals are untouched");
assert.equal((serverSource.match(/\.take\(2\)/g) ?? []).length, 92, "take(2) terminals are untouched");
assert.equal((serverSource.match(/\.take\(/g) ?? []).length, 127, "non-receipt take terminals are untouched");
assert.equal((serverSource.match(/\.collect\(\)/g) ?? []).length, 1, "collect terminals are untouched");
assert.doesNotMatch(
  serverSource,
  /\b(?:ctx\.db|db)\.[A-Za-z0-9_]+\s*\.withIndex\([^\n]+\)\s*\.order\("desc"\)/,
  "simple descending chains must stay routed through the typed helper",
);

console.log("server descending index helper structural and error parity: ok");
