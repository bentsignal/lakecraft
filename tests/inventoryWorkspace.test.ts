import assert from "node:assert/strict";
import {
  cloneInventoryWorkspaceStrict,
  createInventoryWorkspace,
  doubleClickGatherToCursor,
  isValidInventoryWorkspace,
  leftClickArmorSlot,
  leftClickInventorySlot,
  leftClickWorkspaceCraftingSlot,
  rightClickArmorSlot,
  rightClickInventorySlot,
  rightClickWorkspaceCraftingSlot,
  shiftClickArmorSlot,
  shiftClickInventorySlot,
  shiftClickWorkspaceCraftingSlot,
  stowInventoryWorkspace,
  takeAllWorkspaceCraftingResultsToInventory,
  takeWorkspaceCraftingResult,
  type InventoryWorkspace,
  type InventoryWorkspaceActionResult,
} from "../shared/inventoryWorkspace.ts";
import {
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  ITEMS,
  createEmptyEquipment,
  createEmptyInventory,
  createItemStack,
  itemStackIdentity,
  type ArmorSlot,
  type Equipment,
  type Inventory,
  type ItemId,
  type ItemStack,
} from "../shared/game.ts";

function stack(itemId: ItemId, count = 1, durability?: number): ItemStack {
  return durability === undefined ? { itemId, count } : { itemId, count, durability };
}

function workspace(inventory = createEmptyInventory(), equipment = createEmptyEquipment(), size: 2 | 3 = 2): InventoryWorkspace {
  return createInventoryWorkspace(inventory, equipment, size);
}

function accepted(result: InventoryWorkspaceActionResult): InventoryWorkspace {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  return result.state;
}

