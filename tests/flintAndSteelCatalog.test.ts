import assert from "node:assert/strict";
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
import { remoteHeldItemRects, remoteHeldItemVertexCount } from "../client/game/remotePlayerRenderer.ts";
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
const samples = Array.from({ length: 200 }, (_, x) => getDeterministicMiningDrop("gravel", "wooden_shovel", x - 100, 4, 27)?.itemId);
assert.ok(samples.includes("flint"), "a bounded terrain sample contains deterministic flint");
assert.ok(samples.includes("gravel"), "flint replaces only a subset of ordinary gravel drops");
assert.deepEqual(samples, Array.from({ length: 200 }, (_, x) => getDeterministicMiningDrop("gravel", "wooden_shovel", x - 100, 4, 27)?.itemId));
const flintX = samples.findIndex((drop) => drop === "flint") - 100;
assert.deepEqual(getDeterministicMiningDrop("gravel", null, flintX, 4, 27), { itemId: "gravel", count: 1 }, "hands do not trigger the shovel-specific flint rule");
assert.deepEqual(getDeterministicMiningDrop("gravel", "wooden_pickaxe", flintX, 4, 27), { itemId: "gravel", count: 1 });
assert.deepEqual(getDeterministicMiningDrop("sand", "wooden_shovel", flintX, 4, 27), { itemId: "sand", count: 1 }, "sand always remains sand");
assert.deepEqual(getDeterministicMiningDrop("stone", "wooden_pickaxe", flintX, 4, 27), { itemId: "cobblestone", count: 1 });
const miningInventory = createEmptyInventory();
miningInventory[0] = { itemId: "wooden_shovel", count: 1, durability: 20 };
const authoritativeMine = resolveWorldBlockOperation({
  operationId: "flint_mine_test_0001",
  kind: "mine",
  x: flintX,
  y: 4,
  z: 27,
  expectedBlock: "gravel",
  selectedHotbar: 0,
  expectedHeldItem: "wooden_shovel",
  expectedInventoryRevision: "0",
  expectedChunkRevision: "0",
}, {
  currentBlock: "gravel",
  inventory: miningInventory,
  inventoryRevision: "0",
  chunkRevision: "0",
});
assert.equal(authoritativeMine.ok, true);
if (authoritativeMine.ok) {
  assert.deepEqual(authoritativeMine.effect.drop, { itemId: "flint", count: 1 });
  assert.equal(authoritativeMine.effect.inventory.some((stack) => stack?.itemId === "flint" && stack.count === 1), true);
  assert.equal(authoritativeMine.effect.inventory.some((stack) => stack?.itemId === "gravel"), false, "one mined block conserves one drop");
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
const strikerCells = new Set<string>();
for (const run of strikerArt.runs) for (let x = run.x; x < run.x + run.width; x += 1) strikerCells.add(`${x}:${run.y}`);
const pending = [strikerCells.values().next().value!];
const connected = new Set(pending);
while (pending.length > 0) {
  const [x, y] = pending.pop()!.split(":").map(Number);
  for (const next of [`${x - 1}:${y}`, `${x + 1}:${y}`, `${x}:${y - 1}`, `${x}:${y + 1}`]) {
    if (strikerCells.has(next) && !connected.has(next)) { connected.add(next); pending.push(next); }
  }
}
assert.ok(flintArt.runs.length >= 8);
assert.ok(strikerArt.runs.length >= 8);
assert.notDeepEqual(flintArt.runs, getItemIconArt("coal").runs);
assert.notDeepEqual(strikerArt.runs, getItemIconArt("iron_ingot").runs);
assert.equal(strikerArt.family, "tool", "held first-person presentation uses the tool-sized sprite rig");
assert.equal(connected.size, strikerCells.size, "the steel hook touches one contiguous flint mass");
for (const cell of ["5:2", "10:2", "3:5", "4:11", "8:6", "11:8"]) {
  assert.ok(strikerCells.has(cell), `flint-and-steel retains hook or flint landmark ${cell}`);
}
for (const cell of ["6:5", "5:9", "2:7", "12:7", "15:15"]) {
  assert.equal(strikerCells.has(cell), false, `flint-and-steel preserves compact C-notch negative space at ${cell}`);
}

const remoteStriker = remoteHeldItemRects("flint_and_steel");
assert.equal(remoteHeldItemVertexCount("flint_and_steel"), remoteStriker.length * 6);
assert.ok(remoteStriker.length >= 8, "remote players retain a recognizable bounded striker silhouette");
assert.ok(new Set(remoteStriker.map((rect) => rect.color.join(","))).size >= 3,
  "remote striker reuses the canonical multicolor flint-and-steel palette");

console.log("flint, flint-and-steel crafting, durability, drop, and visual tests passed");
