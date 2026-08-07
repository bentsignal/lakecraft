import assert from "node:assert/strict";
import {
  ITEMS,
  createEmptyEquipment,
  createEmptyInventory,
  type Equipment,
} from "../shared/game.ts";
import {
  PLAYER_STATE_VERSION,
  applyChestTransfer,
  isValidDurabilitySaveTransition,
  validatePlayerStateJson,
} from "../shared/chestTransfers.ts";
import { validateChestInventoryJson } from "../shared/chests.ts";
import { applyDropItemToInventory, validateDroppedItemStack } from "../shared/droppedItems.ts";
import { applyFurnaceTransfer, createEmptyFurnace } from "../shared/furnaces.ts";
import { resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";

const ironHelmetMaximum = ITEMS.iron_helmet.armor!.maxDurability;

const canonicalEquipment: Equipment = {
  ...createEmptyEquipment(),
  head: { itemId: "iron_helmet", durability: 17 },
};
const canonical = validatePlayerStateJson(JSON.stringify({
  version: PLAYER_STATE_VERSION,
  inventory: createEmptyInventory(),
  selectedHotbar: 0,
  equipment: canonicalEquipment,
  respawnPoint: null,
  hunger: 20,
}));
assert.equal(canonical.ok, true);
if (!canonical.ok) throw new Error("canonical armor state should validate");

for (const [payload, reason] of [
  [{ version: PLAYER_STATE_VERSION, inventory: createEmptyInventory() }, "invalid_shape"],
  [{ ...canonical.state, equipment: {
    head: "iron_helmet", chest: null, legs: null, feet: null,
  } }, "invalid_equipment"],
  [{ ...canonical.state, equipment: {
    head: { itemId: "iron_helmet", durability: 0 }, chest: null, legs: null, feet: null,
  } }, "invalid_equipment"],
  [{ ...canonical.state, equipment: {
    head: { itemId: "iron_helmet", durability: ironHelmetMaximum + 1 }, chest: null, legs: null, feet: null,
  } }, "invalid_equipment"],
  [{ ...canonical.state, inventory: [{ itemId: "iron_helmet", count: 1 }] }, "invalid_inventory"],
] as const) {
  const result = validatePlayerStateJson(JSON.stringify(payload));
  assert.deepEqual(result, { ok: false, reason });
}

assert.deepEqual(validatePlayerStateJson(JSON.stringify({ ...canonical.state, version: 3 })),
  { ok: false, reason: "invalid_version" });

function validatedState(equipment: Equipment, inventory = createEmptyInventory()) {
  const result = validatePlayerStateJson(JSON.stringify({
    version: PLAYER_STATE_VERSION,
    inventory,
    selectedHotbar: 0,
    equipment,
    respawnPoint: null,
    hunger: 20,
  }));
  if (!result.ok) throw new Error(`invalid transition fixture: ${result.reason}`);
  return result.state;
}

const wornEquipment: Equipment = {
  ...createEmptyEquipment(),
  head: { itemId: "iron_helmet", durability: 17 },
};
const repairedEquipment: Equipment = {
  ...createEmptyEquipment(),
  head: { itemId: "iron_helmet", durability: 18 },
};
assert.equal(
  isValidDurabilitySaveTransition(validatedState(wornEquipment), validatedState(repairedEquipment)),
  false,
  "ordinary saves cannot repair equipped armor",
);

const unequippedInventory = createEmptyInventory();
unequippedInventory[4] = { itemId: "iron_helmet", count: 1, durability: 17 };
assert.equal(
  isValidDurabilitySaveTransition(
    validatedState(wornEquipment),
    validatedState(createEmptyEquipment(), unequippedInventory),
  ),
  true,
  "moving a worn piece between equipment and inventory preserves one durability domain",
);
assert.equal(
  isValidDurabilitySaveTransition(
    validatedState(createEmptyEquipment()),
    validatedState(wornEquipment),
  ),
  false,
  "new worn armor cannot be fabricated",
);
const newlyCraftedEquipment: Equipment = {
  ...createEmptyEquipment(),
  head: { itemId: "iron_helmet", durability: ironHelmetMaximum },
};
assert.equal(
  isValidDurabilitySaveTransition(
    validatedState(createEmptyEquipment()),
    validatedState(newlyCraftedEquipment),
  ),
  true,
  "a newly crafted full-durability piece remains a valid ordinary save",
);

const legacyChestArmor = validateChestInventoryJson(JSON.stringify([{ itemId: "iron_helmet", count: 1 }]));
assert.equal(legacyChestArmor.ok, true);
if (legacyChestArmor.ok) assert.equal(legacyChestArmor.inventory[0]?.durability, ironHelmetMaximum);
const wornChestArmor = validateChestInventoryJson(JSON.stringify([{ itemId: "iron_helmet", count: 1, durability: 17 }]));
assert.equal(wornChestArmor.ok, true);
if (wornChestArmor.ok) assert.deepEqual(wornChestArmor.inventory[0], { itemId: "iron_helmet", count: 1, durability: 17 });
assert.equal(validateChestInventoryJson(JSON.stringify([{ itemId: "iron_helmet", count: 1, durability: 0 }])).ok, false);

const transferPlayer = createEmptyInventory();
transferPlayer[0] = { itemId: "iron_helmet", count: 1, durability: 17 };
const depositedArmor = applyChestTransfer(
  { direction: "to_chest", sourceSlot: 0, count: 1 },
  transferPlayer,
  createEmptyInventory(),
);
assert.equal(depositedArmor.ok, true);
if (depositedArmor.ok) {
  assert.deepEqual(depositedArmor.chestInventory[0], { itemId: "iron_helmet", count: 1, durability: 17 });
  const withdrawnArmor = applyChestTransfer(
    { direction: "from_chest", sourceSlot: 0, count: 1 },
    depositedArmor.playerInventory,
    depositedArmor.chestInventory,
  );
  assert.equal(withdrawnArmor.ok, true);
  if (withdrawnArmor.ok) {
    assert.deepEqual(withdrawnArmor.playerInventory[0], { itemId: "iron_helmet", count: 1, durability: 17 });
  }
}

assert.deepEqual(
  validateDroppedItemStack({ itemId: "iron_helmet", count: 1 }),
  { itemId: "iron_helmet", count: 1, durability: ironHelmetMaximum },
);
assert.deepEqual(
  validateDroppedItemStack({ itemId: "iron_helmet", count: 1, durability: 17 }),
  { itemId: "iron_helmet", count: 1, durability: 17 },
);
assert.equal(validateDroppedItemStack({ itemId: "iron_helmet", count: 1, durability: 0 }), null);

const droppedArmorState = validatedState(createEmptyEquipment(), transferPlayer);
const droppedArmor = applyDropItemToInventory({
  sourceSlot: 0,
  count: 1,
  playerState: droppedArmorState,
});
assert.equal(droppedArmor.ok, true);
if (droppedArmor.ok) {
  assert.deepEqual(droppedArmor.dropped, { itemId: "iron_helmet", count: 1, durability: 17 });
  assert.equal(droppedArmor.inventory[0], null);
}

const now = 1_700_000_000_000;
const furnace = createEmptyFurnace("0:8:0", now);
if (!furnace.ok) throw new Error("furnace fixture should validate");
const furnaceInventory = createEmptyInventory();
furnaceInventory[0] = { itemId: "coal", count: 1 };
furnaceInventory[1] = { itemId: "iron_helmet", count: 1, durability: 17 };
const furnaceTransfer = applyFurnaceTransfer(
  furnace.state,
  furnaceInventory,
  { kind: "deposit_fuel", inventorySlot: 0, count: 1 },
  now,
);
assert.equal(furnaceTransfer.ok, true, "carrying worn armor must not invalidate a furnace transfer");
if (furnaceTransfer.ok) {
  assert.deepEqual(furnaceTransfer.inventory[1], { itemId: "iron_helmet", count: 1, durability: 17 });
}

const worldInventory = createEmptyInventory();
worldInventory[0] = {
  itemId: "wooden_pickaxe",
  count: 1,
  durability: ITEMS.wooden_pickaxe.tool!.maxDurability,
};
worldInventory[1] = { itemId: "iron_helmet", count: 1, durability: 17 };
const worldEdit = resolveWorldBlockOperation({
  operationId: "armor_mine_test_01",
  kind: "mine",
  x: 0,
  y: 8,
  z: 0,
  expectedBlock: "stone",
  selectedHotbar: 0,
  expectedHeldItem: "wooden_pickaxe",
  expectedInventoryRevision: "1",
  expectedChunkRevision: "1",
}, {
  currentBlock: "stone",
  inventory: worldInventory,
  inventoryRevision: "1",
  chunkRevision: "1",
});
assert.equal(worldEdit.ok, true, "carrying worn armor must not invalidate a world edit");
if (worldEdit.ok) {
  assert.deepEqual(worldEdit.effect.inventory[1], { itemId: "iron_helmet", count: 1, durability: 17 });
}

console.log("lakecraft armor persistence and conservation tests: ok");
