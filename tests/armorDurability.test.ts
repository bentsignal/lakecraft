import assert from "node:assert/strict";
import {
  ITEMS,
  applyConfirmedArmorDamage,
  createEmptyEquipment,
  createEmptyInventory,
  createItemStack,
  equipArmorFromInventory,
  equippedArmorProtection,
  normalizeEquipment,
  normalizeInventory,
  unequipArmor,
} from "../shared/game.ts";

const ironHelmetMaximum = ITEMS.iron_helmet.armor?.maxDurability ?? 0;
const leatherBootMaximum = ITEMS.leather_boots.armor?.maxDurability ?? 0;
assert.ok(ironHelmetMaximum > 1 && leatherBootMaximum > 1);

assert.deepEqual(
  createItemStack("iron_helmet"),
  { itemId: "iron_helmet", count: 1, durability: ironHelmetMaximum },
  "new armor starts at exact full durability",
);
assert.deepEqual(
  normalizeInventory([{ itemId: "leather_boots", count: 1 }])[0],
  { itemId: "leather_boots", count: 1, durability: leatherBootMaximum },
  "legacy inventory armor migrates to full durability",
);
assert.deepEqual(
  normalizeEquipment({ head: "iron_helmet" }).head,
  { itemId: "iron_helmet", durability: ironHelmetMaximum },
  "legacy equipped armor IDs migrate to full durability",
);
assert.deepEqual(
  normalizeEquipment({ head: { itemId: "iron_helmet", durability: 7 } }).head,
  { itemId: "iron_helmet", durability: 7 },
  "canonical equipped armor retains exact remaining durability",
);

const inventory = createEmptyInventory();
inventory[4] = { itemId: "iron_helmet", count: 1, durability: 7 };
const equipped = equipArmorFromInventory(inventory, createEmptyEquipment(), 4);
assert.equal(equipped.ok, true);
assert.deepEqual(equipped.equipment.head, { itemId: "iron_helmet", durability: 7 });
assert.equal(equipped.inventory[4], null);
assert.equal(equippedArmorProtection(equipped.equipment), ITEMS.iron_helmet.armor?.protection);

const worn = applyConfirmedArmorDamage(equipped.equipment);
assert.deepEqual(worn.equipment.head, { itemId: "iron_helmet", durability: 6 });
assert.deepEqual(worn.damaged, ["head"]);
assert.deepEqual(worn.broken, []);

const unequipped = unequipArmor(equipped.inventory, worn.equipment, "head");
assert.equal(unequipped.ok, true);
assert.deepEqual(unequipped.inventory.find(Boolean), { itemId: "iron_helmet", count: 1, durability: 6 });
assert.equal(unequipped.equipment.head, null);

const breaking = createEmptyEquipment();
breaking.feet = { itemId: "leather_boots", durability: 1 };
const broken = applyConfirmedArmorDamage(breaking);
assert.equal(broken.equipment.feet, null);
assert.deepEqual(broken.broken, [{ slot: "feet", itemId: "leather_boots" }]);
assert.equal(equippedArmorProtection(broken.equipment), 0);

console.log("lakecraft armor durability model tests: ok");
