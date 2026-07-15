import assert from "node:assert/strict";
import {
  ITEMS,
  applyConfirmedToolUse,
  createEmptyInventory,
  createItemStack,
  normalizeInventory,
  remainingItemDurability,
  type ItemId,
  type ItemStack,
} from "../shared/game.ts";
import { validateChestInventoryJson } from "../shared/chests.ts";
import { PLAYER_STATE_VERSION, isValidDurabilitySaveTransition, validatePlayerStateJson } from "../shared/chestTransfers.ts";

const representativeTools = [
  "wooden_pickaxe",
  "stone_axe",
  "iron_shovel",
  "golden_sword",
  "diamond_pickaxe",
] as const;

for (const itemId of representativeTools) {
  const maximum = ITEMS[itemId].tool!.maxDurability;
  const fresh = createItemStack(itemId);
  assert.deepEqual(fresh, { itemId, count: 1, durability: maximum });
  const inventory = createEmptyInventory();
  inventory[0] = fresh;
  const used = applyConfirmedToolUse(inventory, 0, "attack", itemId);
  assert.equal(used.used, true);
  assert.equal(used.broke, false);
  assert.equal(used.remainingDurability, maximum - 1);
  assert.equal(used.inventory[0]?.durability, maximum - 1);
  assert.equal(inventory[0]?.durability, maximum, "wear must not mutate the caller's snapshot");
}

const almostBroken = createEmptyInventory();
almostBroken[2] = { itemId: "stone_pickaxe", count: 1, durability: 1 };
const broken = applyConfirmedToolUse(almostBroken, 2, "mine", "stone_pickaxe");
assert.equal(broken.broke, true);
assert.equal(broken.itemId, "stone_pickaxe");
assert.equal(broken.inventory[2], null, "zero-durability tools are removed instead of persisted");

const swordMining = createEmptyInventory();
swordMining[0] = { itemId: "iron_sword", count: 1, durability: 10 };
assert.equal(applyConfirmedToolUse(swordMining, 0, "mine", "iron_sword").remainingDurability, 8);
assert.equal(applyConfirmedToolUse(swordMining, 0, "attack", "iron_sword").remainingDurability, 9);

const noTool = createEmptyInventory();
noTool[0] = { itemId: "dirt", count: 4 };
assert.equal(applyConfirmedToolUse(noTool, 0, "mine", "dirt").used, false);
assert.deepEqual(applyConfirmedToolUse(noTool, 0, "mine", "dirt").inventory, noTool);

const expectedMismatch = createEmptyInventory();
expectedMismatch[0] = createItemStack("wooden_axe");
assert.equal(applyConfirmedToolUse(expectedMismatch, 0, "mine", "wooden_pickaxe").used, false);

const legacy = normalizeInventory([{ itemId: "diamond_pickaxe", count: 1 }]);
assert.equal(remainingItemDurability(legacy[0]!), ITEMS.diamond_pickaxe.tool!.maxDurability);

const canonical = validatePlayerStateJson(JSON.stringify({
  version: 2,
  inventory: [{ itemId: "iron_pickaxe", count: 1 }],
}));
assert.equal(canonical.ok, true);
if (canonical.ok) {
  assert.equal(canonical.state.version, PLAYER_STATE_VERSION);
  assert.deepEqual(canonical.state.inventory[0], {
    itemId: "iron_pickaxe",
    count: 1,
    durability: ITEMS.iron_pickaxe.tool!.maxDurability,
  });
}

const savedWorn = validatePlayerStateJson(JSON.stringify({
  version: PLAYER_STATE_VERSION,
  inventory: [{ itemId: "iron_pickaxe", count: 1, durability: 37 }],
}));
const savedMoreWorn = validatePlayerStateJson(JSON.stringify({
  version: PLAYER_STATE_VERSION,
  inventory: [{ itemId: "iron_pickaxe", count: 1, durability: 36 }],
}));
const forgedRepair = validatePlayerStateJson(JSON.stringify({
  version: PLAYER_STATE_VERSION,
  inventory: [{ itemId: "iron_pickaxe", count: 1, durability: 250 }],
}));
const craftedAdditional = validatePlayerStateJson(JSON.stringify({
  version: PLAYER_STATE_VERSION,
  inventory: [
    { itemId: "iron_pickaxe", count: 1, durability: 37 },
    { itemId: "iron_pickaxe", count: 1, durability: 250 },
  ],
}));
if (!savedWorn.ok || !savedMoreWorn.ok || !forgedRepair.ok || !craftedAdditional.ok) throw new Error("transition fixtures must validate");
assert.equal(isValidDurabilitySaveTransition(savedWorn.state, savedMoreWorn.state), true);
assert.equal(isValidDurabilitySaveTransition(savedWorn.state, forgedRepair.state), false, "ordinary saves cannot repair tools");
assert.equal(isValidDurabilitySaveTransition(savedWorn.state, craftedAdditional.state), true, "newly crafted tools may enter at full durability");

for (const stack of [
  { itemId: "iron_pickaxe", count: 1, durability: -1 },
  { itemId: "iron_pickaxe", count: 1, durability: 251 },
  { itemId: "iron_pickaxe", count: 2, durability: 200 },
  { itemId: "cobblestone", count: 1, durability: 1 },
] as Array<ItemStack>) {
  assert.equal(validatePlayerStateJson(JSON.stringify({ inventory: [stack] })).ok, false);
  assert.equal(validateChestInventoryJson(JSON.stringify([stack])).ok, false);
}

assert.deepEqual(
  validatePlayerStateJson(JSON.stringify({ version: PLAYER_STATE_VERSION, inventory: [{ itemId: "iron_pickaxe", count: 1 }] })),
  { ok: false, reason: "invalid_inventory" },
  "current-version payloads cannot omit durability to repair a worn tool",
);

for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  if (!ITEMS[itemId].tool) continue;
  assert.ok((ITEMS[itemId].tool?.maxDurability ?? 0) > 0, `${itemId} needs bounded durability`);
}

console.log("lakecraft persistent tool durability tests: ok");