function multiset(state: InventoryWorkspace | { inventory: Inventory; equipment: Equipment }): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (entry: ItemStack | null) => {
    if (!entry) return;
    const identity = itemStackIdentity(entry);
    counts[identity] = (counts[identity] ?? 0) + entry.count;
  };
  state.inventory.forEach(add);
  for (const equipped of Object.values(state.equipment)) add(equipped ? { ...equipped, count: 1 } : null);
  if ("grid" in state) {
    state.grid.forEach(add);
    add(state.cursor);
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

// Creation is strict, detached, and preserves exact durability rather than repairing input.
const sourceInventory = createEmptyInventory();
sourceInventory[0] = stack("planks", 12);
sourceInventory[1] = stack("wooden_pickaxe", 1, 17);
const sourceEquipment = createEmptyEquipment();
sourceEquipment.head = { itemId: "iron_helmet", durability: 31 };
const created = workspace(sourceInventory, sourceEquipment, 3);
assert.deepEqual(created.inventory, sourceInventory);
assert.deepEqual(created.equipment, sourceEquipment);
assert.notEqual(created.inventory, sourceInventory);
assert.notEqual(created.inventory[0], sourceInventory[0]);
assert.notEqual(created.equipment.head, sourceEquipment.head);
created.inventory[0]!.count = 2;
created.equipment.head!.durability = 4;
assert.equal(sourceInventory[0]!.count, 12);
assert.equal(sourceEquipment.head!.durability, 31);
assert.equal(isValidInventoryWorkspace(created), true);
assert.equal(isValidInventoryWorkspace({ ...created, inventory: [stack("planks", 65), ...created.inventory.slice(1)] }), false);
assert.equal(isValidInventoryWorkspace({ ...created, grid: [null] }), false);
assert.equal(isValidInventoryWorkspace({ ...created, cursor: undefined }), false);
assert.equal(isValidInventoryWorkspace({ ...created, equipment: { ...created.equipment, head: { itemId: "iron_boots", durability: 4 } } }), false);
assert.throws(() => cloneInventoryWorkspaceStrict({ ...created, cursor: stack("wooden_pickaxe", 1) }), /Invalid inventory workspace/);

// Left click picks up, places, merges to capacity, leaves remainder, and swaps unlike stacks.
let inventory = createEmptyInventory();
inventory[0] = stack("planks", 10);
let state = workspace(inventory);
state = accepted(leftClickInventorySlot(state, 0));
assert.deepEqual(state.inventory[0], null);
assert.deepEqual(state.cursor, stack("planks", 10));
state = accepted(leftClickInventorySlot(state, 1));
assert.deepEqual(state.inventory[1], stack("planks", 10));
assert.equal(state.cursor, null);
state.inventory[0] = stack("planks", 60);
state.cursor = stack("planks", 10);
state = accepted(leftClickInventorySlot(state, 0));
assert.deepEqual(state.inventory[0], stack("planks", 64));
assert.deepEqual(state.cursor, stack("planks", 6));
state.inventory[2] = stack("dirt", 3);
state = accepted(leftClickInventorySlot(state, 2));
assert.deepEqual(state.inventory[2], stack("planks", 6));
assert.deepEqual(state.cursor, stack("dirt", 3));

// Right click takes the larger half, places one, and never swaps incompatible stacks.
inventory = createEmptyInventory();
inventory[0] = stack("cobblestone", 9);
state = workspace(inventory);
state = accepted(rightClickInventorySlot(state, 0));
assert.deepEqual(state.inventory[0], stack("cobblestone", 4));
assert.deepEqual(state.cursor, stack("cobblestone", 5));
state = accepted(rightClickInventorySlot(state, 1));
assert.deepEqual(state.inventory[1], stack("cobblestone", 1));
assert.deepEqual(state.cursor, stack("cobblestone", 4));
state.inventory[2] = stack("dirt", 1);
const incompatibleRight = rightClickInventorySlot(state, 2);
assert.equal(incompatibleRight.ok, false);
assert.deepEqual(incompatibleRight.state, state);

// Explicit durability is part of identity and survives pickup, swap, merge, and stow.
inventory = createEmptyInventory();
inventory[0] = stack("iron_pickaxe", 1, 91);
inventory[1] = stack("iron_pickaxe", 1, 92);
state = workspace(inventory);
state = accepted(leftClickInventorySlot(state, 0));
state = accepted(leftClickInventorySlot(state, 1));
assert.deepEqual(state.inventory[1], stack("iron_pickaxe", 1, 91));
assert.deepEqual(state.cursor, stack("iron_pickaxe", 1, 92));

// Armor clicks equip, pick up, and swap only an exact matching armor slot.
state = workspace();
state.cursor = stack("diamond_helmet", 1, 101);
state = accepted(leftClickArmorSlot(state, "head"));
assert.deepEqual(state.equipment.head, { itemId: "diamond_helmet", durability: 101 });
assert.equal(state.cursor, null);
state = accepted(rightClickArmorSlot(state, "head"));
assert.deepEqual(state.cursor, stack("diamond_helmet", 1, 101));
assert.equal(state.equipment.head, null);
state.equipment.head = { itemId: "iron_helmet", durability: 74 };
state = accepted(leftClickArmorSlot(state, "head"));
assert.deepEqual(state.equipment.head, { itemId: "diamond_helmet", durability: 101 });
assert.deepEqual(state.cursor, stack("iron_helmet", 1, 74));
assert.equal(leftClickArmorSlot({ ...state, cursor: createItemStack("iron_boots") }, "head").ok, false);

// Shift-click auto-equips armor only when the target is empty; otherwise main and hotbar transfer merge-first.
inventory = createEmptyInventory();
inventory[0] = createItemStack("iron_helmet");
state = accepted(shiftClickInventorySlot(workspace(inventory), 0));
assert.equal(state.inventory[0], null);
assert.deepEqual(state.equipment.head, { itemId: "iron_helmet", durability: ITEMS.iron_helmet.armor!.maxDurability });

inventory = createEmptyInventory();
inventory[0] = stack("planks", 10);
inventory[HOTBAR_SIZE] = stack("planks", 60);
inventory[HOTBAR_SIZE + 1] = stack("dirt", 64);
state = accepted(shiftClickInventorySlot(workspace(inventory), 0));
assert.equal(state.inventory[0], null);
assert.deepEqual(state.inventory[HOTBAR_SIZE], stack("planks", 64), "merge precedes empty-slot placement");
assert.deepEqual(state.inventory[HOTBAR_SIZE + 2], stack("planks", 6));
state = accepted(shiftClickInventorySlot(state, HOTBAR_SIZE + 2));
assert.deepEqual(state.inventory[0], stack("planks", 6));

inventory = createEmptyInventory();
inventory[0] = createItemStack("diamond_helmet");
const worn: Equipment = { ...createEmptyEquipment(), head: { itemId: "iron_helmet", durability: 17 } };
state = accepted(shiftClickInventorySlot(workspace(inventory, worn), 0));
assert.deepEqual(state.equipment.head, worn.head, "occupied equipment is never silently replaced");
assert.equal(state.inventory[0], null);
assert.deepEqual(state.inventory[HOTBAR_SIZE], createItemStack("diamond_helmet"));
state = accepted(shiftClickArmorSlot(state, "head"));
assert.equal(state.equipment.head, null);
assert.deepEqual(state.inventory[HOTBAR_SIZE + 1], stack("iron_helmet", 1, 17));

// Crafting uses the same cursor as inventory and its exact contents stow back into the canonical snapshot.
inventory = createEmptyInventory();
inventory[0] = stack("log", 3);
state = workspace(inventory);
state = accepted(leftClickInventorySlot(state, 0));
state = accepted(rightClickWorkspaceCraftingSlot(state, 0));
assert.deepEqual(state.grid[0], stack("log", 1));
assert.deepEqual(state.cursor, stack("log", 2));
state = accepted(shiftClickWorkspaceCraftingSlot(state, 0));
assert.equal(state.grid[0], null);
assert.deepEqual(state.inventory[HOTBAR_SIZE], stack("log", 1));
state = accepted(rightClickWorkspaceCraftingSlot(state, 0));
state = accepted(leftClickInventorySlot(state, 0));
const crafted = takeWorkspaceCraftingResult(state);
assert.equal(crafted.ok, true);
if (crafted.ok) {
  assert.equal(crafted.recipeId, "planks_from_log");
  assert.deepEqual(crafted.state.cursor, stack("planks", 4));
}

// Shift crafting pins the first recipe instead of chaining into a recipe formed by leftovers.
state = workspace();
state.grid = [stack("planks", 2), stack("planks", 1), stack("planks", 2), stack("planks", 1)];
const pinnedBatch = takeAllWorkspaceCraftingResultsToInventory(state);
assert.equal(pinnedBatch.ok, true);
if (pinnedBatch.ok) {
  assert.equal(pinnedBatch.recipeId, "crafting_table");
  assert.deepEqual(pinnedBatch.crafted, { itemId: "crafting_table", count: 1, batches: 1 });
  assert.deepEqual(pinnedBatch.state.grid, [stack("planks", 1), null, stack("planks", 1), null]);
  assert.deepEqual(pinnedBatch.state.inventory[0], stack("crafting_table", 1));
}

// Double click gathers only exact identity from inventory and grid, capped at max stack.
inventory = createEmptyInventory();
inventory[0] = stack("planks", 20);
inventory[1] = stack("planks", 30);
inventory[2] = stack("dirt", 30);
state = workspace(inventory);
state.grid[0] = stack("planks", 20);
state.cursor = stack("planks", 10);
state = accepted(doubleClickGatherToCursor(state));
assert.deepEqual(state.cursor, stack("planks", 64));
assert.equal(state.inventory[0], null);
assert.equal(state.inventory[1], null);
assert.deepEqual(state.grid[0], stack("planks", 16));
assert.deepEqual(state.inventory[2], stack("dirt", 30));

// Stow is an immutable projection: it publishes grid+cursor in inventory but retains the decomposed local state.
const beforeStow = structuredClone(state);
const stowed = stowInventoryWorkspace(state);
assert.equal(stowed.ok, true);
assert.deepEqual(state, beforeStow);
if (stowed.ok) assert.deepEqual(multiset(stowed.snapshot), multiset(state));

// Insufficient capacity is atomic for both stow and equipped-armor Shift return.
const full = Array.from({ length: INVENTORY_SIZE }, () => stack("dirt", 64));
state = workspace(full);
state.grid[0] = stack("cobblestone", 1);
const impossibleBefore = structuredClone(state);
const impossible = stowInventoryWorkspace(state);
assert.equal(impossible.ok, false);
assert.deepEqual(impossible.ok ? null : impossible.state, impossibleBefore);
assert.deepEqual(state, impossibleBefore);
const fullEquipment = createEmptyEquipment();
fullEquipment.feet = { itemId: "diamond_boots", durability: 43 };
const fullWorn = workspace(full, fullEquipment);
const unequipBlocked = shiftClickArmorSlot(fullWorn, "feet");
assert.equal(unequipBlocked.ok, false);
assert.deepEqual(unequipBlocked.state, fullWorn);

// Invalid indexes are detached no-ops.
const invalidInput = workspace();
const invalidSlot = leftClickInventorySlot(invalidInput, -1);
assert.equal(invalidSlot.ok, false);
assert.notEqual(invalidSlot.state, invalidInput);
assert.deepEqual(invalidSlot.state, invalidInput);

// 1,600 deterministic pseudo-random non-craft actions conserve the exact multiset.
inventory = createEmptyInventory();
const seeds: Array<[number, ItemStack]> = [
  [0, stack("planks", 47)],
  [1, stack("planks", 31)],
  [2, stack("dirt", 64)],
  [3, stack("coal", 23)],
  [4, createItemStack("iron_helmet")],
  [5, stack("iron_pickaxe", 1, 71)],
  [HOTBAR_SIZE, stack("planks", 55)],
  [HOTBAR_SIZE + 1, stack("cobblestone", 38)],
  [HOTBAR_SIZE + 2, createItemStack("diamond_boots")],
  [HOTBAR_SIZE + 3, stack("iron_pickaxe", 1, 72)],
];
for (const [slot, entry] of seeds) inventory[slot] = entry;
state = workspace(inventory, createEmptyEquipment(), 3);
let random = 0x5eedc0de;
const nextRandom = () => {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  return random;
};
const armorSlots: readonly ArmorSlot[] = ["head", "chest", "legs", "feet"];
for (let step = 0; step < 1_600; step += 1) {
  const before = structuredClone(state);
  const conserved = multiset(state);
  const operation = nextRandom() % 10;
  let result: InventoryWorkspaceActionResult;
  if (operation === 0) result = leftClickInventorySlot(state, nextRandom() % state.inventory.length);
  else if (operation === 1) result = rightClickInventorySlot(state, nextRandom() % state.inventory.length);
  else if (operation === 2) result = shiftClickInventorySlot(state, nextRandom() % state.inventory.length);
  else if (operation === 3) result = leftClickArmorSlot(state, armorSlots[nextRandom() % armorSlots.length]);
  else if (operation === 4) result = rightClickArmorSlot(state, armorSlots[nextRandom() % armorSlots.length]);
  else if (operation === 5) result = shiftClickArmorSlot(state, armorSlots[nextRandom() % armorSlots.length]);
  else if (operation === 6) result = leftClickWorkspaceCraftingSlot(state, nextRandom() % state.grid.length);
  else if (operation === 7) result = rightClickWorkspaceCraftingSlot(state, nextRandom() % state.grid.length);
  else if (operation === 8) result = doubleClickGatherToCursor(state);
  else result = shiftClickWorkspaceCraftingSlot(state, nextRandom() % state.grid.length);
  assert.deepEqual(state, before, `operation ${step} mutated its input`);
  state = result.state;
  assert.deepEqual(multiset(state), conserved, `operation ${step} lost or duplicated exact identity`);
  const projection = stowInventoryWorkspace(state);
  assert.equal(projection.ok, true, `reachable workspace ${step} must always stow`);
  if (projection.ok) assert.deepEqual(multiset(projection.snapshot), conserved, `stow ${step} changed exact identity`);
}

console.log("inventory workspace checks passed (1,600 deterministic conservation operations)");
