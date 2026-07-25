import assert from "node:assert/strict";
import {
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  createEmptyInventory,
} from "../shared/game.ts";
import {
  PLAYER_STATE_VERSION,
  validatePlayerStateJson,
} from "../shared/chestTransfers.ts";

assert.equal(HOTBAR_SIZE, 9);
assert.equal(INVENTORY_SIZE, 36, "player storage is three 9-wide rows plus the hotbar");
assert.equal(createEmptyInventory().length, 36);

const legacyInventory = new Array(27).fill(null);
legacyInventory[26] = { itemId: "diamond", count: 3 };
const migrated = validatePlayerStateJson(JSON.stringify({
  version: PLAYER_STATE_VERSION,
  inventory: legacyInventory,
  selectedHotbar: 0,
  equipment: { head: null, chest: null, legs: null, feet: null },
  respawnPoint: null,
  hunger: 20,
}));
assert.equal(migrated.ok, true, "shorter canonical inventories migrate without a reset");
if (migrated.ok) {
  assert.equal(migrated.state.inventory.length, 36);
  assert.deepEqual(migrated.state.inventory[26], { itemId: "diamond", count: 3 });
  assert.equal(migrated.state.inventory[35], null);
}

console.log("lakecraft inventory capacity migration tests: ok");
