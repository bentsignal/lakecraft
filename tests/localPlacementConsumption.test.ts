import assert from "node:assert/strict";
import { consumeSelectedPlacementStack } from "../client/singleplayer/localPlacement.ts";
import { createEmptyInventory } from "../shared/game.ts";

const duplicateStacks = createEmptyInventory();
duplicateStacks[0] = { itemId: "planks", count: 1 };
duplicateStacks[8] = { itemId: "planks", count: 12 };
const selectedLast = consumeSelectedPlacementStack(duplicateStacks, 0, "planks");
assert.equal(selectedLast.ok, true);
if (!selectedLast.ok) throw new Error("expected selected placement payment");
assert.equal(selectedLast.inventory[0], null, "the selected final block is consumed");
assert.deepEqual(selectedLast.inventory[8], { itemId: "planks", count: 12 }, "a matching stack elsewhere is untouched");
assert.equal(selectedLast.depleted, true);

const selectedMany = consumeSelectedPlacementStack(duplicateStacks, 8, "planks");
assert.equal(selectedMany.ok, true);
if (!selectedMany.ok) throw new Error("expected selected stack decrement");
assert.deepEqual(selectedMany.inventory[8], { itemId: "planks", count: 11 });
assert.deepEqual(selectedMany.inventory[0], { itemId: "planks", count: 1 });
assert.equal(selectedMany.depleted, false);

for (const rejected of [
  consumeSelectedPlacementStack(duplicateStacks, -1, "planks"),
  consumeSelectedPlacementStack(duplicateStacks, 99, "planks"),
  consumeSelectedPlacementStack(duplicateStacks, 0, "dirt"),
]) {
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.inventory, duplicateStacks, "invalid or mismatched payment is immutable");
}

console.log("single-player exact selected placement consumption tests passed");
