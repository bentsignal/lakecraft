import assert from "node:assert/strict";
import {
  MAX_HEALTH,
  MAX_HUNGER,
  addItem,
  consumeFood,
  createEmptyInventory,
  createSerializablePlayerState,
  createSurvivalTickState,
  normalizeHunger,
  parseSerializablePlayerStateJson,
  tickSurvival,
} from "../shared/game.ts";

assert.equal(normalizeHunger(-4), 0);
assert.equal(normalizeHunger(12.9), 12);
assert.equal(normalizeHunger(99), MAX_HUNGER);
assert.equal(normalizeHunger(Number.NaN), MAX_HUNGER);
assert.equal(normalizeHunger("12"), MAX_HUNGER);

const legacyObject = parseSerializablePlayerStateJson(JSON.stringify({
  inventory: [{ itemId: "dirt", count: 2 }],
  selectedHotbar: 0,
  equipment: {},
  respawnPoint: null,
}));
assert.equal(legacyObject?.hunger, MAX_HUNGER, "saved objects from before hunger default to full");
const legacyInventory = parseSerializablePlayerStateJson(JSON.stringify([{ itemId: "dirt", count: 2 }]));
assert.equal(legacyInventory?.hunger, MAX_HUNGER, "legacy inventory arrays also default to full");
assert.equal(createSerializablePlayerState(undefined, 0, undefined, null, -8).hunger, 0);
assert.equal(createSerializablePlayerState(undefined, 0, undefined, null, 80).hunger, MAX_HUNGER);

let foodInventory = createEmptyInventory();
foodInventory[0] = { itemId: "pork", count: 2 };
foodInventory[4] = { itemId: "pork", count: 5 };
const atePork = consumeFood(foodInventory, 0, 18);
assert.equal(atePork.ok, true);
assert.equal(atePork.hunger, 20);
if (atePork.ok) {
  assert.equal(atePork.restored, 2, "food restoration is capped at maximum hunger");
  assert.equal(atePork.consumed, "pork");
}
assert.deepEqual(atePork.inventory[0], { itemId: "pork", count: 1 }, "exactly one item leaves the selected stack");
assert.deepEqual(atePork.inventory[4], { itemId: "pork", count: 5 }, "other matching stacks remain untouched");
assert.deepEqual(foodInventory[0], { itemId: "pork", count: 2 }, "consumption does not mutate caller inventory");

const lastMutton = addItem(createEmptyInventory(), "mutton", 1).inventory;
const ateLastMutton = consumeFood(lastMutton, 0, 10);
assert.equal(ateLastMutton.ok, true);
assert.equal(ateLastMutton.inventory[0], null);
assert.equal(ateLastMutton.hunger, 13);

const fullHunger = consumeFood(foodInventory, 0, MAX_HUNGER);
assert.equal(fullHunger.ok, false);
assert.equal(fullHunger.reason, "hunger_full");
assert.deepEqual(fullHunger.inventory, foodInventory);
const notFood = consumeFood(addItem(createEmptyInventory(), "stone", 1).inventory, 0, 5);
assert.equal(notFood.ok, false);
assert.equal(notFood.reason, "not_food");
assert.equal(consumeFood(foodInventory, 99, 5).reason, "invalid_slot");
assert.equal(consumeFood(createEmptyInventory(), 0, 5).reason, "empty_slot");

const newSurvivor = createSurvivalTickState();
assert.deepEqual(newSurvivor, {
  hunger: MAX_HUNGER,
  health: MAX_HEALTH,
  hungerProgressSeconds: 0,
  recoveryProgressSeconds: 0,
  starvationProgressSeconds: 0,
});

const drained = tickSurvival({
  ...newSurvivor,
  hungerProgressSeconds: 44,
}, 1);
assert.equal(drained.state.hunger, 19);
assert.equal(drained.state.hungerProgressSeconds, 0);
assert.equal(drained.hungerLost, 1);

const bounded = tickSurvival({
  ...newSurvivor,
  hungerProgressSeconds: 44,
}, 100, 100);
assert.equal(bounded.state.hunger, 19, "large delayed frames cannot cause unbounded hunger loss");
assert.equal(bounded.state.hungerProgressSeconds, 19);

const recovered = tickSurvival({
  ...createSurvivalTickState(20, 18),
  recoveryProgressSeconds: 3,
}, 1, 0);
assert.equal(recovered.state.health, 19);
assert.equal(recovered.state.hunger, 19);
assert.equal(recovered.healthRecovered, 1);
assert.equal(recovered.hungerLost, 1);
assert.equal(recovered.starvationDamage, 0);

const starvedOnce = tickSurvival({
  ...createSurvivalTickState(0, 3),
  starvationProgressSeconds: 3,
}, 1, 0);
assert.equal(starvedOnce.state.health, 2);
assert.equal(starvedOnce.starvationDamage, 1);
const starvationFloor = tickSurvival(starvedOnce.state, 4, 0);
assert.equal(starvationFloor.state.health, 1);
assert.equal(starvationFloor.starvationDamage, 1);
assert.equal(tickSurvival(starvationFloor.state, 5, 0).state.health, 1, "starvation alone cannot kill the player");

console.log("lakecraft survival tests: ok");
