import assert from "node:assert/strict";
import { ITEM_ICON_SIZE, getItemIconArt } from "../client/components/itemIconArt.ts";
import {
  CRAFTING_GRID_RECIPES,
  INITIAL_RECIPE_PATTERNS,
  matchCraftingGrid,
  type CraftingGrid,
  type CraftingGridRecipe,
} from "../shared/craftingGrid.ts";
import {
  applyInventoryAction,
  decideInventoryActionReplay,
  validateInventoryActionRequestJson,
} from "../shared/inventoryActions.ts";
import {
  createInventoryWorkspace,
  stowInventoryWorkspace,
  takeAllWorkspaceCraftingResultsToInventory,
} from "../shared/inventoryWorkspace.ts";
import {
  FURNACE_COAL_BURN_MS,
  createEmptyFurnace,
  materializeFurnace,
  serializeFurnaceState,
  validateFurnaceJson,
  type FurnaceState,
} from "../shared/furnaces.ts";
import {
  ITEMS,
  RECIPES,
  SMELTING_RECIPES,
  countItem,
  craftRecipe,
  createEmptyEquipment,
  createEmptyInventory,
  smeltRecipe,
  type Inventory,
  type ItemId,
  type ItemStack,
  type Recipe,
} from "../shared/game.ts";
import {
  PLAYER_STATE_VERSION,
  validatePlayerStateJson,
  type CanonicalPlayerState,
} from "../shared/chestTransfers.ts";

const NOW = 1_700_000_000_000;
const TORCH_CASES = [
  { recipeId: "torch", fuelId: "coal" },
  { recipeId: "torch_charcoal", fuelId: "charcoal" },
] as const;

function stack(itemId: ItemId, count = 1): ItemStack {
  return { itemId, count };
}

function recipe(id: string): Recipe {
  const found = RECIPES.find((candidate) => candidate.id === id);
  assert.ok(found, `missing economic recipe ${id}`);
  return found;
}

function gridRecipe(id: string): CraftingGridRecipe {
  const found = CRAFTING_GRID_RECIPES.find((candidate) => candidate.id === id);
  assert.ok(found, `missing crafting-grid recipe ${id}`);
  return found;
}

