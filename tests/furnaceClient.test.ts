import assert from "node:assert/strict";
import { isCraftingTableWithinReach } from "../client/crafting.ts";
import { tryInteractBlock } from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockTarget } from "../client/game/types.ts";
import { addItem, countItem, createEmptyInventory, smeltRecipe } from "../shared/game.ts";

const furnaceTarget: BlockTarget = {
  block: { x: 3, y: 4, z: 5, block: BLOCK.FURNACE },
  place: { x: 3, y: 4, z: 6 },
  distance: 3,
};
let opened = false;
assert.equal(tryInteractBlock(furnaceTarget, () => {
  opened = true;
  return true;
}), true, "secondary use dispatches the furnace client workflow");
assert.equal(opened, true);

let inventory = addItem(createEmptyInventory(), "raw_iron", 8).inventory;
inventory = addItem(inventory, "coal", 1).inventory;
const fired = smeltRecipe(inventory, "iron_ingot");
assert.equal(fired.ok, true);
if (fired.ok) {
  assert.equal(fired.smelted.count, 8, "the drawer workflow reflects one-coal batch firing");
  assert.equal(countItem(fired.inventory, "raw_iron"), 0);
  assert.equal(countItem(fired.inventory, "coal"), 0);
  assert.equal(countItem(fired.inventory, "iron_ingot"), 8);
}

const station = { x: 3, y: 4, z: 5 };
assert.equal(isCraftingTableWithinReach({ x: 3.5, y: 4.5, z: 5.5 }, station), true);
assert.equal(isCraftingTableWithinReach({ x: 11, y: 4.5, z: 5.5 }, station), false, "leaving station reach closes the furnace drawer");

console.log("lakecraft furnace client integration tests: ok");
