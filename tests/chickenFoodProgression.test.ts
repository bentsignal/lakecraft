import assert from "node:assert/strict";
import { getItemIconArt, ITEM_ICON_SIZE } from "../client/components/itemIconArt.ts";
import {
  FURNACE_COAL_BURN_MS,
  FURNACE_COOK_MS,
  createEmptyFurnace,
  materializeFurnace,
  type FurnaceState,
} from "../shared/furnaces.ts";
import {
  ITEMS,
  SMELTING_RECIPES,
  consumeFood,
  createEmptyInventory,
  createItemStack,
} from "../shared/game.ts";

const NOW = 1_700_000_000_000;

assert.deepEqual(ITEMS.raw_chicken, {
  id: "raw_chicken",
  label: "Raw Chicken",
  shortLabel: "R·CH",
  description: "Raw chicken from a chicken. Cooking it makes a much better meal.",
  category: "food",
  maxStack: 64,
  glyph: "◖",
  color: "#d9a69a",
  food: { hunger: 2 },
});
assert.deepEqual(ITEMS.cooked_chicken, {
  id: "cooked_chicken",
  label: "Cooked Chicken",
  shortLabel: "C·CH",
  description: "Furnace-roasted chicken that restores substantial hunger.",
  category: "food",
  maxStack: 64,
  glyph: "◖",
  color: "#a8663e",
  food: { hunger: 6 },
});
assert.deepEqual(createItemStack("raw_chicken", 64), { itemId: "raw_chicken", count: 64 });
assert.deepEqual(createItemStack("cooked_chicken", 64), { itemId: "cooked_chicken", count: 64 });

const rawInventory = createEmptyInventory();
rawInventory[0] = { itemId: "raw_chicken", count: 2 };
const ateRaw = consumeFood(rawInventory, 0, 10);
assert.equal(ateRaw.ok, true);
if (ateRaw.ok) {
  assert.equal(ateRaw.consumed, "raw_chicken");
  assert.equal(ateRaw.restored, 2);
  assert.equal(ateRaw.hunger, 12);
  assert.deepEqual(ateRaw.inventory[0], { itemId: "raw_chicken", count: 1 });
}

const cookedInventory = createEmptyInventory();
cookedInventory[0] = { itemId: "cooked_chicken", count: 1 };
const ateCooked = consumeFood(cookedInventory, 0, 10);
assert.equal(ateCooked.ok, true);
if (ateCooked.ok) {
  assert.equal(ateCooked.consumed, "cooked_chicken");
  assert.equal(ateCooked.restored, 6);
  assert.equal(ateCooked.hunger, 16);
  assert.equal(ateCooked.inventory[0], null);
}
const fullHunger = consumeFood(cookedInventory, 0, 20);
assert.deepEqual(fullHunger, {
  ok: false,
  inventory: cookedInventory,
  hunger: 20,
  reason: "hunger_full",
}, "failed eating consumes no chicken");

const chickenRecipes = SMELTING_RECIPES.filter(({ input, output }) => (
  input === "raw_chicken" || output === "cooked_chicken"
));
assert.deepEqual(chickenRecipes, [{
  id: "cooked_chicken",
  label: "Cook chicken",
  input: "raw_chicken",
  output: "cooked_chicken",
}], "chicken has one exact one-to-one furnace recipe");

const empty = createEmptyFurnace("3:7:-4", NOW);
assert.equal(empty.ok, true);
if (!empty.ok) throw new Error(empty.reason);
const loaded: FurnaceState = {
  ...empty.state,
  input: { itemId: "raw_chicken", count: 2 },
  fuel: { itemId: "coal", count: 1 },
};
const cooked = materializeFurnace(loaded, NOW + 2 * FURNACE_COOK_MS);
assert.equal(cooked.ok, true);
if (!cooked.ok) throw new Error(cooked.reason);
assert.equal(cooked.cooked, 2);
assert.equal(cooked.fuelConsumed, 1);
assert.equal(cooked.state.input, null);
assert.equal(cooked.state.fuel, null);
assert.deepEqual(cooked.state.output, { itemId: "cooked_chicken", count: 2 });
assert.equal(cooked.state.burnRemainingMs, FURNACE_COAL_BURN_MS - 2 * FURNACE_COOK_MS);
assert.equal(cooked.state.cookProgressMs, 0);

const replay = materializeFurnace(cooked.state, NOW + 2 * FURNACE_COOK_MS);
assert.deepEqual(replay, { ok: true, state: cooked.state, cooked: 0, fuelConsumed: 0 },
  "replaying one trusted timestamp cannot duplicate cooked chicken");

for (const blockedOutput of [
  { itemId: "cooked_chicken", count: 64 } as const,
  { itemId: "cooked_beef", count: 1 } as const,
]) {
  const blocked: FurnaceState = { ...loaded, output: blockedOutput };
  const result = materializeFurnace(blocked, NOW + FURNACE_COOK_MS);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.reason);
  assert.equal(result.cooked, 0);
  assert.equal(result.fuelConsumed, 0);
  assert.deepEqual(result.state.input, loaded.input);
  assert.deepEqual(result.state.fuel, loaded.fuel);
  assert.deepEqual(result.state.output, blockedOutput);
  assert.equal(result.state.burnRemainingMs, 0);
  assert.equal(result.state.cookProgressMs, 0);
}
assert.deepEqual(materializeFurnace(loaded, NOW - 1), { ok: false, reason: "invalid_time" });

const rawArt = getItemIconArt("raw_chicken");
const cookedArt = getItemIconArt("cooked_chicken");
assert.equal(ITEM_ICON_SIZE, 16);
assert.equal(rawArt.family, "food");
assert.equal(rawArt.variant, "raw_chicken");
assert.equal(cookedArt.family, "food");
assert.equal(cookedArt.variant, "cooked_chicken");
assert.ok(rawArt.runs.length >= 12, "raw chicken has an authored pixel silhouette");
assert.ok(cookedArt.runs.length >= 12, "cooked chicken has an authored pixel silhouette");
assert.notDeepEqual(rawArt.runs, cookedArt.runs, "raw and cooked chicken have distinct pixel art");
for (const art of [rawArt, cookedArt]) {
  for (const run of art.runs) {
    assert.ok(Number.isInteger(run.x) && Number.isInteger(run.y) && Number.isInteger(run.width));
    assert.ok(run.x >= 0 && run.y >= 0 && run.x + run.width <= ITEM_ICON_SIZE && run.y < ITEM_ICON_SIZE);
    assert.match(run.color, /^#[0-9a-f]{6}$/i);
  }
}

console.log("chicken food catalog, furnace conservation, hunger, and 16x16 icon tests passed");
