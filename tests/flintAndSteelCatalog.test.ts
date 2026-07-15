import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CRAFTING_GRID_RECIPES, INITIAL_RECIPE_PATTERNS, matchCraftingGrid } from "../shared/craftingGrid.ts";
import {
  FLINT_DROP_CHANCE_DENOMINATOR,
  ITEMS,
  RECIPES,
  applyConfirmedDurableItemUse,
  createEmptyInventory,
  createItemStack,
  getDeterministicMiningDrop,
  maxItemDurability,
} from "../shared/game.ts";
import { getItemIconArt } from "../client/components/itemIconArt.ts";
import { resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";

assert.equal(ITEMS.flint.category, "material");
assert.equal(ITEMS.flint.maxStack, 64);
assert.equal(ITEMS.flint_and_steel.category, "tool");
assert.equal(ITEMS.flint_and_steel.maxStack, 1);
assert.equal(maxItemDurability("flint_and_steel"), 64, "flint and steel has Minecraft's 64-use durability");
assert.deepEqual(createItemStack("flint_and_steel"), { itemId: "flint_and_steel", count: 1, durability: 64 });

const pattern = INITIAL_RECIPE_PATTERNS.flint_and_steel;
assert.deepEqual(pattern, {
  kind: "shaped",
  pattern: [["iron_ingot", null], [null, "flint"]],
  allowHorizontalMirror: true,
}, "the compact player grid uses the requested diagonal iron/flint silhouette");
assert.equal(RECIPES.find(({ id }) => id === "flint_and_steel")?.craftingContext, "field");
assert.deepEqual(RECIPES.find(({ id }) => id === "flint_and_steel")?.ingredients, [
  { itemId: "iron_ingot", count: 1 },
  { itemId: "flint", count: 1 },
]);
assert.equal(matchCraftingGrid([
  { itemId: "iron_ingot", count: 1 }, null,
  null, { itemId: "flint", count: 1 },
], 2)?.recipe.id, "flint_and_steel");
assert.equal(matchCraftingGrid([
  null, { itemId: "iron_ingot", count: 1 },
  { itemId: "flint", count: 1 }, null,
], 2)?.recipe.id, "flint_and_steel", "the opposite diagonal is accepted");
assert.ok(CRAFTING_GRID_RECIPES.some(({ id }) => id === "flint_and_steel"));

assert.equal(FLINT_DROP_CHANCE_DENOMINATOR, 10);
const samples = Array.from({ length: 200 }, (_, x) => getDeterministicMiningDrop("sand", "wooden_shovel", x - 100, 4, 27)?.itemId);
assert.ok(samples.includes("flint"), "a bounded terrain sample contains deterministic flint");
assert.ok(samples.includes("sand"), "flint replaces only a subset of ordinary sand drops");
assert.deepEqual(samples, Array.from({ length: 200 }, (_, x) => getDeterministicMiningDrop("sand", "wooden_shovel", x - 100, 4, 27)?.itemId));
const flintX = samples.findIndex((drop) => drop === "flint") - 100;
assert.deepEqual(getDeterministicMiningDrop("sand", null, flintX, 4, 27), { itemId: "sand", count: 1 }, "hands cannot trigger the surrogate gravel rule");
assert.deepEqual(getDeterministicMiningDrop("sand", "wooden_pickaxe", flintX, 4, 27), { itemId: "sand", count: 1 });
assert.deepEqual(getDeterministicMiningDrop("stone", "wooden_pickaxe", flintX, 4, 27), { itemId: "cobblestone", count: 1 });
const miningInventory = createEmptyInventory();
miningInventory[0] = { itemId: "wooden_shovel", count: 1, durability: 20 };
const authoritativeMine = resolveWorldBlockOperation({
  operationId: "flint_mine_test_0001",
  kind: "mine",
  x: flintX,
  y: 4,
  z: 27,
  expectedBlock: "sand",
  selectedHotbar: 0,
  expectedHeldItem: "wooden_shovel",
  expectedInventoryRevision: "0",
  expectedChunkRevision: "0",
}, {
  currentBlock: "sand",
  inventory: miningInventory,
  inventoryRevision: "0",
  chunkRevision: "0",
});
assert.equal(authoritativeMine.ok, true);
if (authoritativeMine.ok) {
  assert.deepEqual(authoritativeMine.effect.drop, { itemId: "flint", count: 1 });
  assert.equal(authoritativeMine.effect.inventory.some((stack) => stack?.itemId === "flint" && stack.count === 1), true);
  assert.equal(authoritativeMine.effect.inventory.some((stack) => stack?.itemId === "sand"), false, "one mined block conserves one drop");
}

const inventory = createEmptyInventory();
inventory[2] = { itemId: "flint_and_steel", count: 1, durability: 2 };
const first = applyConfirmedDurableItemUse(inventory, 2, "flint_and_steel");
assert.deepEqual(first.inventory[2], { itemId: "flint_and_steel", count: 1, durability: 1 });
assert.equal(first.used, true);
assert.equal(first.broke, false);
assert.deepEqual(inventory[2], { itemId: "flint_and_steel", count: 1, durability: 2 }, "durability use is immutable");
const last = applyConfirmedDurableItemUse(first.inventory, 2, "flint_and_steel");
assert.equal(last.inventory[2], null);
assert.equal(last.broke, true);
assert.equal(last.remainingDurability, 0);
assert.equal(applyConfirmedDurableItemUse(inventory, 2, "bow").used, false, "authority can bind a use to the expected item ID");

const flintArt = getItemIconArt("flint");
const strikerArt = getItemIconArt("flint_and_steel");
assert.ok(flintArt.runs.length >= 8);
assert.ok(strikerArt.runs.length >= 8);
assert.notDeepEqual(flintArt.runs, getItemIconArt("coal").runs);
assert.notDeepEqual(strikerArt.runs, getItemIconArt("iron_ingot").runs);
assert.equal(strikerArt.family, "tool", "held first-person presentation uses the tool-sized sprite rig");

const remote = readFileSync(new URL("../client/game/remotePlayerRenderer.ts", import.meta.url), "utf8");
assert.match(remote, /case\s+"flint_and_steel":\s*return\s+COLORS\.ironItem/);
assert.match(remote, /if\s*\(itemId\s*===\s*"flint_and_steel"\)/, "remote players receive an explicit two-part striker silhouette");

console.log("flint, flint-and-steel crafting, durability, drop, and visual tests passed");