function canonical(inventory: Inventory): CanonicalPlayerState {
  const parsed = validatePlayerStateJson(JSON.stringify({
    version: PLAYER_STATE_VERSION,
    inventory,
    selectedHotbar: 0,
    equipment: createEmptyEquipment(),
    respawnPoint: null,
    hunger: 20,
  }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.state;
}

function ingredientLedger(entries: readonly { itemId: ItemId; count: number }[]): Record<string, number> {
  const ledger: Record<string, number> = {};
  for (const { itemId, count } of entries) ledger[itemId] = (ledger[itemId] ?? 0) + count;
  return ledger;
}

assert.deepEqual(ITEMS.charcoal, {
  id: "charcoal",
  label: "Charcoal",
  shortLabel: "CHR",
  description: "Charred oak fuel made by smelting a log.",
  category: "material",
  maxStack: 64,
  glyph: "▰",
  color: "#383632",
}, "charcoal is a canonical stackable fuel material");

const charcoalArt = getItemIconArt("charcoal");
const coalArt = getItemIconArt("coal");
assert.equal(ITEM_ICON_SIZE, 16);
assert.equal(charcoalArt.family, "material");
assert.equal(charcoalArt.variant, "charcoal");
assert.ok(charcoalArt.runs.length >= 12, "charcoal has an authored pixel silhouette");
assert.notDeepEqual(charcoalArt.runs, coalArt.runs, "charcoal is visually distinct from loose coal");
for (const run of charcoalArt.runs) {
  assert.ok(Number.isInteger(run.x) && Number.isInteger(run.y) && Number.isInteger(run.width));
  assert.ok(run.x >= 0 && run.y >= 0 && run.x + run.width <= ITEM_ICON_SIZE && run.y < ITEM_ICON_SIZE);
  assert.match(run.color, /^#[0-9a-f]{6}$/i);
}

assert.deepEqual(
  SMELTING_RECIPES.filter(({ id, input, output }) => id === "charcoal" || input === "log" || output === "charcoal"),
  [{ id: "charcoal", label: "Make charcoal", input: "log", output: "charcoal" }],
  "one log has one exact one-to-one charcoal smelting recipe",
);

// Both fuels survive the same canonical JSON boundary and burn for the same
// trusted-time duration. Replaying at the already-materialized timestamp is a
// no-op, so a retried Lakebed query cannot mint a second output batch.
for (const fuelId of ["coal", "charcoal"] as const) {
  const created = createEmptyFurnace("14:8:-11", NOW);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error(created.reason);
  const loaded: FurnaceState = {
    ...created.state,
    input: stack("log", 8),
    fuel: stack(fuelId),
  };
  const serialized = serializeFurnaceState(loaded);
  assert.equal(serialized.ok, true, `${fuelId} is accepted by persistent furnace validation`);
  if (!serialized.ok) throw new Error(serialized.reason);
  const restored = validateFurnaceJson(serialized.furnaceJson, loaded.coordKey);
  assert.equal(restored.ok, true);
  if (!restored.ok) throw new Error(restored.reason);
  assert.deepEqual(restored.state.fuel, stack(fuelId));

  const fired = materializeFurnace(restored.state, NOW + FURNACE_COAL_BURN_MS);
  assert.equal(fired.ok, true);
  if (!fired.ok) throw new Error(fired.reason);
  assert.equal(fired.cooked, 8);
  assert.equal(fired.fuelConsumed, 1);
  assert.equal(fired.state.input, null);
  assert.equal(fired.state.fuel, null);
  assert.deepEqual(fired.state.output, stack("charcoal", 8));
  assert.equal(fired.state.burnRemainingMs, 0, `${fuelId} burns for the canonical 80 seconds`);
  assert.deepEqual(materializeFurnace(fired.state, NOW + FURNACE_COAL_BURN_MS), {
    ok: true,
    state: fired.state,
    cooked: 0,
    fuelConsumed: 0,
  }, `${fuelId} materialization is exact at the same trusted timestamp`);
}

const empty = createEmptyFurnace("2:9:3", NOW);
assert.equal(empty.ok, true);
if (!empty.ok) throw new Error(empty.reason);
for (const blockedOutput of [stack("charcoal", ITEMS.charcoal.maxStack), stack("iron_ingot")]) {
  const blocked: FurnaceState = {
    ...empty.state,
    input: stack("log", 2),
    fuel: stack("charcoal"),
    output: blockedOutput,
  };
  const result = materializeFurnace(blocked, NOW + FURNACE_COAL_BURN_MS);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.reason);
  assert.equal(result.cooked, 0);
  assert.equal(result.fuelConsumed, 0, "a blocked output never ignites queued charcoal");
  assert.deepEqual(result.state.input, blocked.input);
  assert.deepEqual(result.state.fuel, blocked.fuel);
  assert.deepEqual(result.state.output, blocked.output);
  assert.equal(result.state.burnRemainingMs, 0);
  assert.equal(result.state.cookProgressMs, 0);
}

// The aggregate smelting helper also accepts either fuel. When both are in the
// inventory its documented coal-first choice is deterministic and never merges
// or consumes the charcoal stack accidentally.
for (const fuelId of ["coal", "charcoal"] as const) {
  const inventory = createEmptyInventory();
  inventory[0] = stack("log", 8);
  inventory[1] = stack(fuelId);
  const result = smeltRecipe(inventory, "charcoal");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.reason);
  assert.deepEqual(result.smelted, stack("charcoal", 8));
  assert.equal(countItem(result.inventory, "log"), 0);
  assert.equal(countItem(result.inventory, fuelId), fuelId === "charcoal" ? 8 : 0);
}
const bothFuels = createEmptyInventory();
bothFuels[0] = stack("log", 8);
bothFuels[1] = stack("coal");
bothFuels[2] = stack("charcoal");
const deterministicFuel = smeltRecipe(bothFuels, "charcoal");
assert.equal(deterministicFuel.ok, true);
if (!deterministicFuel.ok) throw new Error(deterministicFuel.reason);
assert.equal(countItem(deterministicFuel.inventory, "coal"), 0);
assert.equal(countItem(deterministicFuel.inventory, "charcoal"), 9,
  "coal is consumed first while the original charcoal and eight outputs remain distinct");

for (const { recipeId, fuelId } of TORCH_CASES) {
  const economic = recipe(recipeId);
  const pattern = INITIAL_RECIPE_PATTERNS[recipeId];
  assert.ok(pattern, `missing pattern for ${recipeId}`);
  assert.equal(pattern.kind, "shaped");
  if (pattern.kind !== "shaped") throw new Error(`${recipeId} must be shaped`);
  const visualIngredients = pattern.pattern.flat().filter((itemId): itemId is ItemId => itemId !== null)
    .map((itemId) => ({ itemId, count: 1 }));
  assert.deepEqual(ingredientLedger(visualIngredients), ingredientLedger(economic.ingredients),
    `${recipeId} grid and aggregate ingredients have exact material parity`);
  assert.equal(economic.craftingContext, "field");
  assert.deepEqual(economic.output, stack("torch", 4));

  const grid: CraftingGrid = [stack(fuelId, 3), null, stack("stick", 3), null];
  const matched = matchCraftingGrid(grid, 2);
  assert.equal(matched?.recipe.id, recipeId, `${fuelId} selects only its canonical torch recipe`);
  assert.deepEqual(matched?.consumedSlots, [0, 2]);

  const otherId = recipeId === "torch" ? "torch_charcoal" : "torch";
  assert.equal(matchCraftingGrid(grid, 2, [gridRecipe(otherId)]), null,
    `${fuelId} cannot satisfy ${otherId}`);

  const workspace = createInventoryWorkspace(createEmptyInventory(), createEmptyEquipment(), 2);
  workspace.grid = grid;
  const batched = takeAllWorkspaceCraftingResultsToInventory(workspace);
  assert.equal(batched.ok, true);
  if (!batched.ok) throw new Error(batched.reason);
  assert.equal(batched.recipeId, recipeId);
  assert.deepEqual(batched.crafted, { itemId: "torch", count: 12, batches: 3 });
  assert.deepEqual(batched.state.grid, [null, null, null, null]);
  assert.deepEqual([
    countItem(batched.state.inventory, fuelId),
    countItem(batched.state.inventory, "stick"),
    countItem(batched.state.inventory, "torch"),
  ], [0, 0, 12]);
  const stowed = stowInventoryWorkspace(batched.state);
  assert.equal(stowed.ok, true);
  if (!stowed.ok) throw new Error(stowed.reason);
  assert.equal(countItem(stowed.snapshot.inventory, "torch"), 12,
    `${recipeId} shift batch survives the workspace boundary without duplication`);
}

// One authoritative workspace commit contains one coal recipe and one charcoal
// recipe. Receipt replay returns the identical result; an accidental second
// transition fails because the desired economic ledger is already stale.
const authorityInventory = createEmptyInventory();
authorityInventory[0] = stack("coal", 2);
authorityInventory[1] = stack("charcoal", 2);
authorityInventory[2] = stack("stick", 4);
const authorityBefore = canonical(authorityInventory);
let desiredInventory = authorityBefore.inventory;
for (const { recipeId } of TORCH_CASES) {
  const crafted = craftRecipe(desiredInventory, recipeId, "field");
  assert.equal(crafted.ok, true);
  if (!crafted.ok) throw new Error(crafted.reason);
  desiredInventory = crafted.inventory;
}
const authorityDesired = canonical(desiredInventory);
const request = validateInventoryActionRequestJson(JSON.stringify({
  operationId: "charcoal_torch_op_0001",
  expectedRevision: "19",
  kind: "workspace_commit",
  playerStateJson: JSON.stringify(authorityDesired),
  recipes: TORCH_CASES.map(({ recipeId }) => ({ recipeId, crafts: 1 })),
  craftingContext: "field",
  workstationCoordKey: "",
}));
assert.equal(request.ok, true);
if (!request.ok) throw new Error(request.reason);
assert.equal(decideInventoryActionReplay(null, request.request.fingerprint), "new");
const committed = applyInventoryAction(authorityBefore, request.request.action);
assert.equal(committed.ok, true);
if (!committed.ok) throw new Error(committed.reason);
assert.deepEqual(committed.crafted, [{ itemId: "torch", count: 8 }]);
assert.deepEqual([
  countItem(committed.state.inventory, "coal"),
  countItem(committed.state.inventory, "charcoal"),
  countItem(committed.state.inventory, "stick"),
  countItem(committed.state.inventory, "torch"),
], [1, 1, 2, 8]);
assert.equal(
  decideInventoryActionReplay(request.request.fingerprint, request.request.fingerprint),
  "replay",
  "an exact transport retry resolves from its stored fingerprint",
);
assert.deepEqual(
  applyInventoryAction(committed.state, request.request.action),
  { ok: false, reason: "invalid_transition" },
  "a replayed charcoal torch action cannot consume fuel or mint a second output",
);

console.log("charcoal catalog, furnace, dual-torch parity, batching, and exact-retry tests passed");
