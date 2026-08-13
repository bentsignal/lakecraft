import assert from "node:assert/strict";
import {
  MAX_INVENTORY_ACTION_CRAFTS,
  applyInventoryAction,
  createInitializedPlayerState,
  decideInventoryActionReplay,
  inventoryActionLedger,
  validateInventoryActionRequestJson,
  type InventoryAction,
} from "../shared/inventoryActions.ts";
import {
  RECIPES,
  craftRecipe,
  createEmptyEquipment,
  createEmptyInventory,
  createItemStack,
  equipArmorFromInventory,
  type Inventory,
} from "../shared/game.ts";
import { PLAYER_STATE_VERSION, validatePlayerStateJson, type CanonicalPlayerState } from "../shared/chestTransfers.ts";

function canonical(
  inventory: Inventory,
  hunger = 20,
  selectedHotbar = 0,
): CanonicalPlayerState {
  const result = validatePlayerStateJson(JSON.stringify({
    version: PLAYER_STATE_VERSION,
    inventory,
    selectedHotbar,
    equipment: createEmptyEquipment(),
    respawnPoint: null,
    hunger,
  }));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function workspace(
  state: CanonicalPlayerState,
  recipes: Array<{ recipeId: string; crafts: number }> = [],
): InventoryAction {
  return {
    kind: "workspace_commit",
    playerState: state,
    playerStateJson: JSON.stringify(state),
    recipes,
    craftingContext: "field",
    workstationCoordKey: "",
  };
}

const starter = createInitializedPlayerState();
assert.deepEqual(
  starter.inventory.slice(0, 4).map((stack) => stack?.itemId),
  ["wooden_pickaxe", "wooden_axe", "dirt", "planks"],
  "the server, not a client payload, defines the only starter ledger",
);
assert.equal(starter.selectedHotbar, 2);

const rearranged = structuredClone(starter);
[rearranged.inventory[0], rearranged.inventory[8]] = [rearranged.inventory[8], rearranged.inventory[0]];
const rearrangeResult = applyInventoryAction(starter, workspace(rearranged));
assert.equal(rearrangeResult.ok, true);
if (!rearrangeResult.ok) throw new Error(rearrangeResult.reason);
assert.deepEqual(inventoryActionLedger(rearrangeResult.state), inventoryActionLedger(starter));

const forged = structuredClone(starter);
forged.inventory[10] = { itemId: "diamond", count: 64 };
assert.deepEqual(applyInventoryAction(starter, workspace(forged)), { ok: false, reason: "invalid_transition" });
const deleted = structuredClone(starter);
deleted.inventory[2] = null;
assert.deepEqual(applyInventoryAction(starter, workspace(deleted)), { ok: false, reason: "invalid_transition" });
const repaired = structuredClone(starter);
repaired.inventory[0] = createItemStack("wooden_pickaxe");
const worn = structuredClone(starter);
worn.inventory[0] = { itemId: "wooden_pickaxe", count: 1, durability: 1 };
assert.deepEqual(applyInventoryAction(worn, workspace(repaired)), { ok: false, reason: "invalid_transition" });

const craftStartInventory = createEmptyInventory();
craftStartInventory[0] = { itemId: "planks", count: 8 };
const craftStart = canonical(craftStartInventory);
const stickRecipe = RECIPES.find(({ id }) => id === "sticks_from_planks")!;
const craftedInventory = craftRecipe(craftStart.inventory, stickRecipe, "field");
assert.equal(craftedInventory.ok, true);
if (!craftedInventory.ok) throw new Error(craftedInventory.reason);
const craftDesired = { ...craftStart, inventory: craftedInventory.inventory };
const craftResult = applyInventoryAction(craftStart, workspace(craftDesired, [{ recipeId: stickRecipe.id, crafts: 1 }]));
assert.equal(craftResult.ok, true);
if (!craftResult.ok) throw new Error(craftResult.reason);
assert.deepEqual(craftResult.crafted, [{ itemId: "stick", count: 4 }]);
assert.deepEqual(applyInventoryAction(craftStart, workspace(craftDesired)), { ok: false, reason: "invalid_transition" });

const armorInventory = createEmptyInventory();
armorInventory[0] = createItemStack("iron_helmet");
const armorStart = canonical(armorInventory);
const equipped = equipArmorFromInventory(armorStart.inventory, armorStart.equipment, 0);
assert.equal(equipped.ok, true);
if (!equipped.ok) throw new Error(equipped.reason);
const equipResult = applyInventoryAction(armorStart, workspace({
  ...armorStart,
  inventory: equipped.inventory,
  equipment: equipped.equipment,
}));
assert.equal(equipResult.ok, true, "equip/unequip is an exact durable-ledger layout action");

const foodInventory = createEmptyInventory();
foodInventory[3] = { itemId: "cooked_beef", count: 2 };
const hungry = canonical(foodInventory, 10);
const ate = applyInventoryAction(hungry, { kind: "eat", sourceSlot: 3, expectedItemId: "cooked_beef" });
assert.equal(ate.ok, true);
if (!ate.ok) throw new Error(ate.reason);
assert.deepEqual([ate.state.inventory[3]?.count, ate.state.hunger, ate.consumed, ate.restored], [1, 18, "cooked_beef", 8]);
assert.deepEqual(
  applyInventoryAction(hungry, { kind: "eat", sourceSlot: 3, expectedItemId: "diamond" }),
  { ok: false, reason: "item_mismatch" },
);

const selected = applyInventoryAction(starter, { kind: "select_hotbar", selectedHotbar: 7 });
assert.equal(selected.ok && selected.state.selectedHotbar, 7);
assert.deepEqual(selected.ok && inventoryActionLedger(selected.state), inventoryActionLedger(starter));

const deathSettled = applyInventoryAction(starter, { kind: "death_settle", eventId: "attack:death-0001" });
assert.equal(deathSettled.ok, true);
if (!deathSettled.ok) throw new Error(deathSettled.reason);
assert.equal(deathSettled.state.inventory.every((stack) => stack === null), true);
assert.deepEqual(deathSettled.state.equipment, createEmptyEquipment());
assert.equal(deathSettled.state.hunger, 20);
assert.equal(validateInventoryActionRequestJson(JSON.stringify({
  operationId: "inventory_death_0001",
  expectedRevision: "12",
  kind: "death_settle",
  eventId: "attack:death-0001",
})).ok, true, "a bounded fatal event can persist the conserved empty carried state");

const operationId = "inventory_action_000001";
const canonicalDesired = JSON.stringify(rearranged);
const requestJson = JSON.stringify({
  operationId,
  expectedRevision: "12",
  kind: "workspace_commit",
  playerStateJson: canonicalDesired,
  recipes: [],
  craftingContext: "field",
  workstationCoordKey: "",
});
const request = validateInventoryActionRequestJson(requestJson);
assert.equal(request.ok, true);
if (!request.ok) throw new Error(request.reason);
assert.equal(decideInventoryActionReplay(null, request.request.fingerprint), "new");
assert.equal(decideInventoryActionReplay(request.request.fingerprint, request.request.fingerprint), "replay");
assert.equal(decideInventoryActionReplay("different", request.request.fingerprint), "operation_id_reused");
assert.equal(validateInventoryActionRequestJson(JSON.stringify({
  operationId,
  expectedRevision: "0",
  kind: "initialize",
  playerStateJson: canonicalDesired,
})).ok, false, "initialize never accepts a client ledger");
assert.equal(validateInventoryActionRequestJson(JSON.stringify({
  operationId,
  expectedRevision: "12",
  kind: "workspace_commit",
  playerStateJson: canonicalDesired,
  recipes: [{ recipeId: stickRecipe.id, crafts: MAX_INVENTORY_ACTION_CRAFTS + 1 }],
  craftingContext: "field",
  workstationCoordKey: "",
})).ok, false);

// Deterministic 1,000 legitimate actions conserve the exact durable ledger.
// Interleaved adversarial deltas are byte-stable failures. This is deliberately
// independent of Lakebed order.
let state = starter;
let seed = 0x51f15e;
for (let index = 0; index < 1_000; index += 1) {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  const beforeLedger = inventoryActionLedger(state);
  if (index % 2 === 0) {
    const next = structuredClone(state);
    const left = seed % next.inventory.length;
    const right = (seed >>> 8) % next.inventory.length;
    [next.inventory[left], next.inventory[right]] = [next.inventory[right], next.inventory[left]];
    const result = applyInventoryAction(state, workspace(next));
    assert.equal(result.ok, true);
    if (result.ok) state = result.state;
    assert.deepEqual(inventoryActionLedger(state), beforeLedger);
  } else {
    const result = applyInventoryAction(state, { kind: "select_hotbar", selectedHotbar: seed % 9 });
    assert.equal(result.ok, true);
    if (result.ok) state = result.state;
    assert.deepEqual(inventoryActionLedger(state), beforeLedger);
  }
  if (index % 3 === 0) {
    const acceptedJson = JSON.stringify(state);
    const acceptedLedger = inventoryActionLedger(state);
    const next = structuredClone(state);
    next.inventory[(seed >>> 16) % next.inventory.length] = { itemId: "diamond", count: 64 };
    const result = applyInventoryAction(state, workspace(next));
    assert.deepEqual(result, { ok: false, reason: "invalid_transition" });
    assert.equal(JSON.stringify(state), acceptedJson, "rejected forgery is byte-identical");
    assert.deepEqual(inventoryActionLedger(state), acceptedLedger);
  }
}

console.log("authoritative inventory action tests passed");
