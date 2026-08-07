import assert from "node:assert/strict";
import {
  DEATH_DROP_MAX_HORIZONTAL_OFFSET,
  DEATH_DROP_MAX_ROWS,
  DEATH_DROP_MAX_STACK,
  planDeathDrops,
  validateDeathDropConservation,
} from "../shared/deathDrops.ts";
import {
  INVENTORY_SIZE,
  ITEMS,
  createEmptyEquipment,
  createEmptyInventory,
  type Equipment,
  type Inventory,
  type ItemStack,
} from "../shared/game.ts";

const identity = { eventId: "death_revision_00000017", userId: "user-a" };
const deathPose = { x: 12.25, y: 7, z: -9.5 };
const inventory = createEmptyInventory();
inventory[0] = { itemId: "dirt", count: 50 };
inventory[1] = { itemId: "dirt", count: 20 };
inventory[2] = { itemId: "diamond", count: 64 };
inventory[8] = { itemId: "wooden_pickaxe", count: 1, durability: 7 };
inventory[9] = { itemId: "wooden_pickaxe", count: 1, durability: 7 };
inventory[10] = { itemId: "wooden_pickaxe", count: 1, durability: 31 };
const equipment: Equipment = {
  ...createEmptyEquipment(),
  head: { itemId: "iron_helmet", durability: 23 },
  feet: { itemId: "diamond_boots", durability: 101 },
};

const inventorySnapshot = JSON.stringify(inventory);
const equipmentSnapshot = JSON.stringify(equipment);
const first = planDeathDrops({ identity, inventory, equipment, deathPose });
assert.equal(first.ok, true);
if (!first.ok) throw new Error(first.reason);
assert.equal(JSON.stringify(inventory), inventorySnapshot, "planning cannot mutate canonical inventory");
assert.equal(JSON.stringify(equipment), equipmentSnapshot, "planning cannot mutate canonical equipment");
assert.deepEqual(first.drops.filter(({ stack }) => stack.itemId === "dirt").map(({ stack }) => stack.count), [64, 6]);
assert.equal(first.drops.filter(({ stack }) => stack.itemId === "wooden_pickaxe").length, 3,
  "durable items remain distinct even when item id and remaining durability match");
assert.deepEqual(
  first.drops.filter(({ stack }) => stack.itemId === "wooden_pickaxe").map(({ stack }) => stack.durability),
  [7, 7, 31],
);
assert.ok(first.drops.some(({ stack }) => stack.itemId === "iron_helmet" && stack.durability === 23));
assert.ok(first.drops.some(({ stack }) => stack.itemId === "diamond_boots" && stack.durability === 101));
assert.equal(first.drops.every(({ stack }) => stack.count <= Math.min(DEATH_DROP_MAX_STACK, ITEMS[stack.itemId].maxStack)), true);
assert.equal(first.drops.length <= DEATH_DROP_MAX_ROWS, true);
assert.equal(new Set(first.drops.map(({ operationId }) => operationId)).size, first.drops.length);
assert.equal(new Set(first.drops.map(({ position }) => `${position.x}:${position.z}`)).size, first.drops.length,
  "the 7x7 seeded scatter grid gives every bounded row a distinct horizontal cell");
for (const drop of first.drops) {
  assert.equal(drop.ordinal >= 0 && drop.ordinal < first.drops.length, true);
  assert.match(drop.operationId, /^death_[0-9a-z]{14}_[0-9a-z]{2}$/);
  assert.ok(Math.abs(drop.offset.x) <= DEATH_DROP_MAX_HORIZONTAL_OFFSET);
  assert.ok(Math.abs(drop.offset.z) <= DEATH_DROP_MAX_HORIZONTAL_OFFSET);
  assert.deepEqual({
    x: Math.round((deathPose.x + drop.offset.x) * 1_000) / 1_000,
    y: Math.round((deathPose.y + drop.offset.y) * 1_000) / 1_000,
    z: Math.round((deathPose.z + drop.offset.z) * 1_000) / 1_000,
  }, drop.position);
}
assert.equal(first.carriedState.inventory.length, INVENTORY_SIZE);
assert.equal(first.carriedState.inventory.every((stack) => stack === null), true);
assert.deepEqual(first.carriedState.equipment, createEmptyEquipment());

const replay = planDeathDrops({ identity: { ...identity }, inventory, equipment, deathPose: { ...deathPose } });
assert.deepEqual(replay, first, "an exact Lakebed replay produces byte-equivalent identities, stacks, and offsets");

const otherDeath = planDeathDrops({
  identity: { ...identity, eventId: "death_revision_00000018" }, inventory, equipment, deathPose,
});
assert.equal(otherDeath.ok, true);
if (otherDeath.ok) {
  assert.notEqual(otherDeath.settlementId, first.settlementId);
  assert.notDeepEqual(otherDeath.drops.map(({ operationId }) => operationId), first.drops.map(({ operationId }) => operationId));
  assert.notDeepEqual(otherDeath.drops.map(({ offset }) => offset), first.drops.map(({ offset }) => offset));
}

