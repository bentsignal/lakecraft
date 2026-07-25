import assert from "node:assert/strict";
import { createEmptyInventory, type Inventory } from "../shared/game.ts";
import {
  createLocalContainers,
  exportLocalContainersSnapshot,
  importLocalContainersSnapshot,
  materializeLocalFurnace,
  openLocalChest,
  openLocalFurnace,
  recoverLocalContainerContents,
  removeLocalContainersAt,
  transferLocalChestFullStack,
  transferLocalFurnaceFullStack,
} from "../client/singleplayer/localContainers.ts";

let containers = createLocalContainers();
let inventory: Inventory = createEmptyInventory();
inventory[0] = { itemId: "brick", count: 32 };

const chest = openLocalChest(containers, "4:8:-3");
assert.equal(chest.ok, true);
if (!chest.ok) throw new Error(chest.reason);
containers = chest.containers;
assert.equal(chest.created, true);

const deposited = transferLocalChestFullStack(containers, "4:8:-3", inventory, {
  direction: "to_chest", sourceSlot: 0,
});
assert.equal(deposited.ok, true);
if (!deposited.ok) throw new Error(deposited.reason);
containers = deposited.containers;
inventory = deposited.inventory;
assert.equal(inventory[0], null);
assert.deepEqual(deposited.moved, { itemId: "brick", count: 32 });

const withdrawn = transferLocalChestFullStack(containers, "4:8:-3", inventory, {
  direction: "from_chest", sourceSlot: 0,
});
assert.equal(withdrawn.ok, true);
if (!withdrawn.ok) throw new Error(withdrawn.reason);
containers = withdrawn.containers;
inventory = withdrawn.inventory;
assert.deepEqual(inventory[0], { itemId: "brick", count: 32 });

inventory[1] = { itemId: "raw_iron", count: 2 };
inventory[2] = { itemId: "coal", count: 1 };
const furnace = openLocalFurnace(containers, "6:8:-3", 1_000);
assert.equal(furnace.ok, true);
if (!furnace.ok) throw new Error(furnace.reason);
containers = furnace.containers;

const input = transferLocalFurnaceFullStack(containers, "6:8:-3", inventory, {
  kind: "deposit_input", inventorySlot: 1,
}, 1_000);
assert.equal(input.ok, true);
if (!input.ok) throw new Error(input.reason);
containers = input.containers;
inventory = input.inventory;

const fuel = transferLocalFurnaceFullStack(containers, "6:8:-3", inventory, {
  kind: "deposit_fuel", inventorySlot: 2,
}, 1_000);
assert.equal(fuel.ok, true);
if (!fuel.ok) throw new Error(fuel.reason);
containers = fuel.containers;
inventory = fuel.inventory;

const cooked = materializeLocalFurnace(containers, "6:8:-3", 21_000);
assert.equal(cooked.ok, true);
if (!cooked.ok) throw new Error(cooked.reason);
containers = cooked.containers;
assert.equal(cooked.cooked, 2);
assert.deepEqual(cooked.furnace.output, { itemId: "iron_ingot", count: 2 });

const storedForBreak = transferLocalChestFullStack(containers, "4:8:-3", inventory, {
  direction: "to_chest", sourceSlot: 0,
});
assert.equal(storedForBreak.ok, true);
if (!storedForBreak.ok) throw new Error(storedForBreak.reason);
containers = storedForBreak.containers;
inventory = storedForBreak.inventory;

const exported = exportLocalContainersSnapshot(containers);
assert.equal(exported.ok, true);
if (!exported.ok) throw new Error(exported.reason);
const roundTrip = importLocalContainersSnapshot(JSON.parse(JSON.stringify(exported.snapshot)));
assert.equal(roundTrip.ok, true);
if (!roundTrip.ok) throw new Error(roundTrip.reason);
assert.deepEqual(roundTrip.snapshot, exported.snapshot);

assert.equal(importLocalContainersSnapshot({ ...exported.snapshot, extra: true }).ok, false, "extra fields fail closed");
const duplicate = { chests: [exported.snapshot.chests[0], exported.snapshot.chests[0]], furnaces: [] };
assert.equal(importLocalContainersSnapshot(duplicate).ok, false, "duplicate coordinates fail closed");

const fullPack = Array.from({ length: 36 }, () => ({ itemId: "dirt" as const, count: 64 }));
const blockedRecovery = recoverLocalContainerContents(roundTrip.containers, "4:8:-3", fullPack, 0, 21_000);
assert.equal(blockedRecovery.ok, false, "a full drop pool cannot silently erase chest contents");
assert.equal(blockedRecovery.containers.chests.has("4:8:-3"), true, "failed recovery preserves the original container row");

const recovered = recoverLocalContainerContents(roundTrip.containers, "4:8:-3", fullPack, 1, 21_000);
assert.equal(recovered.ok, true);
if (!recovered.ok) throw new Error(recovered.reason);
assert.deepEqual(recovered.overflow, [{ itemId: "brick", count: 32 }]);
assert.equal(recovered.containers.chests.has("4:8:-3"), false);
assert.equal(recovered.recovered.reduce((sum, stack) => sum + stack.count, 0), 32);

const removed = removeLocalContainersAt(recovered.containers, "6:8:-3");
assert.equal(removed.ok, true);
if (!removed.ok) throw new Error(removed.reason);
assert.equal(removed.removedChest, false);
assert.equal(removed.removedFurnace, true);

console.log("local chest/furnace conservation, elapsed cooking, strict snapshot, and removal tests passed");
