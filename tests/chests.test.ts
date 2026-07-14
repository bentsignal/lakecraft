import assert from "node:assert/strict";
import {
  CHEST_SLOT_COUNT,
  MAX_CHEST_JSON_LENGTH,
  MAX_CHEST_TOKEN_LENGTH,
  decideChestWrite,
  normalizeChestToken,
  validateChestCoordinate,
  validateChestInventoryJson,
} from "../shared/chests.ts";

assert.deepEqual(validateChestCoordinate("12:7:-9"), { ok: true, coordKey: "12:7:-9", x: 12, y: 7, z: -9 });
assert.deepEqual(validateChestCoordinate(" 001:02:-003 "), { ok: true, coordKey: "1:2:-3", x: 1, y: 2, z: -3 });
for (const invalid of ["", "1:2", "1:2:3:4", "1.5:2:3", "65:2:3", "1:65:3", "1:2:-65", "abc:2:3"]) {
  assert.deepEqual(validateChestCoordinate(invalid), { ok: false, reason: "invalid_coordinate" }, invalid);
}

const empty = validateChestInventoryJson("[]");
assert.equal(empty.ok, true);
if (empty.ok) {
  assert.equal(empty.inventory.length, CHEST_SLOT_COUNT);
  assert.ok(empty.inventory.every((slot) => slot === null));
  assert.equal(JSON.parse(empty.inventoryJson).length, CHEST_SLOT_COUNT);
}

const validJson = JSON.stringify([
  { itemId: "stone", count: 64 },
  null,
  { itemId: "wooden_pickaxe", count: 1 },
  { itemId: "leather", count: 12 },
]);
const valid = validateChestInventoryJson(validJson);
assert.equal(valid.ok, true);
if (valid.ok) {
  assert.deepEqual(valid.inventory.slice(0, 4), [
    { itemId: "stone", count: 64 },
    null,
    { itemId: "wooden_pickaxe", count: 1 },
    { itemId: "leather", count: 12 },
  ]);
  assert.deepEqual(validateChestInventoryJson(valid.inventoryJson), valid, "canonical chest JSON should validate deterministically");
}

assert.deepEqual(validateChestInventoryJson("{"), { ok: false, reason: "invalid_json" });
assert.deepEqual(validateChestInventoryJson("{}"), { ok: false, reason: "invalid_shape" });
assert.deepEqual(
  validateChestInventoryJson(JSON.stringify(new Array(CHEST_SLOT_COUNT + 1).fill(null))),
  { ok: false, reason: "too_many_slots" },
);
for (const invalidSlot of [
  [{ itemId: "diamond", count: 1 }],
  [{ itemId: "toString", count: 1 }],
  [{ itemId: "stone", count: 0 }],
  [{ itemId: "stone", count: 65 }],
  [{ itemId: "stone", count: 1.5 }],
  [{ itemId: "wooden_pickaxe", count: 2 }],
  [{ itemId: "stone", count: 1, injected: true }],
  ["stone"],
]) {
  assert.deepEqual(validateChestInventoryJson(JSON.stringify(invalidSlot)), { ok: false, reason: "invalid_slot" });
}
assert.deepEqual(
  validateChestInventoryJson(`[]${" ".repeat(MAX_CHEST_JSON_LENGTH)}`),
  { ok: false, reason: "too_large" },
);

assert.equal(normalizeChestToken(" token-123 "), "token-123");
assert.equal(normalizeChestToken(""), "");
assert.equal(normalizeChestToken("x".repeat(MAX_CHEST_TOKEN_LENGTH + 1)), null);
assert.equal(decideChestWrite(null, ""), "create");
assert.equal(decideChestWrite(null, "stale-token"), "conflict");
assert.equal(decideChestWrite("current-token", "current-token"), "update");
assert.equal(decideChestWrite("current-token", ""), "conflict");
assert.equal(decideChestWrite("current-token", "stale-token"), "conflict");

console.log("lakecraft shared chest validation tests: ok");
