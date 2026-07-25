import assert from "node:assert/strict";
import {
  FURNACE_COAL_BURN_MS,
  FURNACE_COOK_MS,
  MAX_FURNACE_JSON_LENGTH,
  applyFurnaceTransfer,
  createEmptyFurnace,
  isFurnaceFuelItem,
  materializeFurnace,
  serializeFurnaceState,
  validateFurnaceCoordinate,
  validateFurnaceJson,
  validateFurnaceState,
  type FurnaceState,
  type FurnaceTransferAction,
} from "../shared/furnaces.ts";
import { INVENTORY_SIZE, ITEMS, SMELTING_RECIPES, createEmptyInventory, type Inventory, type ItemId, type ItemStack } from "../shared/game.ts";

const NOW = 1_700_000_000_000;

assert.equal(isFurnaceFuelItem("coal"), true);
assert.equal(isFurnaceFuelItem("charcoal"), true);
assert.equal(isFurnaceFuelItem("planks"), false);

function emptyFurnace(now = NOW): FurnaceState {
  const created = createEmptyFurnace("12:7:-9", now);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.reason);
  return created.state;
}

assert.deepEqual(validateFurnaceCoordinate(" 00012:007:-0009 "), {
  ok: true, coordKey: "12:7:-9", x: 12, y: 7, z: -9,
});
for (const coord of ["", "1:2", "1:2:3:4", "1.5:2:3", "1000001:2:3", "1:-25:3", "1:129:3", "wat:2:3"]) {
  assert.deepEqual(validateFurnaceCoordinate(coord), { ok: false, reason: "invalid_coordinate" }, coord);
}
assert.equal(createEmptyFurnace("bad", NOW).ok, false);
assert.equal(createEmptyFurnace("0:0:0", -1).ok, false);

const canonical = emptyFurnace();
const serialized = serializeFurnaceState(canonical);
assert.equal(serialized.ok, true);
if (serialized.ok) {
  assert.ok(serialized.furnaceJson.length <= MAX_FURNACE_JSON_LENGTH);
  assert.deepEqual(validateFurnaceJson(serialized.furnaceJson), serialized);
  assert.equal(validateFurnaceJson(serialized.furnaceJson, "12:7:-9").ok, true);
  assert.deepEqual(validateFurnaceJson(serialized.furnaceJson, "0:0:0"), { ok: false, reason: "coordinate_mismatch" });
}
assert.deepEqual(validateFurnaceJson("{"), { ok: false, reason: "invalid_json" });
assert.deepEqual(validateFurnaceJson("x".repeat(MAX_FURNACE_JSON_LENGTH + 1)), { ok: false, reason: "too_large" });
for (const mutation of [
  { extra: true },
  { input: { itemId: "stone", count: 1 } },
  { fuel: { itemId: "planks", count: 1 } },
  { output: { itemId: "dirt", count: 1 } },
  { burnRemainingMs: FURNACE_COAL_BURN_MS + 1 },
  { cookProgressMs: FURNACE_COOK_MS },
  { lastMaterializedAtMs: 1.5 },
]) {
  assert.equal(validateFurnaceState({ ...canonical, ...mutation }).ok, false, JSON.stringify(mutation));
}
assert.equal(validateFurnaceState({ ...canonical, fuel: { itemId: "charcoal", count: 64 } }).ok, true,
  "a canonical charcoal fuel stack is persisted without a new furnace shape");

