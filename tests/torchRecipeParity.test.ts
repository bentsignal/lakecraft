import assert from "node:assert/strict";
import {
  matchCraftingGrid,
  takeCraftingResult,
  type CraftingGrid,
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
  RECIPES,
  countItem,
  craftRecipe,
  createEmptyEquipment,
  createEmptyInventory,
  type Inventory,
  type ItemId,
  type ItemStack,
} from "../shared/game.ts";
import {
  PLAYER_STATE_VERSION,
  validatePlayerStateJson,
  type CanonicalPlayerState,
} from "../shared/chestTransfers.ts";

function stack(itemId: ItemId, count = 1): ItemStack {
  return { itemId, count };
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

const torchRecipe = RECIPES.find(({ id }) => id === "torch");
assert.ok(torchRecipe, "the torch recipe remains in the shared authoritative catalog");
assert.deepEqual(torchRecipe.ingredients, [
  { itemId: "coal", count: 1 },
  { itemId: "stick", count: 1 },
], "the economic recipe consumes coal, never planks");

// The compact player grid accepts only coal directly above a stick. Taking the
// result consumes exactly those occupied cells and leaves the neighboring cells alone.
const coalGrid: CraftingGrid = [stack("coal", 2), null, stack("stick", 2), null];
const gridMatch = matchCraftingGrid(coalGrid, 2);
assert.equal(gridMatch?.recipe.id, "torch");
assert.deepEqual(gridMatch?.consumedSlots, [0, 2]);
const gridCraft = takeCraftingResult({ grid: coalGrid, cursor: null }, 2);
assert.equal(gridCraft.ok, true);
if (!gridCraft.ok) throw new Error(gridCraft.reason);
assert.deepEqual(gridCraft.state.grid, [stack("coal"), null, stack("stick"), null]);
assert.deepEqual(gridCraft.state.cursor, stack("torch", 4));
assert.deepEqual(coalGrid, [stack("coal", 2), null, stack("stick", 2), null], "grid crafting is immutable");

const plankGrid: CraftingGrid = [stack("planks"), null, stack("stick"), null];
assert.equal(matchCraftingGrid(plankGrid, 2), null, "planks over a stick cannot spoof the torch shape");

// The inventory-only economic API has the same material parity as the visual grid.
const coalInventory = createEmptyInventory();
coalInventory[0] = stack("coal");
coalInventory[1] = stack("stick");
const coalCraft = craftRecipe(coalInventory, torchRecipe, "field");
assert.equal(coalCraft.ok, true);
if (!coalCraft.ok) throw new Error(coalCraft.reason);
assert.deepEqual([
  countItem(coalCraft.inventory, "coal"),
  countItem(coalCraft.inventory, "stick"),
  countItem(coalCraft.inventory, "torch"),
], [0, 0, 4]);

const plankInventory = createEmptyInventory();
plankInventory[0] = stack("planks");
plankInventory[1] = stack("stick");
const plankCraft = craftRecipe(plankInventory, torchRecipe, "field");
assert.deepEqual(plankCraft, {
  ok: false,
  inventory: plankInventory,
  reason: "missing_ingredients",
}, "planks cannot satisfy the authoritative coal requirement");

// Shift-click output batches the pinned torch recipe while conserving every
// ingredient and output count across the decomposed workspace/stow boundary.
const batchInventory = createEmptyInventory();
const batchWorkspace = createInventoryWorkspace(batchInventory, createEmptyEquipment(), 2);
batchWorkspace.grid = [stack("coal", 3), null, stack("stick", 3), null];
const batchCraft = takeAllWorkspaceCraftingResultsToInventory(batchWorkspace);
assert.equal(batchCraft.ok, true);
if (!batchCraft.ok) throw new Error(batchCraft.reason);
assert.equal(batchCraft.recipeId, "torch");
assert.deepEqual(batchCraft.crafted, { itemId: "torch", count: 12, batches: 3 });
assert.deepEqual(batchCraft.state.grid, [null, null, null, null]);
assert.deepEqual([
  countItem(batchCraft.state.inventory, "coal"),
  countItem(batchCraft.state.inventory, "stick"),
  countItem(batchCraft.state.inventory, "torch"),
], [0, 0, 12]);
const stowedBatch = stowInventoryWorkspace(batchCraft.state);
assert.equal(stowedBatch.ok, true);
if (!stowedBatch.ok) throw new Error(stowedBatch.reason);
assert.deepEqual([
  countItem(stowedBatch.snapshot.inventory, "coal"),
  countItem(stowedBatch.snapshot.inventory, "stick"),
  countItem(stowedBatch.snapshot.inventory, "torch"),
], [0, 0, 12], "stowing cannot duplicate or restore a consumed batch ingredient");

// The Lakebed inventory action fingerprint is checked before transition replay.
// An exact transport retry therefore returns the saved result without consuming
// a second coal or producing a duplicate torch batch.
const authorityInventory = createEmptyInventory();
authorityInventory[0] = stack("coal", 2);
authorityInventory[1] = stack("stick", 2);
const authorityBefore = canonical(authorityInventory);
const oneCraft = craftRecipe(authorityBefore.inventory, torchRecipe, "field");
assert.equal(oneCraft.ok, true);
if (!oneCraft.ok) throw new Error(oneCraft.reason);
const authorityDesired = canonical(oneCraft.inventory);
const request = validateInventoryActionRequestJson(JSON.stringify({
  operationId: "torch_recipe_op_0001",
  expectedRevision: "7",
  kind: "workspace_commit",
  playerStateJson: JSON.stringify(authorityDesired),
  recipes: [{ recipeId: "torch", crafts: 1 }],
  craftingContext: "field",
  workstationCoordKey: "",
}));
assert.equal(request.ok, true);
if (!request.ok) throw new Error(request.reason);
assert.equal(decideInventoryActionReplay(null, request.request.fingerprint), "new");
const committed = applyInventoryAction(authorityBefore, request.request.action);
assert.equal(committed.ok, true);
if (!committed.ok) throw new Error(committed.reason);
assert.deepEqual([
  countItem(committed.state.inventory, "coal"),
  countItem(committed.state.inventory, "stick"),
  countItem(committed.state.inventory, "torch"),
], [1, 1, 4], "the first authoritative commit consumes one exact recipe batch");

assert.equal(
  decideInventoryActionReplay(request.request.fingerprint, request.request.fingerprint),
  "replay",
  "the exact operation retry resolves from its receipt before a second write",
);
assert.deepEqual([
  countItem(committed.state.inventory, "coal"),
  countItem(committed.state.inventory, "stick"),
  countItem(committed.state.inventory, "torch"),
], [1, 1, 4], "receipt replay leaves the committed economic state byte-stable");
assert.deepEqual(
  applyInventoryAction(committed.state, request.request.action),
  { ok: false, reason: "invalid_transition" },
  "even an accidental second transition cannot mint duplicate torches from the same desired ledger",
);

console.log("torch recipe parity and exact-retry conservation checks passed");
