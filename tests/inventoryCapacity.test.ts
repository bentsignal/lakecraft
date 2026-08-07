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

const currentInventory = createEmptyInventory();
currentInventory[26] = { itemId: "diamond", count: 3 };
const current = validatePlayerStateJson(JSON.stringify({
  version: PLAYER_STATE_VERSION,
  inventory: currentInventory,
  selectedHotbar: 0,
  equipment: { head: null, chest: null, legs: null, feet: null },
  respawnPoint: null,
  hunger: 20,
}));
assert.equal(current.ok, true);
if (current.ok) {
  assert.equal(current.state.inventory.length, 36);
  assert.deepEqual(current.state.inventory[26], { itemId: "diamond", count: 3 });
}
assert.equal(validatePlayerStateJson(JSON.stringify({ ...current.state, inventory: currentInventory.slice(0, 27) })).ok, false);

console.log("lakecraft current inventory capacity tests: ok");