function materialized(state: FurnaceState, now: number): FurnaceState {
  const result = materializeFurnace(state, now);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

const loaded: FurnaceState = {
  ...emptyFurnace(),
  input: { itemId: "raw_iron", count: 8 },
  fuel: { itemId: "coal", count: 1 },
};
const almostCooked = materialized(loaded, NOW + FURNACE_COOK_MS - 1);
assert.deepEqual(almostCooked.input, { itemId: "raw_iron", count: 8 }, "input is never reserved early");
assert.equal(almostCooked.output, null);
assert.equal(almostCooked.cookProgressMs, FURNACE_COOK_MS - 1);
const firstCook = materialized(almostCooked, NOW + FURNACE_COOK_MS);
assert.deepEqual(firstCook.input, { itemId: "raw_iron", count: 7 });
assert.deepEqual(firstCook.output, { itemId: "iron_ingot", count: 1 });
assert.equal(firstCook.cookProgressMs, 0);

const offline = materializeFurnace(loaded, NOW + FURNACE_COAL_BURN_MS);
assert.equal(offline.ok, true);
if (offline.ok) {
  assert.equal(offline.cooked, 8);
  assert.equal(offline.fuelConsumed, 1);
  assert.equal(offline.state.input, null);
  assert.equal(offline.state.fuel, null);
  assert.deepEqual(offline.state.output, { itemId: "iron_ingot", count: 8 });
  assert.equal(offline.state.burnRemainingMs, 0);
  const duplicate = materializeFurnace(offline.state, NOW + FURNACE_COAL_BURN_MS);
  assert.deepEqual(duplicate, { ok: true, state: offline.state, cooked: 0, fuelConsumed: 0 });
}

const charcoalLoaded: FurnaceState = {
  ...emptyFurnace(),
  input: { itemId: "raw_iron", count: 8 },
  fuel: { itemId: "charcoal", count: 1 },
};
const charcoalOffline = materializeFurnace(charcoalLoaded, NOW + FURNACE_COAL_BURN_MS);
assert.equal(charcoalOffline.ok, true);
if (charcoalOffline.ok) {
  assert.equal(charcoalOffline.cooked, 8);
  assert.equal(charcoalOffline.fuelConsumed, 1);
  assert.equal(charcoalOffline.state.input, null);
  assert.equal(charcoalOffline.state.fuel, null);
  assert.deepEqual(charcoalOffline.state.output, { itemId: "iron_ingot", count: 8 });
  assert.equal(charcoalOffline.state.burnRemainingMs, 0,
    "one charcoal burns for exactly the same 80 seconds as one coal");
  assert.deepEqual(materializeFurnace(charcoalOffline.state, NOW + FURNACE_COAL_BURN_MS), {
    ok: true,
    state: charcoalOffline.state,
    cooked: 0,
    fuelConsumed: 0,
  }, "replaying charcoal at the same trusted timestamp is idempotent");
}

const blockedFull: FurnaceState = {
  ...emptyFurnace(),
  input: { itemId: "raw_iron", count: 10 },
  fuel: { itemId: "coal", count: 2 },
  output: { itemId: "iron_ingot", count: 60 },
};
const becameFull = materialized(blockedFull, NOW + 120_000);
assert.deepEqual(becameFull.output, { itemId: "iron_ingot", count: 64 });
assert.deepEqual(becameFull.input, { itemId: "raw_iron", count: 6 });
assert.deepEqual(becameFull.fuel, { itemId: "coal", count: 1 }, "blocked furnace does not ignite another coal");
assert.equal(becameFull.burnRemainingMs, 0, "already-burning fuel continues elapsing while output is full");

const incompatible: FurnaceState = {
  ...emptyFurnace(),
  input: { itemId: "sand", count: 4 },
  fuel: { itemId: "coal", count: 1 },
  output: { itemId: "iron_ingot", count: 2 },
  burnRemainingMs: 50_000,
  cookProgressMs: 4_000,
};
const stillBlocked = materialized(incompatible, NOW + 60_000);
assert.deepEqual(stillBlocked.input, incompatible.input);
assert.deepEqual(stillBlocked.output, incompatible.output);
assert.deepEqual(stillBlocked.fuel, incompatible.fuel, "blocked state does not consume queued fuel");
assert.equal(stillBlocked.cookProgressMs, 4_000);
assert.equal(stillBlocked.burnRemainingMs, 0);

function totals(inventory: readonly (ItemStack | null)[], furnace: FurnaceState): Map<string, number> {
  const result = new Map<string, number>();
  for (const stack of [...inventory, furnace.input, furnace.fuel, furnace.output]) {
    if (!stack) continue;
    const key = `${stack.itemId}:${stack.durability ?? ""}`;
    result.set(key, (result.get(key) ?? 0) + stack.count);
  }
  return result;
}

let inventory = createEmptyInventory();
inventory[0] = { itemId: "sand", count: 20 };
inventory[1] = { itemId: "coal", count: 4 };
let furnace = emptyFurnace();
for (const action of [
  { kind: "deposit_input", inventorySlot: 0, count: 12 },
  { kind: "deposit_fuel", inventorySlot: 1, count: 2 },
] as const) {
  const before = totals(inventory, furnace);
  const moved = applyFurnaceTransfer(furnace, inventory, action, NOW);
  assert.equal(moved.ok, true);
  if (!moved.ok) throw new Error(moved.reason);
  assert.deepEqual(totals(moved.inventory, moved.state), before);
  inventory = moved.inventory;
  furnace = moved.state;
}
furnace = materialized(furnace, NOW + 20_000);
assert.deepEqual(furnace.output, { itemId: "glass", count: 2 });
const beforeTake = totals(inventory, furnace);
const tookOutput = applyFurnaceTransfer(furnace, inventory, { kind: "take_output", count: 2 }, NOW + 20_000);
assert.equal(tookOutput.ok, true);
if (tookOutput.ok) {
  assert.deepEqual(totals(tookOutput.inventory, tookOutput.state), beforeTake);
  assert.equal(tookOutput.inventory.some((stack) => stack?.itemId === "glass" && stack.count === 2), true);
}

const fullInventory = createEmptyInventory();
for (let index = 0; index < fullInventory.length; index += 1) fullInventory[index] = { itemId: "stone", count: 64 };
const outputState = { ...emptyFurnace(), output: { itemId: "glass", count: 2 } as ItemStack };
const failedTake = applyFurnaceTransfer(outputState, fullInventory, { kind: "take_output", count: 2 }, NOW);
assert.equal(failedTake.ok, false);
if (!failedTake.ok) {
  assert.equal(failedTake.reason, "no_capacity");
  assert.deepEqual(failedTake.state, outputState);
  assert.deepEqual(failedTake.inventory, fullInventory);
}

const mixedFuelInventory = createEmptyInventory();
mixedFuelInventory[0] = { itemId: "charcoal", count: 2 };
const coalFuelState: FurnaceState = {
  ...emptyFurnace(),
  fuel: { itemId: "coal", count: 63 },
};
const rejectedMixedFuel = applyFurnaceTransfer(
  coalFuelState,
  mixedFuelInventory,
  { kind: "deposit_fuel", inventorySlot: 0, count: 1 },
  NOW,
);
assert.equal(rejectedMixedFuel.ok, false);
if (!rejectedMixedFuel.ok) {
  assert.equal(rejectedMixedFuel.reason, "incompatible_stack",
    "coal and charcoal never merge into one persisted fuel stack");
  assert.deepEqual(rejectedMixedFuel.state, coalFuelState);
  assert.deepEqual(rejectedMixedFuel.inventory, mixedFuelInventory);
}

const fullCharcoalState: FurnaceState = {
  ...emptyFurnace(),
  fuel: { itemId: "charcoal", count: ITEMS.charcoal.maxStack },
};
const fullCharcoalInventory = createEmptyInventory();
fullCharcoalInventory[0] = { itemId: "charcoal", count: 1 };
const rejectedFullCharcoal = applyFurnaceTransfer(
  fullCharcoalState,
  fullCharcoalInventory,
  { kind: "deposit_fuel", inventorySlot: 0, count: 1 },
  NOW,
);
assert.equal(rejectedFullCharcoal.ok, false);
if (!rejectedFullCharcoal.ok) {
  assert.equal(rejectedFullCharcoal.reason, "no_capacity");
  assert.deepEqual(rejectedFullCharcoal.state, fullCharcoalState);
  assert.deepEqual(rejectedFullCharcoal.inventory, fullCharcoalInventory);
}

// Deterministic property/interleaving run: 1,500 independent histories exercise
// offline jumps, duplicate materialization, all transfer kinds, and conservation.
let seed = 0x5eedc0de;
function random(): number {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  return seed / 0x1_0000_0000;
}
function randomInt(max: number): number {
  return Math.floor(random() * max);
}
const recipeInputs = SMELTING_RECIPES.map(({ input }) => input);

for (let scenario = 0; scenario < 1_500; scenario += 1) {
  let now = NOW + scenario * 1_000_000;
  let state = emptyFurnace(now);
  let player: Inventory = createEmptyInventory();
  const input = recipeInputs[randomInt(recipeInputs.length)];
  player[0] = { itemId: input, count: 1 + randomInt(64) };
  player[1] = { itemId: "coal", count: 1 + randomInt(32) };
  player[2] = { itemId: "charcoal", count: 1 + randomInt(32) };
  const firstFuelSlot = randomInt(2) === 0 ? 1 : 2;

  for (const initial of [
    { kind: "deposit_input", inventorySlot: 0, count: 1 + randomInt(player[0]!.count) },
    { kind: "deposit_fuel", inventorySlot: firstFuelSlot, count: 1 + randomInt(player[firstFuelSlot]!.count) },
  ] as FurnaceTransferAction[]) {
    const before = totals(player, state);
    const result = applyFurnaceTransfer(state, player, initial, now);
    assert.equal(result.ok, true, `scenario ${scenario} initial ${initial.kind}`);
    if (!result.ok) continue;
    assert.deepEqual(totals(result.inventory, result.state), before, `scenario ${scenario} conservation`);
    state = result.state;
    player = result.inventory;
  }

  for (let step = 0; step < 8; step += 1) {
    now += randomInt(240_001);
    const beforeInputCount = state.input?.count ?? 0;
    const beforeFuelCount = state.fuel?.count ?? 0;
    const beforeOutputCount = state.output?.count ?? 0;
    const advanced = materializeFurnace(state, now);
    assert.equal(advanced.ok, true, `scenario ${scenario} materialize ${step}`);
    if (!advanced.ok) break;
    assert.equal(beforeFuelCount - (advanced.state.fuel?.count ?? 0), advanced.fuelConsumed,
      `scenario ${scenario} materialize ${step} exact fuel conservation`);
    const recipe = SMELTING_RECIPES.find(({ input: recipeInput }) => recipeInput === input);
    assert.ok(recipe, `scenario ${scenario} has one smelting recipe`);
    if (!recipe) break;
    assert.equal(beforeInputCount - (advanced.state.input?.count ?? 0), advanced.cooked,
      `scenario ${scenario} materialize ${step} exact input conservation`);
    assert.equal((advanced.state.output?.count ?? 0) - beforeOutputCount, advanced.cooked,
      `scenario ${scenario} materialize ${step} exact output conservation`);
    const duplicate = materializeFurnace(advanced.state, now);
    assert.deepEqual(duplicate, { ok: true, state: advanced.state, cooked: 0, fuelConsumed: 0 }, `scenario ${scenario} idempotence ${step}`);
    state = advanced.state;

    const candidates: FurnaceTransferAction[] = [];
    if (state.input) candidates.push({ kind: "take_input", count: 1 + randomInt(state.input.count) });
    if (state.fuel) candidates.push({ kind: "take_fuel", count: 1 + randomInt(state.fuel.count) });
    if (state.output) candidates.push({ kind: "take_output", count: 1 + randomInt(state.output.count) });
    if (player[0]) candidates.push({ kind: "deposit_input", inventorySlot: 0, count: 1 + randomInt(player[0].count) });
    if (player[1]) candidates.push({ kind: "deposit_fuel", inventorySlot: 1, count: 1 + randomInt(player[1].count) });
    if (player[2]) candidates.push({ kind: "deposit_fuel", inventorySlot: 2, count: 1 + randomInt(player[2].count) });
    if (candidates.length === 0) continue;
    const action = candidates[randomInt(candidates.length)];
    const before = totals(player, state);
    const transfer = applyFurnaceTransfer(state, player, action, now);
    if (!transfer.ok) {
      assert.deepEqual(transfer.state, state, `scenario ${scenario} failed state atomicity`);
      assert.deepEqual(transfer.inventory, player, `scenario ${scenario} failed inventory atomicity`);
      continue;
    }
    assert.deepEqual(totals(transfer.inventory, transfer.state), before, `scenario ${scenario} step ${step} conservation`);
    state = transfer.state;
    player = transfer.inventory;
    assert.equal(player.length, INVENTORY_SIZE);
    assert.equal(validateFurnaceState(state).ok, true);
  }
}

assert.equal(ITEMS.coal.maxStack, 64);
assert.equal(ITEMS.charcoal.maxStack, 64);
console.log("lakecraft deterministic coal/charcoal furnace model tests: ok (1,500 randomized histories)");
