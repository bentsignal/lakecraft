import assert from "node:assert/strict";
import {
  BLOCKS,
  ITEMS,
  RECIPES,
  armorProtection,
  attackDamage,
  canHarvestBlock,
  createEmptyInventory,
  getMiningDrop,
  miningSeconds,
  smeltRecipe,
  addItem,
  countItem,
} from "../shared/game.ts";
import {
  CRAFTING_GRID_RECIPES,
  matchCraftingGrid,
  previewCraftingResult,
  type CraftingGrid,
} from "../shared/craftingGrid.ts";
import { BLOCK } from "../client/game/types.ts";
import {
  TERRAIN_MIN_Y,
  createTerrainChunk,
  terrainOreBlock,
} from "../client/game/terrain.ts";
import { blockMaterialColor } from "../client/game/voxelEngine.ts";

assert.equal(BLOCKS.gold_ore.drop, "raw_gold");
assert.equal(BLOCKS.diamond_ore.drop, "diamond");
assert.equal(canHarvestBlock("gold_ore", "stone_pickaxe"), false);
assert.equal(canHarvestBlock("diamond_ore", "golden_pickaxe"), false, "gold remains a wood-level harvest tier");
assert.equal(canHarvestBlock("gold_ore", "iron_pickaxe"), true);
assert.equal(canHarvestBlock("diamond_ore", "diamond_pickaxe"), true);
assert.deepEqual(getMiningDrop("gold_ore", "iron_pickaxe"), { itemId: "raw_gold", count: 1 });
assert.deepEqual(getMiningDrop("diamond_ore", "iron_pickaxe"), { itemId: "diamond", count: 1 });
assert.equal(getMiningDrop("diamond_ore", "stone_pickaxe"), null);

let smeltingInventory = addItem(createEmptyInventory(), "raw_gold", 11).inventory;
smeltingInventory = addItem(smeltingInventory, "coal", 2).inventory;
const smeltedGold = smeltRecipe(smeltingInventory, "gold_ingot");
assert.equal(smeltedGold.ok, true);
if (smeltedGold.ok) {
  assert.equal(countItem(smeltedGold.inventory, "gold_ingot"), 8);
  assert.equal(countItem(smeltedGold.inventory, "raw_gold"), 3);
  assert.equal(countItem(smeltedGold.inventory, "coal"), 1);
}

for (const material of ["golden", "diamond"] as const) {
  for (const kind of ["pickaxe", "axe", "shovel", "sword"] as const) {
    assert.ok(RECIPES.some(({ id }) => id === `${material}_${kind}`));
    assert.ok(CRAFTING_GRID_RECIPES.some(({ id }) => id === `${material}_${kind}`));
  }
  for (const piece of ["helmet", "chestplate", "leggings", "boots"] as const) {
    assert.ok(RECIPES.some(({ id }) => id === `${material}_${piece}`));
    assert.ok(CRAFTING_GRID_RECIPES.some(({ id }) => id === `${material}_${piece}`));
  }
}

const diamondPickaxeGrid: CraftingGrid = [
  { itemId: "diamond", count: 1 }, { itemId: "diamond", count: 1 }, { itemId: "diamond", count: 1 },
  null, { itemId: "stick", count: 1 }, null,
  null, { itemId: "stick", count: 1 }, null,
];
assert.equal(matchCraftingGrid(diamondPickaxeGrid, 3)?.recipe.id, "diamond_pickaxe");
assert.deepEqual(previewCraftingResult(diamondPickaxeGrid, 3)?.output, { itemId: "diamond_pickaxe", count: 1, durability: 1561 });

const mirroredGoldAxeGrid: CraftingGrid = [
  null, { itemId: "gold_ingot", count: 1 }, { itemId: "gold_ingot", count: 1 },
  null, { itemId: "stick", count: 1 }, { itemId: "gold_ingot", count: 1 },
  null, { itemId: "stick", count: 1 }, null,
];
assert.equal(matchCraftingGrid(mirroredGoldAxeGrid, 3)?.recipe.id, "golden_axe");

assert.equal(ITEMS.golden_pickaxe.tool?.tier, "gold");
assert.equal(ITEMS.golden_pickaxe.tool?.maxDurability, 32);
assert.equal(ITEMS.diamond_pickaxe.tool?.tier, "diamond");
assert.equal(ITEMS.diamond_pickaxe.tool?.maxDurability, 1561);
assert.ok(miningSeconds("stone", "golden_pickaxe") < miningSeconds("stone", "diamond_pickaxe"));
assert.ok(miningSeconds("stone", "diamond_pickaxe") < miningSeconds("stone", "iron_pickaxe"));
assert.equal(attackDamage("diamond_sword"), 7);
assert.ok(attackDamage("diamond_sword") > attackDamage("iron_sword"));
assert.deepEqual(
  ["golden_helmet", "golden_chestplate", "golden_leggings", "golden_boots"].map((id) => armorProtection(id as keyof typeof ITEMS)),
  [2, 5, 3, 1],
);
assert.deepEqual(
  ["diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots"].map((id) => armorProtection(id as keyof typeof ITEMS)),
  [3, 8, 6, 3],
);
assert.deepEqual(
  [ITEMS.diamond_helmet.armor?.maxDurability, ITEMS.diamond_chestplate.armor?.maxDurability, ITEMS.diamond_leggings.armor?.maxDurability, ITEMS.diamond_boots.armor?.maxDurability],
  [363, 528, 495, 429],
);

const seed = 7_319;
const first = createTerrainChunk(seed, -1, 0);
const second = createTerrainChunk(seed, -1, 0);
assert.deepEqual([...first], [...second], "ore generation is deterministic for a streamed chunk");
let goldCount = 0;
for (const [key, block] of first) {
  if (block !== BLOCK.GOLD_ORE && block !== BLOCK.DIAMOND_ORE) continue;
  const [, yString] = key.split(",");
  const y = Number(yString);
  if (block === BLOCK.GOLD_ORE) {
    goldCount += 1;
    assert.ok(y >= TERRAIN_MIN_Y + 1 && y <= 20);
  } else {
    diamondCount += 1;
    assert.ok(y >= 1 && y <= 20);
  }
}
assert.ok(goldCount > 0 && goldCount < 96, `bounded gold count: ${goldCount}`);
assert.ok(diamondCount > 0 && diamondCount < 64, `bounded diamond count: ${diamondCount}`);
assert.equal(terrainOreBlock(0, 32, 0, seed), null, "advanced ores never reach the surface");
assert.notDeepEqual(blockMaterialColor(BLOCK.GOLD_ORE), blockMaterialColor(BLOCK.STONE));
assert.notDeepEqual(blockMaterialColor(BLOCK.DIAMOND_ORE), blockMaterialColor(BLOCK.STONE));

console.log(`advanced progression tests passed (${goldCount} gold in chunk -1:0, ${diamondCount} diamond in 64 chunks)`);