const reorderedInventory = createEmptyInventory();
reorderedInventory[0] = inventory[10] ? { ...inventory[10] } : null;
reorderedInventory[4] = inventory[1] ? { ...inventory[1] } : null;
reorderedInventory[5] = inventory[9] ? { ...inventory[9] } : null;
reorderedInventory[16] = inventory[2] ? { ...inventory[2] } : null;
reorderedInventory[20] = inventory[0] ? { ...inventory[0] } : null;
reorderedInventory[35] = inventory[8] ? { ...inventory[8] } : null;
assert.deepEqual(
  planDeathDrops({ identity, inventory: reorderedInventory, equipment, deathPose }),
  first,
  "slot ordering cannot alter a coalesced death settlement",
);

assert.deepEqual(
  validateDeathDropConservation(inventory, equipment, first.drops.map(({ stack }) => stack)),
  { ok: true, fingerprint: first.conservationFingerprint },
);
const missingOne = first.drops.map(({ stack }) => ({ ...stack }));
const dirt = missingOne.find((stack) => stack.itemId === "dirt");
if (!dirt) throw new Error("expected dirt");
dirt.count -= 1;
assert.deepEqual(validateDeathDropConservation(inventory, equipment, missingOne), { ok: false, reason: "quantity_mismatch" });
const changedWear = first.drops.map(({ stack }) => ({ ...stack }));
const wornPick = changedWear.find((stack) => stack.itemId === "wooden_pickaxe" && stack.durability === 31);
if (!wornPick) throw new Error("expected pickaxe");
wornPick.durability = 30;
assert.deepEqual(validateDeathDropConservation(inventory, equipment, changedWear), { ok: false, reason: "quantity_mismatch" });
assert.deepEqual(
  validateDeathDropConservation(inventory, equipment, [{ itemId: "wooden_pickaxe", count: 2, durability: 7 } as ItemStack]),
  { ok: false, reason: "invalid_drops" },
  "identical durable items may not be collapsed into an illegal count-two row",
);

const maximumInventory = createEmptyInventory();
for (let index = 0; index < maximumInventory.length; index += 1) {
  maximumInventory[index] = { itemId: "diamond_sword", count: 1, durability: index + 1 };
}
const maximumEquipment: Equipment = {
  head: { itemId: "diamond_helmet", durability: 1 },
  chest: { itemId: "diamond_chestplate", durability: 2 },
  legs: { itemId: "diamond_leggings", durability: 3 },
  feet: { itemId: "diamond_boots", durability: 4 },
};
const maximum = planDeathDrops({ identity, inventory: maximumInventory, equipment: maximumEquipment, deathPose });
assert.equal(maximum.ok, true);
if (maximum.ok) {
  assert.equal(maximum.drops.length, INVENTORY_SIZE + 4);
  assert.equal(maximum.drops.length <= DEATH_DROP_MAX_ROWS, true);
  assert.equal(maximum.drops.every(({ stack }) => stack.count === 1), true);
  assert.equal(new Set(maximum.drops.map(({ position }) => `${position.x}:${position.z}`)).size, maximum.drops.length);
}

const edgeInventory = createEmptyInventory();
edgeInventory[0] = { itemId: "dirt", count: 1 };
const edge = planDeathDrops({
  identity, inventory: edgeInventory, equipment: createEmptyEquipment(),
  deathPose: { x: 1_000_000, y: 192, z: -1_000_000 },
});
assert.equal(edge.ok, true);
if (edge.ok) {
  assert.equal(edge.drops.length, 1);
  assert.ok(edge.drops[0].position.x <= 1_000_000 && edge.drops[0].position.z >= -1_000_000);
  assert.ok(edge.drops[0].position.y <= 192, "scatter positions remain valid at the world ceiling");
}

function expectFailure(
  change: Partial<{ identity: typeof identity; inventory: Inventory; equipment: Equipment; deathPose: typeof deathPose }>,
  reason: string,
): void {
  const result = planDeathDrops({ identity, inventory, equipment, deathPose, ...change });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, reason);
}
expectFailure({ identity: { ...identity, eventId: "" } }, "invalid_event_identity");
expectFailure({ deathPose: { ...deathPose, x: Infinity } }, "invalid_death_pose");
expectFailure({ inventory: inventory.slice(0, -1) }, "invalid_inventory");
const overstacked = createEmptyInventory();
overstacked[0] = { itemId: "dirt", count: 65 };
expectFailure({ inventory: overstacked }, "invalid_inventory");
const legacyDurable = createEmptyInventory();
legacyDurable[0] = { itemId: "wooden_pickaxe", count: 1 };
expectFailure({ inventory: legacyDurable }, "invalid_inventory");
expectFailure({
  equipment: { ...createEmptyEquipment(), head: { itemId: "diamond_boots", durability: 1 } } as Equipment,
}, "invalid_equipment");

const sparse = new Array(INVENTORY_SIZE) as Inventory;
expectFailure({ inventory: sparse }, "invalid_inventory");

console.log("lakecraft deterministic conserved death-drop model tests: ok");
