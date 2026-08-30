export const HOTBAR_SIZE = 9;
/** Minecraft-style player storage: three 9-wide pack rows plus the 9-slot hotbar. */
export const INVENTORY_SIZE = 36;
export const MAX_HUNGER = 20;
export const MAX_HEALTH = 20;
export const HUNGER_POINT_INTERVAL_SECONDS = 45;
export const HEALTH_RECOVERY_INTERVAL_SECONDS = 4;
export const STARVATION_DAMAGE_INTERVAL_SECONDS = 4;
export const MAX_SURVIVAL_STEP_SECONDS = 5;
export const STARVATION_MIN_HEALTH = 1;

import {
  WOOD_FAMILY_DEFINITIONS,
  WOOD_PLANK_ITEM_IDS,
  WOOL_ITEM_IDS,
  type ExpandedBlockItemId,
  type WoodFamilyDefinition,
} from "./expandedBuildingCatalog.ts";

export type BlockId = "grass" | "dirt" | "stone" | "cobblestone" | "sand" | "gravel" | "glass" | "coal_ore" | "iron_ore" | "gold_ore" | "diamond_ore" | "log" | "leaves" | "planks" | "crafting_table" | "furnace" | "torch" | "chest" | "door" | "bed" | "ladder" | "tnt" | "wool" | "sapling" | "stone_bricks" | "oak_fence" | "oak_fence_gate" | "stone_brick_slab" | "clay" | "bricks" | "oak_slab" | "cobblestone_slab" | "brick_slab" | "oak_stairs" | "cobblestone_stairs" | "stone_brick_stairs" | "brick_stairs" | ExpandedBlockItemId;
export type ToolId =
  | "wooden_pickaxe"
  | "wooden_axe"
  | "wooden_shovel"
  | "wooden_sword"
  | "stone_pickaxe"
  | "stone_axe"
  | "stone_shovel"
  | "stone_sword"
  | "iron_pickaxe"
  | "iron_axe"
  | "iron_shovel"
  | "iron_sword"
  | "golden_pickaxe"
  | "golden_axe"
  | "golden_shovel"
  | "golden_sword"
  | "diamond_pickaxe"
  | "diamond_axe"
  | "diamond_shovel"
  | "diamond_sword";
export type ArmorId =
  | "leather_helmet"
  | "leather_chestplate"
  | "leather_leggings"
  | "leather_boots"
  | "iron_helmet"
  | "iron_chestplate"
  | "iron_leggings"
  | "iron_boots"
  | "golden_helmet"
  | "golden_chestplate"
  | "golden_leggings"
  | "golden_boots"
  | "diamond_helmet"
  | "diamond_chestplate"
  | "diamond_leggings"
  | "diamond_boots";
export type ItemId = BlockId
  | "stick"
  | "string"
  | "bone"
  | "bone_meal"
  | "feather"
  | "arrow"
  | "bow"
  | "leather"
  | "coal"
  | "charcoal"
  | "raw_iron"
  | "iron_ingot"
  | "raw_gold"
  | "gold_ingot"
  | "diamond"
  | "gunpowder"
  | "flint"
  | "clay_ball"
  | "brick"
  | "flint_and_steel"
  | "shears"
  | "apple"
  | "pork"
  | "beef"
  | "mutton"
  | "raw_chicken"
  | "cooked_pork"
  | "cooked_beef"
  | "cooked_mutton"
  | "cooked_chicken"
  | "rotten_flesh"
  | "bucket"
  | "water_bucket"
  | "lava_bucket"
  | ToolId
  | ArmorId;
export type ToolKind = "hand" | "pickaxe" | "axe" | "shovel" | "sword";
export type ToolTier = "none" | "wood" | "gold" | "stone" | "iron" | "diamond";
export type CraftingContext = "field" | "crafting_table";
export type ArmorSlot = "head" | "chest" | "legs" | "feet";
export type ArmorStack = { itemId: ArmorId; durability: number };
export type Equipment = Record<ArmorSlot, ArmorStack | null>;

export type BlockDefinition = {
  id: BlockId;
  label: string;
  description: string;
  color: string;
  accent: string;
  hardness: number;
  preferredTool: ToolKind;
  requiredDropTool?: { kind: Exclude<ToolKind, "hand">; minimumTier: Exclude<ToolTier, "none"> };
  drop: ItemId | null;
};

export type ItemDefinition = {
  id: ItemId;
  label: string;
  shortLabel: string;
  description: string;
  category: "block" | "material" | "tool" | "armor" | "food";
  maxStack: number;
  glyph: string;
  color: string;
  placesBlock?: BlockId | "water" | "lava";
  tool?: { kind: Exclude<ToolKind, "hand">; tier: Exclude<ToolTier, "none">; attackDamage: number; maxDurability: number };
  armor?: { slot: ArmorSlot; protection: number; maxDurability: number };
  ranged?: { maxDurability: number; maxChargeMs: number };
  /** Durable non-combat utility items, such as flint and steel. */
  utility?: { maxDurability: number };
  food?: { hunger: number };
};

/**
 * Remaining durability is stored for tools and armor. Legacy equipment and
 * item stacks omit the field and are migrated to full durability below.
 */
export type ItemStack = { itemId: ItemId; count: number; durability?: number };
export type Inventory = Array<ItemStack | null>;
export type ItemQuantity = { itemId: ItemId; count: number };
export type RecipeIngredientTag = "wooden_planks" | "wool";
export type RecipeIngredient = ItemQuantity & { tag?: RecipeIngredientTag };

export const RECIPE_ITEM_TAGS: Readonly<Record<RecipeIngredientTag, readonly ItemId[]>> = {
  wooden_planks: WOOD_PLANK_ITEM_IDS,
  wool: WOOL_ITEM_IDS,
};

export function isItemInRecipeTag(itemId: ItemId, tag: RecipeIngredientTag): boolean {
  return RECIPE_ITEM_TAGS[tag].includes(itemId);
}

export type FoodConsumptionResult =
  | { ok: true; inventory: Inventory; hunger: number; consumed: ItemId; restored: number }
  | { ok: false; inventory: Inventory; hunger: number; reason: "invalid_slot" | "empty_slot" | "not_food" | "hunger_full" };

/**
 * Transient client-side timing state for the survival loop. Only `hunger` is
 * persisted; the progress fields deliberately reset when a play session starts.
 */
export type SurvivalTickState = {
  hunger: number;
  health: number;
  hungerProgressSeconds: number;
  recoveryProgressSeconds: number;
  starvationProgressSeconds: number;
};

export type SurvivalTickResult = {
  state: SurvivalTickState;
  hungerLost: number;
  healthRecovered: number;
  starvationDamage: number;
};

export type Recipe = {
  id: string;
  label: string;
  note: string;
  craftingContext: CraftingContext;
  ingredients: RecipeIngredient[];
  output: ItemQuantity;
};

export type CraftResult =
  | { ok: true; inventory: Inventory; crafted: ItemQuantity }
  | { ok: false; inventory: Inventory; reason: "missing_ingredients" | "inventory_full" | "unknown_recipe" | "requires_crafting_table" };

export type SmeltingRecipe = {
  id: string;
  label: string;
  input: ItemId;
  output: ItemId;
};

export type SmeltResult =
  | { ok: true; inventory: Inventory; smelted: ItemQuantity; fuelConsumed: 1 }
  | { ok: false; inventory: Inventory; reason: "missing_input" | "missing_fuel" | "inventory_full" | "unknown_recipe" };

export type SerializablePlayerState = {
  version: 4;
  inventory: Inventory;
  selectedHotbar: number;
  equipment: Equipment;
  respawnPoint: PlayerRespawnPoint | null;
  hunger: number;
};

export type PlayerRespawnPoint = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type EquipResult =
  | { ok: true; inventory: Inventory; equipment: Equipment }
  | { ok: false; inventory: Inventory; equipment: Equipment; reason: "not_armor" | "empty_slot" | "inventory_full" };

type BlockSpec = readonly [
  id: BlockId,
  label: string,
  description: string,
  color: string,
  accent: string,
  hardness: number,
  preferredTool: ToolKind,
  drop: ItemId | null,
  minimumTier?: Exclude<ToolTier, "none">,
];

function defineBlocks(specs: readonly BlockSpec[]): Record<BlockId, BlockDefinition> {
  return Object.fromEntries(specs.map(([
    id, label, description, color, accent, hardness, preferredTool, drop, minimumTier,
  ]) => { const resolvedLabel = label || id.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "); return [id, {
    id,
    label: resolvedLabel,
    description: description || `${resolvedLabel} building block.`,
    color,
    accent,
    hardness,
    preferredTool,
    ...(minimumTier ? { requiredDropTool: { kind: "pickaxe" as const, minimumTier } } : {}),
    drop,
  }]; })) as Record<BlockId, BlockDefinition>;
}

export const BLOCKS = defineBlocks([
  ["grass", "Grass", "A living cap over packed earth.", "#718447", "#a7b76a", 0.75, "shovel", "dirt"],
  ["dirt", "Dirt", "Soft earth for quick shelter walls.", "#7f5638", "#ad7951", 0.65, "shovel", "dirt"],
  ["stone", "Stone", "Dense natural stone. A pickaxe breaks it into cobblestone.", "#6d7069", "#9a9c91", 2.5, "pickaxe", "cobblestone", "wood"],
  ["cobblestone", "Cobblestone", "Rough quarried stone for sturdy shelters and furnaces.", "#686b65", "#979a91", 2, "pickaxe", "cobblestone", "wood"],
  ["sand", "Sand", "Loose pale grains that can be fired into glass.", "#c7b77b", "#e4d69a", 0.5, "shovel", "sand"],
  ["gravel", "Gravel", "Loose stone fragments found in underground pockets. Shoveling it can reveal flint.", "#77736d", "#aaa49b", 0.6, "shovel", "gravel"],
  ["glass", "Glass", "Clear fired panes for windows and bright shelters.", "#9fc7c1", "#d6efeb", 0.3, "hand", "glass"],
  ["coal_ore", "Coal Ore", "Coal flecks trapped in stone. A wooden pickaxe can recover the fuel.", "#565852", "#242621", 3, "pickaxe", "coal", "wood"],
  ["iron_ore", "Iron Ore", "Rust-colored ore that needs a stone pickaxe before it can be smelted.", "#77776f", "#b57c5d", 3.2, "pickaxe", "raw_iron", "stone"],
  ["gold_ore", "Gold Ore", "Deep stone threaded with gold. An iron pickaxe is required to recover it.", "#77776f", "#e5bc35", 3, "pickaxe", "raw_gold", "iron"],
  ["diamond_ore", "Diamond Ore", "Rare deep stone crystals that drop diamonds when mined with iron or better.", "#6f7472", "#42d9d2", 3, "pickaxe", "diamond", "iron"],
  ["log", "Oak Log", "Fresh timber. An axe speeds the work.", "#76502f", "#bd8a50", 1.6, "axe", "log"],
  ["leaves", "Oak Leaves", "A loose, mossy canopy block.", "#4e6f3d", "#7c9953", 0.3, "hand", "leaves"],
  ["planks", "Oak Planks", "Squared boards for building and tools.", "#a87841", "#d0a45e", 1.1, "axe", "planks"],
  ["crafting_table", "Crafting Table", "A sturdy workbench for more involved recipes.", "#8a5b32", "#d39a54", 1.4, "axe", "crafting_table"],
  ["furnace", "Furnace", "A stone furnace that turns ore and raw meat into useful supplies.", "#5f625d", "#a0a39b", 3.5, "pickaxe", "furnace", "wood"],
  ["torch", "Torch", "A warm light for shelters and night trails.", "#d99a3d", "#ffd36a", 0.1, "hand", "torch"],
  ["chest", "Chest", "A shared wooden container for supplies.", "#8b5728", "#dca14d", 1.8, "axe", "chest"],
  ["door", "Oak Door", "A hinged wooden door for a shelter entrance.", "#9a6832", "#d7a35c", 1.4, "axe", "door"],
  ["bed", "Bed", "A wool bed that can vote to skip the night.", "#b85045", "#eee2c4", 0.5, "hand", "bed"],
  ["ladder", "Ladder", "Wooden rungs for climbing walls and mine shafts.", "#a97742", "#d6aa68", 0.4, "axe", "ladder"],
  ["tnt", "TNT", "A volatile block crafted from sand and gunpowder. It only explodes after an explicit ignition.", "#b73529", "#f0e1bd", 0.1, "hand", "tnt"],
  ["wool", "White Wool", "A soft building block clipped from sheep.", "#ddd8c8", "#f3f0e7", 0.8, "hand", "wool"],
  ["sapling", "Oak Sapling", "A young oak that can grow on dirt or grass.", "#477537", "#82a94e", 0, "hand", "sapling"],
  ["stone_bricks", "Stone Bricks", "Cut stone blocks fitted into a durable masonry pattern.", "#74766f", "#a3a59c", 1.5, "pickaxe", "stone_bricks", "wood"],
  ["oak_fence", "Oak Fence", "Oak rails and posts that form a sturdy animal barrier.", "#95622f", "#c28a47", 2, "axe", "oak_fence"],
  ["oak_fence_gate", "Oak Fence Gate", "A hinged oak gate that opens a passage through connected fences.", "#8d5a2b", "#c28a47", 2, "axe", "oak_fence_gate"],
  ["stone_brick_slab", "Stone Brick Slab", "A half-height course of fitted stone bricks.", "#74766f", "#a3a59c", 1.5, "pickaxe", "stone_brick_slab", "wood"],
  ["clay", "Clay", "A soft blue-gray deposit that breaks into four clay balls.", "#9ea4b6", "#c0c5d2", 0.6, "shovel", "clay_ball"],
  ["bricks", "Bricks", "A sturdy red masonry block crafted from fired clay bricks.", "#964c3d", "#c16f59", 2, "pickaxe", "bricks", "wood"],
  ["oak_slab", "Oak Slab", "A half-height oak plank for compact floors and trim.", "#a87841", "#d0a45e", 1.1, "axe", "oak_slab"],
  ["cobblestone_slab", "Cobblestone Slab", "A half-height course of rough cobblestone.", "#686b65", "#979a91", 2, "pickaxe", "cobblestone_slab", "wood"],
  ["brick_slab", "Brick Slab", "A half-height course of fired brick masonry.", "#964c3d", "#c16f59", 2, "pickaxe", "brick_slab", "wood"],
  ["oak_stairs", "Oak Stairs", "Oak plank steps that turn smoothly with their placement direction.", "#a87841", "#d0a45e", 1.1, "axe", "oak_stairs"],
  ["cobblestone_stairs", "Cobblestone Stairs", "Rough stone steps for durable builds.", "#686b65", "#979a91", 2, "pickaxe", "cobblestone_stairs", "wood"],
  ["stone_brick_stairs", "Stone Brick Stairs", "Fitted masonry steps for formal structures.", "#74766f", "#a3a59c", 1.5, "pickaxe", "stone_brick_stairs", "wood"],
  ["brick_stairs", "Brick Stairs", "Fired brick steps for decorative roofs and approaches.", "#964c3d", "#c16f59", 2, "pickaxe", "brick_stairs", "wood"],
  ["spruce_log", "", "", "#73552f", "#9b7441", 1.6, "axe", "spruce_log"], ["spruce_planks", "", "", "#73552f", "#9b7441", 1.1, "axe", "spruce_planks"], ["spruce_leaves", "", "", "#52745a", "#73966f", 0.3, "hand", "spruce_leaves"], ["spruce_slab", "", "", "#73552f", "#9b7441", 1.1, "axe", "spruce_slab"], ["spruce_stairs", "", "", "#73552f", "#9b7441", 1.1, "axe", "spruce_stairs"], ["spruce_door", "", "", "#73552f", "#9b7441", 1.4, "axe", "spruce_door"],
  ["birch_log", "", "", "#c9b87b", "#e5d49a", 1.6, "axe", "birch_log"], ["birch_planks", "", "", "#c9b87b", "#e5d49a", 1.1, "axe", "birch_planks"], ["birch_leaves", "", "", "#65964a", "#86b76b", 0.3, "hand", "birch_leaves"], ["birch_slab", "", "", "#c9b87b", "#e5d49a", 1.1, "axe", "birch_slab"], ["birch_stairs", "", "", "#c9b87b", "#e5d49a", 1.1, "axe", "birch_stairs"], ["birch_door", "", "", "#c9b87b", "#e5d49a", 1.4, "axe", "birch_door"],
  ["jungle_log", "", "", "#a46c50", "#cb9071", 1.6, "axe", "jungle_log"], ["jungle_planks", "", "", "#a46c50", "#cb9071", 1.1, "axe", "jungle_planks"], ["jungle_leaves", "", "", "#3c7a35", "#65a45a", 0.3, "hand", "jungle_leaves"], ["jungle_slab", "", "", "#a46c50", "#cb9071", 1.1, "axe", "jungle_slab"], ["jungle_stairs", "", "", "#a46c50", "#cb9071", 1.1, "axe", "jungle_stairs"], ["jungle_door", "", "", "#a46c50", "#cb9071", 1.4, "axe", "jungle_door"],
  ["acacia_log", "", "", "#a85b32", "#d47a43", 1.6, "axe", "acacia_log"], ["acacia_planks", "", "", "#a85b32", "#d47a43", 1.1, "axe", "acacia_planks"], ["acacia_leaves", "", "", "#5b813a", "#7fa35a", 0.3, "hand", "acacia_leaves"], ["acacia_slab", "", "", "#a85b32", "#d47a43", 1.1, "axe", "acacia_slab"], ["acacia_stairs", "", "", "#a85b32", "#d47a43", 1.1, "axe", "acacia_stairs"], ["acacia_door", "", "", "#a85b32", "#d47a43", 1.4, "axe", "acacia_door"],
  ["dark_oak_log", "", "", "#422b1b", "#68452b", 1.6, "axe", "dark_oak_log"], ["dark_oak_planks", "", "", "#422b1b", "#68452b", 1.1, "axe", "dark_oak_planks"], ["dark_oak_leaves", "", "", "#315a2e", "#537b4d", 0.3, "hand", "dark_oak_leaves"], ["dark_oak_slab", "", "", "#422b1b", "#68452b", 1.1, "axe", "dark_oak_slab"], ["dark_oak_stairs", "", "", "#422b1b", "#68452b", 1.1, "axe", "dark_oak_stairs"], ["dark_oak_door", "", "", "#422b1b", "#68452b", 1.4, "axe", "dark_oak_door"],
  ["mangrove_log", "", "", "#743a37", "#a24f4a", 1.6, "axe", "mangrove_log"], ["mangrove_planks", "", "", "#743a37", "#a24f4a", 1.1, "axe", "mangrove_planks"], ["mangrove_leaves", "", "", "#3d7138", "#62955b", 0.3, "hand", "mangrove_leaves"], ["mangrove_slab", "", "", "#743a37", "#a24f4a", 1.1, "axe", "mangrove_slab"], ["mangrove_stairs", "", "", "#743a37", "#a24f4a", 1.1, "axe", "mangrove_stairs"], ["mangrove_door", "", "", "#743a37", "#a24f4a", 1.4, "axe", "mangrove_door"],
  ["cherry_log", "", "", "#d9a0a0", "#efbaba", 1.6, "axe", "cherry_log"], ["cherry_planks", "", "", "#d9a0a0", "#efbaba", 1.1, "axe", "cherry_planks"], ["cherry_leaves", "", "", "#e69cb1", "#f4bdcc", 0.3, "hand", "cherry_leaves"], ["cherry_slab", "", "", "#d9a0a0", "#efbaba", 1.1, "axe", "cherry_slab"], ["cherry_stairs", "", "", "#d9a0a0", "#efbaba", 1.1, "axe", "cherry_stairs"], ["cherry_door", "", "", "#d9a0a0", "#efbaba", 1.4, "axe", "cherry_door"],
  ["bamboo_block", "", "", "#84943c", "#b4c45c", 1.6, "axe", "bamboo_block"], ["bamboo_planks", "", "", "#c5a94d", "#e2c96c", 1.1, "axe", "bamboo_planks"], ["bamboo_slab", "", "", "#c5a94d", "#e2c96c", 1.1, "axe", "bamboo_slab"], ["bamboo_stairs", "", "", "#c5a94d", "#e2c96c", 1.1, "axe", "bamboo_stairs"],
  ["quartz_block", "", "", "#e7e3d5", "#faf7ed", 1.8, "pickaxe", "quartz_block", "wood"], ["quartz_pillar", "", "", "#e7e3d5", "#faf7ed", 1.8, "pickaxe", "quartz_pillar", "wood"], ["chiseled_quartz", "", "", "#e7e3d5", "#faf7ed", 1.8, "pickaxe", "chiseled_quartz", "wood"], ["quartz_slab", "", "", "#e7e3d5", "#faf7ed", 1.8, "pickaxe", "quartz_slab", "wood"], ["quartz_stairs", "", "", "#e7e3d5", "#faf7ed", 1.8, "pickaxe", "quartz_stairs", "wood"],
  ["granite", "", "", "#9b6652", "#bd8068", 2, "pickaxe", "granite", "wood"], ["polished_granite", "", "", "#9b6652", "#bd8068", 2, "pickaxe", "polished_granite", "wood"], ["diorite", "", "", "#b8b8b3", "#d7d7d1", 2, "pickaxe", "diorite", "wood"], ["polished_diorite", "", "", "#b8b8b3", "#d7d7d1", 2, "pickaxe", "polished_diorite", "wood"], ["andesite", "", "", "#777b79", "#999d9a", 2, "pickaxe", "andesite", "wood"], ["polished_andesite", "", "", "#777b79", "#999d9a", 2, "pickaxe", "polished_andesite", "wood"], ["sandstone", "", "", "#d8c786", "#efe0a5", 1.2, "pickaxe", "sandstone", "wood"], ["cut_sandstone", "", "", "#d8c786", "#efe0a5", 1.2, "pickaxe", "cut_sandstone", "wood"], ["chiseled_sandstone", "", "", "#d8c786", "#efe0a5", 1.2, "pickaxe", "chiseled_sandstone", "wood"], ["smooth_stone", "", "", "#9b9c98", "#bdbeb9", 2, "pickaxe", "smooth_stone", "wood"], ["calcite", "", "", "#dddcd3", "#f0efe7", 1.5, "pickaxe", "calcite", "wood"], ["deepslate", "", "", "#4d5050", "#696d6c", 3, "pickaxe", "deepslate", "wood"],
  ["white_stained_glass", "", "", "#e9ecec", "#d8f4f2", 0.3, "hand", "white_stained_glass"],
  ["white_concrete", "", "", "#e9ecec", "#e9ecec", 1.8, "pickaxe", "white_concrete", "wood"],
  ["orange_stained_glass", "", "", "#d87f33", "#d8f4f2", 0.3, "hand", "orange_stained_glass"],
  ["orange_concrete", "", "", "#d87f33", "#d87f33", 1.8, "pickaxe", "orange_concrete", "wood"],
  ["magenta_stained_glass", "", "", "#b24cd8", "#d8f4f2", 0.3, "hand", "magenta_stained_glass"],
  ["magenta_concrete", "", "", "#b24cd8", "#b24cd8", 1.8, "pickaxe", "magenta_concrete", "wood"],
  ["light_blue_stained_glass", "", "", "#6699d8", "#d8f4f2", 0.3, "hand", "light_blue_stained_glass"],
  ["light_blue_concrete", "", "", "#6699d8", "#6699d8", 1.8, "pickaxe", "light_blue_concrete", "wood"],
  ["yellow_stained_glass", "", "", "#e5e533", "#d8f4f2", 0.3, "hand", "yellow_stained_glass"],
  ["yellow_concrete", "", "", "#e5e533", "#e5e533", 1.8, "pickaxe", "yellow_concrete", "wood"],
  ["lime_stained_glass", "", "", "#7fcc19", "#d8f4f2", 0.3, "hand", "lime_stained_glass"],
  ["lime_concrete", "", "", "#7fcc19", "#7fcc19", 1.8, "pickaxe", "lime_concrete", "wood"],
  ["pink_stained_glass", "", "", "#f27fa5", "#d8f4f2", 0.3, "hand", "pink_stained_glass"],
  ["pink_concrete", "", "", "#f27fa5", "#f27fa5", 1.8, "pickaxe", "pink_concrete", "wood"],
  ["gray_stained_glass", "", "", "#4c4c4c", "#d8f4f2", 0.3, "hand", "gray_stained_glass"],
  ["gray_concrete", "", "", "#4c4c4c", "#4c4c4c", 1.8, "pickaxe", "gray_concrete", "wood"],
  ["light_gray_stained_glass", "", "", "#999999", "#d8f4f2", 0.3, "hand", "light_gray_stained_glass"],
  ["light_gray_concrete", "", "", "#999999", "#999999", 1.8, "pickaxe", "light_gray_concrete", "wood"],
  ["cyan_stained_glass", "", "", "#4c7f99", "#d8f4f2", 0.3, "hand", "cyan_stained_glass"],
  ["cyan_concrete", "", "", "#4c7f99", "#4c7f99", 1.8, "pickaxe", "cyan_concrete", "wood"],
  ["purple_stained_glass", "", "", "#7f3fb2", "#d8f4f2", 0.3, "hand", "purple_stained_glass"],
  ["purple_concrete", "", "", "#7f3fb2", "#7f3fb2", 1.8, "pickaxe", "purple_concrete", "wood"],
  ["blue_stained_glass", "", "", "#334cb2", "#d8f4f2", 0.3, "hand", "blue_stained_glass"],
  ["blue_concrete", "", "", "#334cb2", "#334cb2", 1.8, "pickaxe", "blue_concrete", "wood"],
  ["brown_stained_glass", "", "", "#664c33", "#d8f4f2", 0.3, "hand", "brown_stained_glass"],
  ["brown_concrete", "", "", "#664c33", "#664c33", 1.8, "pickaxe", "brown_concrete", "wood"],
  ["green_stained_glass", "", "", "#667f33", "#d8f4f2", 0.3, "hand", "green_stained_glass"],
  ["green_concrete", "", "", "#667f33", "#667f33", 1.8, "pickaxe", "green_concrete", "wood"],
  ["red_stained_glass", "", "", "#993333", "#d8f4f2", 0.3, "hand", "red_stained_glass"],
  ["red_concrete", "", "", "#993333", "#993333", 1.8, "pickaxe", "red_concrete", "wood"],
  ["black_stained_glass", "", "", "#191919", "#d8f4f2", 0.3, "hand", "black_stained_glass"],
  ["black_concrete", "", "", "#191919", "#191919", 1.8, "pickaxe", "black_concrete", "wood"],
  ["glowstone", "", "", "#d9bd72", "#fff2a6", 1.5, "pickaxe", "glowstone", "wood"],
  ["sea_lantern", "", "", "#d9bd72", "#fff2a6", 1.5, "pickaxe", "sea_lantern", "wood"],
  ["shroomlight", "", "", "#d9bd72", "#fff2a6", 1.5, "pickaxe", "shroomlight", "wood"],
  ["ochre_froglight", "", "", "#d9bd72", "#fff2a6", 1.5, "pickaxe", "ochre_froglight", "wood"],
  ["verdant_froglight", "", "", "#d9bd72", "#fff2a6", 1.5, "pickaxe", "verdant_froglight", "wood"],
  ["pearlescent_froglight", "", "", "#d9bd72", "#fff2a6", 1.5, "pickaxe", "pearlescent_froglight", "wood"],
  ["magma_block", "", "", "#d9bd72", "#fff2a6", 1.5, "pickaxe", "magma_block", "wood"],
  ["mossy_cobblestone", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "mossy_cobblestone", "wood"],
  ["mossy_stone_bricks", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "mossy_stone_bricks", "wood"],
  ["cracked_stone_bricks", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "cracked_stone_bricks", "wood"],
  ["chiseled_stone_bricks", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "chiseled_stone_bricks", "wood"],
  ["packed_mud", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "packed_mud", "wood"],
  ["mud_bricks", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "mud_bricks", "wood"],
  ["prismarine", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "prismarine", "wood"],
  ["prismarine_bricks", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "prismarine_bricks", "wood"],
  ["dark_prismarine", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "dark_prismarine", "wood"],
  ["nether_bricks", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "nether_bricks", "wood"],
  ["red_nether_bricks", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "red_nether_bricks", "wood"],
  ["blackstone", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "blackstone", "wood"],
  ["polished_blackstone", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "polished_blackstone", "wood"],
  ["polished_blackstone_bricks", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "polished_blackstone_bricks", "wood"],
  ["end_stone", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "end_stone", "wood"],
  ["end_stone_bricks", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "end_stone_bricks", "wood"],
  ["purpur_block", "", "", "#77776f", "#aaa99f", 2, "pickaxe", "purpur_block", "wood"],
  ["obsidian", "", "", "#77776f", "#aaa99f", 8, "pickaxe", "obsidian", "wood"],
  ["crying_obsidian", "", "", "#77776f", "#aaa99f", 8, "pickaxe", "crying_obsidian", "wood"],
  ["orange_wool", "", "", "#d87f33", "#d87f33", 0.8, "hand", "orange_wool"],
  ["magenta_wool", "", "", "#b24cd8", "#b24cd8", 0.8, "hand", "magenta_wool"],
  ["light_blue_wool", "", "", "#6699d8", "#6699d8", 0.8, "hand", "light_blue_wool"],
  ["yellow_wool", "", "", "#e5e533", "#e5e533", 0.8, "hand", "yellow_wool"],
  ["lime_wool", "", "", "#7fcc19", "#7fcc19", 0.8, "hand", "lime_wool"],
  ["pink_wool", "", "", "#f27fa5", "#f27fa5", 0.8, "hand", "pink_wool"],
  ["gray_wool", "", "", "#4c4c4c", "#4c4c4c", 0.8, "hand", "gray_wool"],
  ["light_gray_wool", "", "", "#999999", "#999999", 0.8, "hand", "light_gray_wool"],
  ["cyan_wool", "", "", "#4c7f99", "#4c7f99", 0.8, "hand", "cyan_wool"],
  ["purple_wool", "", "", "#7f3fb2", "#7f3fb2", 0.8, "hand", "purple_wool"],
  ["blue_wool", "", "", "#334cb2", "#334cb2", 0.8, "hand", "blue_wool"],
  ["brown_wool", "", "", "#664c33", "#664c33", 0.8, "hand", "brown_wool"],
  ["green_wool", "", "", "#667f33", "#667f33", 0.8, "hand", "green_wool"],
  ["red_wool", "", "", "#993333", "#993333", 0.8, "hand", "red_wool"],
  ["black_wool", "", "", "#191919", "#191919", 0.8, "hand", "black_wool"],
  ["white_terracotta", "", "", "#f0f0f0", "#f0f0f0", 1.25, "pickaxe", "white_terracotta", "wood"],
  ["white_glazed_terracotta", "", "", "#f0f0f0", "#f0f0f0", 1.25, "pickaxe", "white_glazed_terracotta", "wood"],
  ["orange_terracotta", "", "", "#d87f33", "#d87f33", 1.25, "pickaxe", "orange_terracotta", "wood"],
  ["orange_glazed_terracotta", "", "", "#d87f33", "#d87f33", 1.25, "pickaxe", "orange_glazed_terracotta", "wood"],
  ["magenta_terracotta", "", "", "#b24cd8", "#b24cd8", 1.25, "pickaxe", "magenta_terracotta", "wood"],
  ["magenta_glazed_terracotta", "", "", "#b24cd8", "#b24cd8", 1.25, "pickaxe", "magenta_glazed_terracotta", "wood"],
  ["light_blue_terracotta", "", "", "#6699d8", "#6699d8", 1.25, "pickaxe", "light_blue_terracotta", "wood"],
  ["light_blue_glazed_terracotta", "", "", "#6699d8", "#6699d8", 1.25, "pickaxe", "light_blue_glazed_terracotta", "wood"],
  ["yellow_terracotta", "", "", "#e5e533", "#e5e533", 1.25, "pickaxe", "yellow_terracotta", "wood"],
  ["yellow_glazed_terracotta", "", "", "#e5e533", "#e5e533", 1.25, "pickaxe", "yellow_glazed_terracotta", "wood"],
  ["lime_terracotta", "", "", "#7fcc19", "#7fcc19", 1.25, "pickaxe", "lime_terracotta", "wood"],
  ["lime_glazed_terracotta", "", "", "#7fcc19", "#7fcc19", 1.25, "pickaxe", "lime_glazed_terracotta", "wood"],
  ["pink_terracotta", "", "", "#f27fa5", "#f27fa5", 1.25, "pickaxe", "pink_terracotta", "wood"],
  ["pink_glazed_terracotta", "", "", "#f27fa5", "#f27fa5", 1.25, "pickaxe", "pink_glazed_terracotta", "wood"],
  ["gray_terracotta", "", "", "#4c4c4c", "#4c4c4c", 1.25, "pickaxe", "gray_terracotta", "wood"],
  ["gray_glazed_terracotta", "", "", "#4c4c4c", "#4c4c4c", 1.25, "pickaxe", "gray_glazed_terracotta", "wood"],
  ["light_gray_terracotta", "", "", "#999999", "#999999", 1.25, "pickaxe", "light_gray_terracotta", "wood"],
  ["light_gray_glazed_terracotta", "", "", "#999999", "#999999", 1.25, "pickaxe", "light_gray_glazed_terracotta", "wood"],
  ["cyan_terracotta", "", "", "#4c7f99", "#4c7f99", 1.25, "pickaxe", "cyan_terracotta", "wood"],
  ["cyan_glazed_terracotta", "", "", "#4c7f99", "#4c7f99", 1.25, "pickaxe", "cyan_glazed_terracotta", "wood"],
  ["purple_terracotta", "", "", "#7f3fb2", "#7f3fb2", 1.25, "pickaxe", "purple_terracotta", "wood"],
  ["purple_glazed_terracotta", "", "", "#7f3fb2", "#7f3fb2", 1.25, "pickaxe", "purple_glazed_terracotta", "wood"],
  ["blue_terracotta", "", "", "#334cb2", "#334cb2", 1.25, "pickaxe", "blue_terracotta", "wood"],
  ["blue_glazed_terracotta", "", "", "#334cb2", "#334cb2", 1.25, "pickaxe", "blue_glazed_terracotta", "wood"],
  ["brown_terracotta", "", "", "#664c33", "#664c33", 1.25, "pickaxe", "brown_terracotta", "wood"],
  ["brown_glazed_terracotta", "", "", "#664c33", "#664c33", 1.25, "pickaxe", "brown_glazed_terracotta", "wood"],
  ["green_terracotta", "", "", "#667f33", "#667f33", 1.25, "pickaxe", "green_terracotta", "wood"],
  ["green_glazed_terracotta", "", "", "#667f33", "#667f33", 1.25, "pickaxe", "green_glazed_terracotta", "wood"],
  ["red_terracotta", "", "", "#993333", "#993333", 1.25, "pickaxe", "red_terracotta", "wood"],
  ["red_glazed_terracotta", "", "", "#993333", "#993333", 1.25, "pickaxe", "red_glazed_terracotta", "wood"],
  ["black_terracotta", "", "", "#191919", "#191919", 1.25, "pickaxe", "black_terracotta", "wood"],
  ["black_glazed_terracotta", "", "", "#191919", "#191919", 1.25, "pickaxe", "black_glazed_terracotta", "wood"],
  ["red_sandstone", "", "", "#b86131", "#b86131", 2, "pickaxe", "red_sandstone", "wood"],
  ["cut_red_sandstone", "", "", "#b86131", "#b86131", 2, "pickaxe", "cut_red_sandstone", "wood"],
  ["chiseled_red_sandstone", "", "", "#b86131", "#b86131", 2, "pickaxe", "chiseled_red_sandstone", "wood"],
  ["smooth_sandstone", "", "", "#d8c786", "#d8c786", 2, "pickaxe", "smooth_sandstone", "wood"],
  ["smooth_red_sandstone", "", "", "#b86131", "#b86131", 2, "pickaxe", "smooth_red_sandstone", "wood"],
  ["amethyst_block", "", "", "#8561b8", "#8561b8", 2, "pickaxe", "amethyst_block", "wood"],
  ["budding_amethyst", "", "", "#8561b8", "#8561b8", 2, "pickaxe", "budding_amethyst", "wood"],
  ["tuff", "", "", "#6c756e", "#6c756e", 2, "pickaxe", "tuff", "wood"],
  ["dripstone_block", "", "", "#866553", "#866553", 2, "pickaxe", "dripstone_block", "wood"],
  ["copper_block", "", "", "#c26d4f", "#c26d4f", 2, "pickaxe", "copper_block", "wood"],
  ["exposed_copper", "", "", "#a17d5d", "#a17d5d", 2, "pickaxe", "exposed_copper", "wood"],
  ["weathered_copper", "", "", "#6f956f", "#6f956f", 2, "pickaxe", "weathered_copper", "wood"],
  ["oxidized_copper", "", "", "#4f9a7f", "#4f9a7f", 2, "pickaxe", "oxidized_copper", "wood"],
  ["cut_copper", "", "", "#c26d4f", "#c26d4f", 2, "pickaxe", "cut_copper", "wood"],
  ["exposed_cut_copper", "", "", "#a17d5d", "#a17d5d", 2, "pickaxe", "exposed_cut_copper", "wood"],
  ["weathered_cut_copper", "", "", "#6f956f", "#6f956f", 2, "pickaxe", "weathered_cut_copper", "wood"],
  ["oxidized_cut_copper", "", "", "#4f9a7f", "#4f9a7f", 2, "pickaxe", "oxidized_cut_copper", "wood"],
  ["sculk", "", "", "#0d3436", "#0d3436", 2, "pickaxe", "sculk", "wood"],
  ["nether_wart_block", "", "", "#720f19", "#720f19", 2, "pickaxe", "nether_wart_block", "wood"],
  ["cobbled_deepslate", "", "", "#414344", "#606364", 3, "pickaxe", "cobbled_deepslate", "wood"],
  ["polished_deepslate", "", "", "#414344", "#606364", 3, "pickaxe", "polished_deepslate", "wood"],
  ["deepslate_bricks", "", "", "#383b3d", "#595d5f", 3, "pickaxe", "deepslate_bricks", "wood"],
  ["deepslate_tiles", "", "", "#303335", "#505456", 3, "pickaxe", "deepslate_tiles", "wood"],
  ["stone_slab", "", "", "#6d7069", "#9a9c91", 2.5, "pickaxe", "stone_slab", "wood"],
  ["stone_stairs", "", "", "#6d7069", "#9a9c91", 2.5, "pickaxe", "stone_stairs", "wood"],
  ["sandstone_slab", "", "", "#d8c786", "#efe0a5", 1.2, "pickaxe", "sandstone_slab", "wood"],
  ["sandstone_stairs", "", "", "#d8c786", "#efe0a5", 1.2, "pickaxe", "sandstone_stairs", "wood"],
  ["smooth_sandstone_slab", "", "", "#d8c786", "#efe0a5", 1.2, "pickaxe", "smooth_sandstone_slab", "wood"],
  ["smooth_sandstone_stairs", "", "", "#d8c786", "#efe0a5", 1.2, "pickaxe", "smooth_sandstone_stairs", "wood"],
  ["red_sandstone_slab", "", "", "#b86131", "#d8844b", 1.2, "pickaxe", "red_sandstone_slab", "wood"],
  ["red_sandstone_stairs", "", "", "#b86131", "#d8844b", 1.2, "pickaxe", "red_sandstone_stairs", "wood"],
  ["smooth_red_sandstone_slab", "", "", "#b86131", "#d8844b", 1.2, "pickaxe", "smooth_red_sandstone_slab", "wood"],
  ["smooth_red_sandstone_stairs", "", "", "#b86131", "#d8844b", 1.2, "pickaxe", "smooth_red_sandstone_stairs", "wood"],
  ["nether_brick_slab", "", "", "#382126", "#5b343a", 2.5, "pickaxe", "nether_brick_slab", "wood"],
  ["nether_brick_stairs", "", "", "#382126", "#5b343a", 2.5, "pickaxe", "nether_brick_stairs", "wood"],
  ["blackstone_slab", "", "", "#2d2a32", "#49444e", 2.5, "pickaxe", "blackstone_slab", "wood"],
  ["blackstone_stairs", "", "", "#2d2a32", "#49444e", 2.5, "pickaxe", "blackstone_stairs", "wood"],
  ["polished_blackstone_slab", "", "", "#302d36", "#504a59", 2.5, "pickaxe", "polished_blackstone_slab", "wood"],
  ["polished_blackstone_stairs", "", "", "#302d36", "#504a59", 2.5, "pickaxe", "polished_blackstone_stairs", "wood"],
  ["polished_blackstone_brick_slab", "", "", "#302d36", "#504a59", 2.5, "pickaxe", "polished_blackstone_brick_slab", "wood"],
  ["polished_blackstone_brick_stairs", "", "", "#302d36", "#504a59", 2.5, "pickaxe", "polished_blackstone_brick_stairs", "wood"],
  ["cobbled_deepslate_slab", "", "", "#414344", "#606364", 2.5, "pickaxe", "cobbled_deepslate_slab", "wood"],
  ["cobbled_deepslate_stairs", "", "", "#414344", "#606364", 2.5, "pickaxe", "cobbled_deepslate_stairs", "wood"],
  ["polished_deepslate_slab", "", "", "#414344", "#606364", 2.5, "pickaxe", "polished_deepslate_slab", "wood"],
  ["polished_deepslate_stairs", "", "", "#414344", "#606364", 2.5, "pickaxe", "polished_deepslate_stairs", "wood"],
  ["deepslate_brick_slab", "", "", "#383b3d", "#595d5f", 2.5, "pickaxe", "deepslate_brick_slab", "wood"],
  ["deepslate_brick_stairs", "", "", "#383b3d", "#595d5f", 2.5, "pickaxe", "deepslate_brick_stairs", "wood"],
  ["deepslate_tile_slab", "", "", "#303335", "#505456", 2.5, "pickaxe", "deepslate_tile_slab", "wood"],
  ["deepslate_tile_stairs", "", "", "#303335", "#505456", 2.5, "pickaxe", "deepslate_tile_stairs", "wood"],
  ["waxed_copper_block","Waxed Copper Block","Waxed Copper Block building block.","#c26d4f","#df8a68",2.5,"pickaxe","waxed_copper_block","wood"],
  ["waxed_exposed_copper","Waxed Exposed Copper","Waxed Exposed Copper building block.","#a17d5d","#c09a74",2.5,"pickaxe","waxed_exposed_copper","wood"],
  ["waxed_weathered_copper","Waxed Weathered Copper","Waxed Weathered Copper building block.","#6f956f","#8caf88",2.5,"pickaxe","waxed_weathered_copper","wood"],
  ["waxed_oxidized_copper","Waxed Oxidized Copper","Waxed Oxidized Copper building block.","#4f9a7f","#6bb69a",2.5,"pickaxe","waxed_oxidized_copper","wood"],
  ["waxed_cut_copper","Waxed Cut Copper","Waxed Cut Copper building block.","#c26d4f","#df8a68",2.5,"pickaxe","waxed_cut_copper","wood"],
  ["waxed_exposed_cut_copper","Waxed Exposed Cut Copper","Waxed Exposed Cut Copper building block.","#a17d5d","#c09a74",2.5,"pickaxe","waxed_exposed_cut_copper","wood"],
  ["waxed_weathered_cut_copper","Waxed Weathered Cut Copper","Waxed Weathered Cut Copper building block.","#6f956f","#8caf88",2.5,"pickaxe","waxed_weathered_cut_copper","wood"],
  ["waxed_oxidized_cut_copper","Waxed Oxidized Cut Copper","Waxed Oxidized Cut Copper building block.","#4f9a7f","#6bb69a",2.5,"pickaxe","waxed_oxidized_cut_copper","wood"],
  ["polished_tuff","Polished Tuff","Polished Tuff building block.","#59665f","#78857d",2.5,"pickaxe","polished_tuff","wood"],
  ["tuff_bricks","Tuff Bricks","Tuff Bricks building block.","#59665f","#78857d",2.5,"pickaxe","tuff_bricks","wood"],
  ["resin_bricks","Resin Bricks","Resin Bricks building block.","#7b2928","#a54538",2.5,"pickaxe","resin_bricks","wood"],
  ["granite_slab","Granite Slab","Granite Slab building block.","#9b6652","#bd8068",2.5,"pickaxe","granite_slab","wood"],
  ["granite_stairs","Granite Stairs","Granite Stairs building block.","#9b6652","#bd8068",2.5,"pickaxe","granite_stairs","wood"],
  ["polished_granite_slab","Polished Granite Slab","Polished Granite Slab building block.","#9b6652","#bd8068",2.5,"pickaxe","polished_granite_slab","wood"],
  ["polished_granite_stairs","Polished Granite Stairs","Polished Granite Stairs building block.","#9b6652","#bd8068",2.5,"pickaxe","polished_granite_stairs","wood"],
  ["diorite_slab","Diorite Slab","Diorite Slab building block.","#b8b8b3","#d7d7d1",2.5,"pickaxe","diorite_slab","wood"],
  ["diorite_stairs","Diorite Stairs","Diorite Stairs building block.","#b8b8b3","#d7d7d1",2.5,"pickaxe","diorite_stairs","wood"],
  ["polished_diorite_slab","Polished Diorite Slab","Polished Diorite Slab building block.","#b8b8b3","#d7d7d1",2.5,"pickaxe","polished_diorite_slab","wood"],
  ["polished_diorite_stairs","Polished Diorite Stairs","Polished Diorite Stairs building block.","#b8b8b3","#d7d7d1",2.5,"pickaxe","polished_diorite_stairs","wood"],
  ["andesite_slab","Andesite Slab","Andesite Slab building block.","#777b79","#999d9a",2.5,"pickaxe","andesite_slab","wood"],
  ["andesite_stairs","Andesite Stairs","Andesite Stairs building block.","#777b79","#999d9a",2.5,"pickaxe","andesite_stairs","wood"],
  ["polished_andesite_slab","Polished Andesite Slab","Polished Andesite Slab building block.","#777b79","#999d9a",2.5,"pickaxe","polished_andesite_slab","wood"],
  ["polished_andesite_stairs","Polished Andesite Stairs","Polished Andesite Stairs building block.","#777b79","#999d9a",2.5,"pickaxe","polished_andesite_stairs","wood"],
  ["mossy_cobblestone_slab","Mossy Cobblestone Slab","Mossy Cobblestone Slab building block.","#62645f","#8e9188",2.5,"pickaxe","mossy_cobblestone_slab","wood"],
  ["mossy_cobblestone_stairs","Mossy Cobblestone Stairs","Mossy Cobblestone Stairs building block.","#62645f","#8e9188",2.5,"pickaxe","mossy_cobblestone_stairs","wood"],
  ["mossy_stone_brick_slab","Mossy Stone Brick Slab","Mossy Stone Brick Slab building block.","#62645f","#8e9188",2.5,"pickaxe","mossy_stone_brick_slab","wood"],
  ["mossy_stone_brick_stairs","Mossy Stone Brick Stairs","Mossy Stone Brick Stairs building block.","#62645f","#8e9188",2.5,"pickaxe","mossy_stone_brick_stairs","wood"],
  ["mud_brick_slab","Mud Brick Slab","Mud Brick Slab building block.","#87664f","#a98568",2.5,"pickaxe","mud_brick_slab","wood"],
  ["mud_brick_stairs","Mud Brick Stairs","Mud Brick Stairs building block.","#87664f","#a98568",2.5,"pickaxe","mud_brick_stairs","wood"],
  ["prismarine_slab","Prismarine Slab","Prismarine Slab building block.","#5c9b8e","#85b9ae",2.5,"pickaxe","prismarine_slab","wood"],
  ["prismarine_stairs","Prismarine Stairs","Prismarine Stairs building block.","#5c9b8e","#85b9ae",2.5,"pickaxe","prismarine_stairs","wood"],
  ["prismarine_brick_slab","Prismarine Brick Slab","Prismarine Brick Slab building block.","#5c9b8e","#85b9ae",2.5,"pickaxe","prismarine_brick_slab","wood"],
  ["prismarine_brick_stairs","Prismarine Brick Stairs","Prismarine Brick Stairs building block.","#5c9b8e","#85b9ae",2.5,"pickaxe","prismarine_brick_stairs","wood"],
  ["dark_prismarine_slab","Dark Prismarine Slab","Dark Prismarine Slab building block.","#315044","#497463",2.5,"pickaxe","dark_prismarine_slab","wood"],
  ["dark_prismarine_stairs","Dark Prismarine Stairs","Dark Prismarine Stairs building block.","#315044","#497463",2.5,"pickaxe","dark_prismarine_stairs","wood"],
  ["red_nether_brick_slab","Red Nether Brick Slab","Red Nether Brick Slab building block.","#7b2928","#a54538",2.5,"pickaxe","red_nether_brick_slab","wood"],
  ["red_nether_brick_stairs","Red Nether Brick Stairs","Red Nether Brick Stairs building block.","#7b2928","#a54538",2.5,"pickaxe","red_nether_brick_stairs","wood"],
  ["end_stone_brick_slab","End Stone Brick Slab","End Stone Brick Slab building block.","#d7d39a","#eeeab5",2.5,"pickaxe","end_stone_brick_slab","wood"],
  ["end_stone_brick_stairs","End Stone Brick Stairs","End Stone Brick Stairs building block.","#d7d39a","#eeeab5",2.5,"pickaxe","end_stone_brick_stairs","wood"],
  ["purpur_slab","Purpur Slab","Purpur Slab building block.","#a977a8","#c49bc4",2.5,"pickaxe","purpur_slab","wood"],
  ["purpur_stairs","Purpur Stairs","Purpur Stairs building block.","#a977a8","#c49bc4",2.5,"pickaxe","purpur_stairs","wood"],
  ["cut_copper_slab","Cut Copper Slab","Cut Copper Slab building block.","#c26d4f","#df8a68",2.5,"pickaxe","cut_copper_slab","wood"],
  ["cut_copper_stairs","Cut Copper Stairs","Cut Copper Stairs building block.","#c26d4f","#df8a68",2.5,"pickaxe","cut_copper_stairs","wood"],
  ["exposed_cut_copper_slab","Exposed Cut Copper Slab","Exposed Cut Copper Slab building block.","#a17d5d","#c09a74",2.5,"pickaxe","exposed_cut_copper_slab","wood"],
  ["exposed_cut_copper_stairs","Exposed Cut Copper Stairs","Exposed Cut Copper Stairs building block.","#a17d5d","#c09a74",2.5,"pickaxe","exposed_cut_copper_stairs","wood"],
  ["weathered_cut_copper_slab","Weathered Cut Copper Slab","Weathered Cut Copper Slab building block.","#6f956f","#8caf88",2.5,"pickaxe","weathered_cut_copper_slab","wood"],
  ["weathered_cut_copper_stairs","Weathered Cut Copper Stairs","Weathered Cut Copper Stairs building block.","#6f956f","#8caf88",2.5,"pickaxe","weathered_cut_copper_stairs","wood"],
  ["oxidized_cut_copper_slab","Oxidized Cut Copper Slab","Oxidized Cut Copper Slab building block.","#4f9a7f","#6bb69a",2.5,"pickaxe","oxidized_cut_copper_slab","wood"],
  ["oxidized_cut_copper_stairs","Oxidized Cut Copper Stairs","Oxidized Cut Copper Stairs building block.","#4f9a7f","#6bb69a",2.5,"pickaxe","oxidized_cut_copper_stairs","wood"],
  ["waxed_cut_copper_slab","Waxed Cut Copper Slab","Waxed Cut Copper Slab building block.","#c26d4f","#df8a68",2.5,"pickaxe","waxed_cut_copper_slab","wood"],
  ["waxed_cut_copper_stairs","Waxed Cut Copper Stairs","Waxed Cut Copper Stairs building block.","#c26d4f","#df8a68",2.5,"pickaxe","waxed_cut_copper_stairs","wood"],
  ["waxed_exposed_cut_copper_slab","Waxed Exposed Cut Copper Slab","Waxed Exposed Cut Copper Slab building block.","#a17d5d","#c09a74",2.5,"pickaxe","waxed_exposed_cut_copper_slab","wood"],
  ["waxed_exposed_cut_copper_stairs","Waxed Exposed Cut Copper Stairs","Waxed Exposed Cut Copper Stairs building block.","#a17d5d","#c09a74",2.5,"pickaxe","waxed_exposed_cut_copper_stairs","wood"],
  ["waxed_weathered_cut_copper_slab","Waxed Weathered Cut Copper Slab","Waxed Weathered Cut Copper Slab building block.","#6f956f","#8caf88",2.5,"pickaxe","waxed_weathered_cut_copper_slab","wood"],
  ["waxed_weathered_cut_copper_stairs","Waxed Weathered Cut Copper Stairs","Waxed Weathered Cut Copper Stairs building block.","#6f956f","#8caf88",2.5,"pickaxe","waxed_weathered_cut_copper_stairs","wood"],
  ["waxed_oxidized_cut_copper_slab","Waxed Oxidized Cut Copper Slab","Waxed Oxidized Cut Copper Slab building block.","#4f9a7f","#6bb69a",2.5,"pickaxe","waxed_oxidized_cut_copper_slab","wood"],
  ["waxed_oxidized_cut_copper_stairs","Waxed Oxidized Cut Copper Stairs","Waxed Oxidized Cut Copper Stairs building block.","#4f9a7f","#6bb69a",2.5,"pickaxe","waxed_oxidized_cut_copper_stairs","wood"],
  ["tuff_slab","Tuff Slab","Tuff Slab building block.","#59665f","#78857d",2.5,"pickaxe","tuff_slab","wood"],
  ["tuff_stairs","Tuff Stairs","Tuff Stairs building block.","#59665f","#78857d",2.5,"pickaxe","tuff_stairs","wood"],
  ["polished_tuff_slab","Polished Tuff Slab","Polished Tuff Slab building block.","#59665f","#78857d",2.5,"pickaxe","polished_tuff_slab","wood"],
  ["polished_tuff_stairs","Polished Tuff Stairs","Polished Tuff Stairs building block.","#59665f","#78857d",2.5,"pickaxe","polished_tuff_stairs","wood"],
  ["tuff_brick_slab","Tuff Brick Slab","Tuff Brick Slab building block.","#59665f","#78857d",2.5,"pickaxe","tuff_brick_slab","wood"],
  ["tuff_brick_stairs","Tuff Brick Stairs","Tuff Brick Stairs building block.","#59665f","#78857d",2.5,"pickaxe","tuff_brick_stairs","wood"],
  ["resin_brick_slab","Resin Brick Slab","Resin Brick Slab building block.","#7b2928","#a54538",2.5,"pickaxe","resin_brick_slab","wood"],
  ["resin_brick_stairs","Resin Brick Stairs","Resin Brick Stairs building block.","#7b2928","#a54538",2.5,"pickaxe","resin_brick_stairs","wood"],
  ["cactus","Cactus","A prickly desert plant.","#527d36","#76a84d",0.4,"hand","cactus"],
  ["short_grass","Short Grass","A tuft of plains grass.","#64963e","#8fc85d",0,"hand","short_grass"],
  ["dandelion","Dandelion","A small yellow flower.","#d8b82e","#ffe766",0,"hand","dandelion"],
  ["poppy","Poppy","A small red flower.","#a72d27","#e95043",0,"hand","poppy"],
]);

function blockItem(id: BlockId, shortLabel: string, glyph: string): ItemDefinition {
  const block = BLOCKS[id];
  return { id, label: block.label, shortLabel, description: block.description, category: "block", maxStack: 64, glyph, color: block.color, placesBlock: id };
}

function toolItem(id: ToolId, label: string, shortLabel: string, kind: Exclude<ToolKind, "hand">, tier: Exclude<ToolTier, "none">, description: string, glyph: string, color: string): ItemDefinition {
  const tierBonus = tier === "diamond" ? 3 : tier === "iron" ? 2 : tier === "stone" ? 1 : 0;
  const attackDamage = ({ pickaxe: 2, axe: 3, shovel: 1, sword: 4 } as const)[kind] + tierBonus;
  const maxDurability = ({ wood: 59, gold: 32, stone: 131, iron: 250, diamond: 1561 } as const)[tier];
  return { id, label, shortLabel, description, category: "tool", maxStack: 1, glyph, color, tool: { kind, tier, attackDamage, maxDurability } };
}

function armorItem(id: ArmorId, label: string, shortLabel: string, slot: ArmorSlot, protection: number, description: string, glyph: string, color = "#9b6339", material: "leather" | "iron" | "gold" | "diamond" = color === "#9b6339" ? "leather" : "iron"): ItemDefinition {
  const durabilityBase = ({ leather: 5, gold: 7, iron: 15, diamond: 33 } as const)[material];
  const slotMultiplier = ({ head: 11, chest: 16, legs: 15, feet: 13 } as const)[slot];
  return { id, label, shortLabel, description, category: "armor", maxStack: 1, glyph, color, armor: { slot, protection, maxDurability: durabilityBase * slotMultiplier } };
}

function foodItem(id: "apple" | "pork" | "beef" | "mutton" | "raw_chicken" | "cooked_pork" | "cooked_beef" | "cooked_mutton" | "cooked_chicken" | "rotten_flesh", label: string, shortLabel: string, hunger: number, description: string, glyph: string, color: string): ItemDefinition {
  return { id, label, shortLabel, description, category: "food", maxStack: 64, glyph, color, food: { hunger } };
}

type BasicItemSpec = readonly [id: ItemId, label: string, shortLabel: string, description: string, glyph: string, color: string];
type FoodItemSpec = readonly [id: Parameters<typeof foodItem>[0], label: string, shortLabel: string, hunger: number, description: string, glyph: string, color: string];
type RangedItemSpec = readonly [id: "bow", label: string, shortLabel: string, description: string, category: "tool", maxStack: 1, glyph: string, color: string, maxDurability: number, maxChargeMs: number];
type UtilityItemSpec = readonly [id: "flint_and_steel" | "shears", label: string, shortLabel: string, description: string, glyph: string, color: string, maxDurability: number];

const BLOCK_ITEM_SPECS = [
  ["grass", "GRS", "▨"], ["dirt", "DRT", "▦"], ["stone", "STN", "◆"], ["cobblestone", "COB", "▦"],
  ["sand", "SND", "░"], ["gravel", "GRV", "▦"], ["glass", "GLS", "◇"], ["coal_ore", "C·OR", "✦"], ["iron_ore", "I·OR", "◈"],
  ["gold_ore", "G·OR", "✦"], ["diamond_ore", "D·OR", "◆"], ["log", "LOG", "▥"], ["leaves", "LEF", "✤"],
  ["planks", "PLK", "▤"], ["crafting_table", "CRF", "▧"], ["furnace", "FRN", "▩"], ["torch", "TCH", "♨"],
  ["chest", "CHT", "▣"], ["door", "DOR", "▥"], ["bed", "BED", "▰"], ["ladder", "LDR", "╫"],
  ["tnt", "TNT", "▩"],
  ["wool", "WOL", "▦"],
  ["sapling", "SAP", "✣"],
  ["stone_bricks", "S·BR", "▦"],
  ["oak_fence", "FNC", "╫"],
  ["oak_fence_gate", "GATE", "╪"],
  ["stone_brick_slab", "SLAB", "▂"],
  ["clay", "CLY", "▦"],
  ["bricks", "BRK", "▦"],
  ["oak_slab", "O·SL", "▂"],
  ["cobblestone_slab", "C·SL", "▂"],
  ["brick_slab", "B·SL", "▂"],
  ["oak_stairs", "O·ST", "◿"],
  ["cobblestone_stairs", "C·ST", "◿"],
  ["stone_brick_stairs", "S·ST", "◿"],
  ["brick_stairs", "B·ST", "◿"],
  ["spruce_log", "S·LG", "▥"], ["spruce_planks", "S·PL", "▤"], ["spruce_leaves", "S·LF", "✤"], ["spruce_slab", "S·SL", "▂"], ["spruce_stairs", "S·ST", "◿"], ["spruce_door", "S·DR", "▥"],
  ["birch_log", "BI·LG", "▥"], ["birch_planks", "BI·PL", "▤"], ["birch_leaves", "BI·LF", "✤"], ["birch_slab", "BI·SL", "▂"], ["birch_stairs", "BI·ST", "◿"], ["birch_door", "BI·DR", "▥"],
  ["jungle_log", "J·LG", "▥"], ["jungle_planks", "J·PL", "▤"], ["jungle_leaves", "J·LF", "✤"], ["jungle_slab", "J·SL", "▂"], ["jungle_stairs", "J·ST", "◿"], ["jungle_door", "J·DR", "▥"],
  ["acacia_log", "A·LG", "▥"], ["acacia_planks", "A·PL", "▤"], ["acacia_leaves", "A·LF", "✤"], ["acacia_slab", "A·SL", "▂"], ["acacia_stairs", "A·ST", "◿"], ["acacia_door", "A·DR", "▥"],
  ["dark_oak_log", "DO·LG", "▥"], ["dark_oak_planks", "DO·PL", "▤"], ["dark_oak_leaves", "DO·LF", "✤"], ["dark_oak_slab", "DO·SL", "▂"], ["dark_oak_stairs", "DO·ST", "◿"], ["dark_oak_door", "DO·DR", "▥"],
  ["mangrove_log", "M·LG", "▥"], ["mangrove_planks", "M·PL", "▤"], ["mangrove_leaves", "M·LF", "✤"], ["mangrove_slab", "M·SL", "▂"], ["mangrove_stairs", "M·ST", "◿"], ["mangrove_door", "M·DR", "▥"],
  ["cherry_log", "C·LG", "▥"], ["cherry_planks", "C·PL", "▤"], ["cherry_leaves", "C·LF", "✤"], ["cherry_slab", "C·SL", "▂"], ["cherry_stairs", "C·ST", "◿"], ["cherry_door", "C·DR", "▥"],
  ["bamboo_block", "BAM", "▥"], ["bamboo_planks", "B·PL", "▤"], ["bamboo_slab", "B·SL", "▂"], ["bamboo_stairs", "B·ST", "◿"],
  ["quartz_block", "QTZ", "▦"], ["quartz_pillar", "Q·PL", "▥"], ["chiseled_quartz", "Q·CH", "▦"], ["quartz_slab", "Q·SL", "▂"], ["quartz_stairs", "Q·ST", "◿"],
  ["granite", "GRA", "▦"], ["polished_granite", "P·GR", "▦"], ["diorite", "DIO", "▦"], ["polished_diorite", "P·DI", "▦"],
  ["andesite", "AND", "▦"], ["polished_andesite", "P·AN", "▦"], ["sandstone", "SAND", "▦"], ["cut_sandstone", "C·SA", "▦"],
  ["chiseled_sandstone", "CH·S", "▦"], ["smooth_stone", "SM·S", "▦"], ["calcite", "CAL", "▦"], ["deepslate", "DEEP", "▦"],
  ["white_stained_glass", "WHIT", "▦"],
  ["white_concrete", "WHIT", "▦"],
  ["orange_stained_glass", "ORAN", "▦"],
  ["orange_concrete", "ORAN", "▦"],
  ["magenta_stained_glass", "MAGE", "▦"],
  ["magenta_concrete", "MAGE", "▦"],
  ["light_blue_stained_glass", "LIGH", "▦"],
  ["light_blue_concrete", "LIGH", "▦"],
  ["yellow_stained_glass", "YELL", "▦"],
  ["yellow_concrete", "YELL", "▦"],
  ["lime_stained_glass", "LIME", "▦"],
  ["lime_concrete", "LIME", "▦"],
  ["pink_stained_glass", "PINK", "▦"],
  ["pink_concrete", "PINK", "▦"],
  ["gray_stained_glass", "GRAY", "▦"],
  ["gray_concrete", "GRAY", "▦"],
  ["light_gray_stained_glass", "LIGH", "▦"],
  ["light_gray_concrete", "LIGH", "▦"],
  ["cyan_stained_glass", "CYAN", "▦"],
  ["cyan_concrete", "CYAN", "▦"],
  ["purple_stained_glass", "PURP", "▦"],
  ["purple_concrete", "PURP", "▦"],
  ["blue_stained_glass", "BLUE", "▦"],
  ["blue_concrete", "BLUE", "▦"],
  ["brown_stained_glass", "BROW", "▦"],
  ["brown_concrete", "BROW", "▦"],
  ["green_stained_glass", "GREE", "▦"],
  ["green_concrete", "GREE", "▦"],
  ["red_stained_glass", "RED_", "▦"],
  ["red_concrete", "RED_", "▦"],
  ["black_stained_glass", "BLAC", "▦"],
  ["black_concrete", "BLAC", "▦"],
  ["glowstone", "GLOW", "▦"],
  ["sea_lantern", "SEA_", "▦"],
  ["shroomlight", "SHRO", "▦"],
  ["ochre_froglight", "OCHR", "▦"],
  ["verdant_froglight", "VERD", "▦"],
  ["pearlescent_froglight", "PEAR", "▦"],
  ["magma_block", "MAGM", "▦"],
  ["mossy_cobblestone", "MOSS", "▦"],
  ["mossy_stone_bricks", "MOSS", "▦"],
  ["cracked_stone_bricks", "CRAC", "▦"],
  ["chiseled_stone_bricks", "CHIS", "▦"],
  ["packed_mud", "PACK", "▦"],
  ["mud_bricks", "MUD_", "▦"],
  ["prismarine", "PRIS", "▦"],
  ["prismarine_bricks", "PRIS", "▦"],
  ["dark_prismarine", "DARK", "▦"],
  ["nether_bricks", "NETH", "▦"],
  ["red_nether_bricks", "RED_", "▦"],
  ["blackstone", "BLAC", "▦"],
  ["polished_blackstone", "POLI", "▦"],
  ["polished_blackstone_bricks", "POLI", "▦"],
  ["end_stone", "END_", "▦"],
  ["end_stone_bricks", "END_", "▦"],
  ["purpur_block", "PURP", "▦"],
  ["obsidian", "OBSI", "▦"],
  ["crying_obsidian", "CRYI", "▦"],
  ["orange_wool", "ORAN", "▦"], ["magenta_wool", "MAGE", "▦"], ["light_blue_wool", "LIGH", "▦"],
  ["yellow_wool", "YELL", "▦"], ["lime_wool", "LIME", "▦"], ["pink_wool", "PINK", "▦"],
  ["gray_wool", "GRAY", "▦"], ["light_gray_wool", "LIGH", "▦"], ["cyan_wool", "CYAN", "▦"],
  ["purple_wool", "PURP", "▦"], ["blue_wool", "BLUE", "▦"], ["brown_wool", "BROW", "▦"],
  ["green_wool", "GREE", "▦"], ["red_wool", "RED", "▦"], ["black_wool", "BLAC", "▦"],
  ["white_terracotta", "WHIT", "▦"], ["white_glazed_terracotta", "WHIT", "▦"],
  ["orange_terracotta", "ORAN", "▦"], ["orange_glazed_terracotta", "ORAN", "▦"],
  ["magenta_terracotta", "MAGE", "▦"], ["magenta_glazed_terracotta", "MAGE", "▦"],
  ["light_blue_terracotta", "LIGH", "▦"], ["light_blue_glazed_terracotta", "LIGH", "▦"],
  ["yellow_terracotta", "YELL", "▦"], ["yellow_glazed_terracotta", "YELL", "▦"],
  ["lime_terracotta", "LIME", "▦"], ["lime_glazed_terracotta", "LIME", "▦"],
  ["pink_terracotta", "PINK", "▦"], ["pink_glazed_terracotta", "PINK", "▦"],
  ["gray_terracotta", "GRAY", "▦"], ["gray_glazed_terracotta", "GRAY", "▦"],
  ["light_gray_terracotta", "LIGH", "▦"], ["light_gray_glazed_terracotta", "LIGH", "▦"],
  ["cyan_terracotta", "CYAN", "▦"], ["cyan_glazed_terracotta", "CYAN", "▦"],
  ["purple_terracotta", "PURP", "▦"], ["purple_glazed_terracotta", "PURP", "▦"],
  ["blue_terracotta", "BLUE", "▦"], ["blue_glazed_terracotta", "BLUE", "▦"],
  ["brown_terracotta", "BROW", "▦"], ["brown_glazed_terracotta", "BROW", "▦"],
  ["green_terracotta", "GREE", "▦"], ["green_glazed_terracotta", "GREE", "▦"],
  ["red_terracotta", "RED", "▦"], ["red_glazed_terracotta", "RED", "▦"],
  ["black_terracotta", "BLAC", "▦"], ["black_glazed_terracotta", "BLAC", "▦"],
  ["red_sandstone", "REDS", "▦"], ["cut_red_sandstone", "CUTR", "▦"],
  ["chiseled_red_sandstone", "CHIS", "▦"], ["smooth_sandstone", "SMOO", "▦"],
  ["smooth_red_sandstone", "SMOO", "▦"], ["amethyst_block", "AMET", "▦"],
  ["budding_amethyst", "BUDD", "▦"], ["tuff", "TUFF", "▦"], ["dripstone_block", "DRIP", "▦"],
  ["copper_block", "COPP", "▦"], ["exposed_copper", "EXPO", "▦"],
  ["weathered_copper", "WEAT", "▦"], ["oxidized_copper", "OXID", "▦"], ["cut_copper", "CUTC", "▦"],
  ["exposed_cut_copper", "EXPO", "▦"], ["weathered_cut_copper", "WEAT", "▦"],
  ["oxidized_cut_copper", "OXID", "▦"], ["sculk", "SCUL", "▦"], ["nether_wart_block", "NETH", "▦"],
  ["cobbled_deepslate", "COBB", "▦"],
  ["polished_deepslate", "POLI", "▦"],
  ["deepslate_bricks", "DEEP", "▦"],
  ["deepslate_tiles", "DEEP", "▦"],
  ["stone_slab", "STO·SL", "▂"],
  ["stone_stairs", "STO·ST", "◿"],
  ["sandstone_slab", "SAN·SL", "▂"],
  ["sandstone_stairs", "SAN·ST", "◿"],
  ["smooth_sandstone_slab", "SMO·SL", "▂"],
  ["smooth_sandstone_stairs", "SMO·ST", "◿"],
  ["red_sandstone_slab", "RED·SL", "▂"],
  ["red_sandstone_stairs", "RED·ST", "◿"],
  ["smooth_red_sandstone_slab", "SMO·SL", "▂"],
  ["smooth_red_sandstone_stairs", "SMO·ST", "◿"],
  ["nether_brick_slab", "NET·SL", "▂"],
  ["nether_brick_stairs", "NET·ST", "◿"],
  ["blackstone_slab", "BLA·SL", "▂"],
  ["blackstone_stairs", "BLA·ST", "◿"],
  ["polished_blackstone_slab", "POL·SL", "▂"],
  ["polished_blackstone_stairs", "POL·ST", "◿"],
  ["polished_blackstone_brick_slab", "POL·SL", "▂"],
  ["polished_blackstone_brick_stairs", "POL·ST", "◿"],
  ["cobbled_deepslate_slab", "COB·SL", "▂"],
  ["cobbled_deepslate_stairs", "COB·ST", "◿"],
  ["polished_deepslate_slab", "POL·SL", "▂"],
  ["polished_deepslate_stairs", "POL·ST", "◿"],
  ["deepslate_brick_slab", "DEE·SL", "▂"],
  ["deepslate_brick_stairs", "DEE·ST", "◿"],
  ["deepslate_tile_slab", "DEE·SL", "▂"],
  ["deepslate_tile_stairs", "DEE·ST", "◿"],
  ["waxed_copper_block","WAXE","▦"],
  ["waxed_exposed_copper","WAXE","▦"],
  ["waxed_weathered_copper","WAXE","▦"],
  ["waxed_oxidized_copper","WAXE","▦"],
  ["waxed_cut_copper","WAXE","▦"],
  ["waxed_exposed_cut_copper","WAXE","▦"],
  ["waxed_weathered_cut_copper","WAXE","▦"],
  ["waxed_oxidized_cut_copper","WAXE","▦"],
  ["polished_tuff","POLI","▦"],
  ["tuff_bricks","TUFF","▦"],
  ["resin_bricks","RESI","▦"],
  ["granite_slab","GRA·SL","▂"],
  ["granite_stairs","GRA·ST","◿"],
  ["polished_granite_slab","POL·SL","▂"],
  ["polished_granite_stairs","POL·ST","◿"],
  ["diorite_slab","DIO·SL","▂"],
  ["diorite_stairs","DIO·ST","◿"],
  ["polished_diorite_slab","POL·SL","▂"],
  ["polished_diorite_stairs","POL·ST","◿"],
  ["andesite_slab","AND·SL","▂"],
  ["andesite_stairs","AND·ST","◿"],
  ["polished_andesite_slab","POL·SL","▂"],
  ["polished_andesite_stairs","POL·ST","◿"],
  ["mossy_cobblestone_slab","MOS·SL","▂"],
  ["mossy_cobblestone_stairs","MOS·ST","◿"],
  ["mossy_stone_brick_slab","MOS·SL","▂"],
  ["mossy_stone_brick_stairs","MOS·ST","◿"],
  ["mud_brick_slab","MUD·SL","▂"],
  ["mud_brick_stairs","MUD·ST","◿"],
  ["prismarine_slab","PRI·SL","▂"],
  ["prismarine_stairs","PRI·ST","◿"],
  ["prismarine_brick_slab","PRI·SL","▂"],
  ["prismarine_brick_stairs","PRI·ST","◿"],
  ["dark_prismarine_slab","DAR·SL","▂"],
  ["dark_prismarine_stairs","DAR·ST","◿"],
  ["red_nether_brick_slab","RED·SL","▂"],
  ["red_nether_brick_stairs","RED·ST","◿"],
  ["end_stone_brick_slab","END·SL","▂"],
  ["end_stone_brick_stairs","END·ST","◿"],
  ["purpur_slab","PUR·SL","▂"],
  ["purpur_stairs","PUR·ST","◿"],
  ["cut_copper_slab","CUT·SL","▂"],
  ["cut_copper_stairs","CUT·ST","◿"],
  ["exposed_cut_copper_slab","EXP·SL","▂"],
  ["exposed_cut_copper_stairs","EXP·ST","◿"],
  ["weathered_cut_copper_slab","WEA·SL","▂"],
  ["weathered_cut_copper_stairs","WEA·ST","◿"],
  ["oxidized_cut_copper_slab","OXI·SL","▂"],
  ["oxidized_cut_copper_stairs","OXI·ST","◿"],
  ["waxed_cut_copper_slab","WAX·SL","▂"],
  ["waxed_cut_copper_stairs","WAX·ST","◿"],
  ["waxed_exposed_cut_copper_slab","WAX·SL","▂"],
  ["waxed_exposed_cut_copper_stairs","WAX·ST","◿"],
  ["waxed_weathered_cut_copper_slab","WAX·SL","▂"],
  ["waxed_weathered_cut_copper_stairs","WAX·ST","◿"],
  ["waxed_oxidized_cut_copper_slab","WAX·SL","▂"],
  ["waxed_oxidized_cut_copper_stairs","WAX·ST","◿"],
  ["tuff_slab","TUF·SL","▂"],
  ["tuff_stairs","TUF·ST","◿"],
  ["polished_tuff_slab","POL·SL","▂"],
  ["polished_tuff_stairs","POL·ST","◿"],
  ["tuff_brick_slab","TUF·SL","▂"],
  ["tuff_brick_stairs","TUF·ST","◿"],
  ["resin_brick_slab","RES·SL","▂"],
  ["resin_brick_stairs","RES·ST","◿"],
  ["cactus","CAC","▥"], ["short_grass","GRS","✣"], ["dandelion","DAN","✿"], ["poppy","POP","✿"],
] as const;

const BASIC_ITEM_SPECS: readonly BasicItemSpec[] = [
  ["stick", "Stick", "STK", "A straight handle for simple tools.", "╱", "#c09557"],
  ["string", "String", "STR", "Strong fiber spun by spiders and used to tension bows.", "∿", "#d8d3c5"],
  ["bone", "Bone", "BON", "A dry skeleton bone that can be ground into bone meal.", "╱", "#ded8bf"],
  ["bone_meal", "Bone Meal", "BML", "Powdered bone that rapidly grows oak saplings.", "⁙", "#e6e1ce"],
  ["feather", "Feather", "FTH", "A light chicken feather used to fletch arrows.", "≀", "#e7e1ce"],
  ["arrow", "Arrow", "ARR", "A flint-tipped projectile fired from a bow.", "↗", "#c6b38a"],
  ["leather", "Leather", "LTH", "Tough hide used for lightweight armor.", "◩", "#8d552f"],
  ["coal", "Coal", "COL", "Dense furnace fuel recovered from coal ore.", "✦", "#30332e"],
  ["charcoal", "Charcoal", "CHR", "Charred oak fuel made by smelting a log.", "▰", "#383632"],
  ["raw_iron", "Raw Iron", "R·FE", "Freshly mined iron that must be smelted.", "◈", "#b78062"],
  ["iron_ingot", "Iron Ingot", "I·FE", "Refined iron for durable tools and armor.", "▰", "#d6d5cc"],
  ["raw_gold", "Raw Gold", "R·AU", "A soft gold-bearing mineral that must be smelted.", "✦", "#dba92d"],
  ["gold_ingot", "Gold Ingot", "I·AU", "Refined gold for fast but fragile equipment.", "▰", "#f5d142"],
  ["diamond", "Diamond", "DIA", "A rare crystal for the strongest available equipment.", "◆", "#48d8cf"],
  ["gunpowder", "Gunpowder", "GUN", "A dark, volatile powder dropped by creepers and used to craft TNT.", "⁙", "#515650"],
  ["flint", "Flint", "FLT", "A sharp stone chip recovered while shoveling gravel.", "◆", "#3f4543"],
  ["clay_ball", "Clay Ball", "CLY", "A lump of soft clay ready to be fired in a furnace.", "●", "#aeb4c5"],
  ["brick", "Brick", "BRK", "A fired clay brick used to build masonry blocks.", "▰", "#a65342"],
];

const CONTAINER_ITEM_SPECS = [
  ["bucket", "Bucket", "BKT", "An iron bucket for carrying a source block of water or lava.", "#aeb3b3", 16],
  ["water_bucket", "Water Bucket", "W·BK", "A bucket filled from a water source.", "#3f76e4", 1],
  ["lava_bucket", "Lava Bucket", "L·BK", "A bucket filled from a lava source.", "#e26716", 1],
] as const;

const UTILITY_ITEM_SPECS: readonly UtilityItemSpec[] = [
  ["flint_and_steel", "Flint and Steel", "F&S", "A steel striker for lighting TNT. It lasts for 64 ignitions.", "⌁", "#b9bfbc", 64],
  ["shears", "Shears", "SHR", "Iron shears that preserve leaf blocks when clipping them.", "✂", "#c8cfcc", 238],
];

const RANGED_ITEM_SPECS: readonly RangedItemSpec[] = [[
  "bow", "Bow", "BOW", "A ranged weapon that fires arrows after being drawn.",
  "tool", 1, ")", "#a8753f", 384, 1000,
]];

const FOOD_ITEM_SPECS: readonly FoodItemSpec[] = [
  ["apple", "Apple", "APL", 4, "A crisp oak apple that restores four hunger points.", "●", "#c83228"],
  ["pork", "Raw Pork", "PRK", 3, "Raw pork from a pig.", "◒", "#d98e8b"],
  ["beef", "Raw Beef", "BEF", 4, "Raw beef from a cow.", "◆", "#a9544d"],
  ["mutton", "Raw Mutton", "MTN", 3, "Raw mutton from a sheep.", "◇", "#b66b63"],
  ["raw_chicken", "Raw Chicken", "R·CH", 2, "Raw chicken from a chicken. Cooking it makes a much better meal.", "◖", "#d9a69a"],
  ["cooked_pork", "Cooked Pork", "C·PK", 8, "Furnace-roasted pork that restores substantial hunger.", "◒", "#b96649"],
  ["cooked_beef", "Steak", "STK", 8, "Furnace-cooked beef that restores substantial hunger.", "◆", "#743b32"],
  ["cooked_mutton", "Cooked Mutton", "C·MT", 6, "Furnace-roasted mutton.", "◇", "#825047"],
  ["cooked_chicken", "Cooked Chicken", "C·CH", 6, "Furnace-roasted chicken that restores substantial hunger.", "◖", "#a8663e"],
  ["rotten_flesh", "Rotten Flesh", "ROT", 1, "Unpleasant, but technically edible.", "✦", "#756d3e"],
];

const TOOL_KIND_SPECS = [
  ["pickaxe", "Pickaxe", "PX", "⌁"], ["axe", "Axe", "AX", "◒"],
  ["shovel", "Shovel", "SH", "♠"], ["sword", "Sword", "SW", "†"],
] as const;

const TOOL_TIER_SPECS = [
  ["wooden", "Wood", "W", "wood", "#b7874d", ["A light pick for fieldstone.", "A rough axe for timber.", "A broad wooden spade for earth.", "A simple wooden blade for defense."]],
  ["stone", "Stone", "S", "stone", "#a3a69e", ["A sturdy pick for quick quarrying.", "A weighty axe for felling trees.", "A stone-edged spade that clears earth quickly.", "A dependable stone blade."]],
  ["iron", "Iron", "I", "iron", "#d6d5cc", ["A durable pick for deep mining.", "A keen iron axe for timber.", "An iron spade that moves soil rapidly.", "A strong iron blade for hostile creatures."]],
  ["golden", "Golden", "G", "gold", "#f5d142", ["Exceptionally fast, but too soft for advanced ores.", "A very fast but fragile timber axe.", "A very fast but fragile spade.", "A bright blade with little staying power."]],
  ["diamond", "Diamond", "D", "diamond", "#48d8cf", ["A deep-mining pick with exceptional durability.", "A durable, devastating timber axe.", "A durable shovel for rapid excavation.", "A powerful diamond blade."]],
] as const;

const ARMOR_PIECE_SPECS = [
  ["helmet", "HD", "head", "⌒"], ["chestplate", "CH", "chest", "▣"],
  ["leggings", "LG", "legs", "⋒"], ["boots", "FT", "feet", "∪"],
] as const;

const ARMOR_MATERIAL_SPECS = [
  ["leather", "Leather", "L", "#9b6339", "leather", ["Cap", "Tunic", "Pants", "Boots"], [1, 3, 2, 1], ["A light cap of hardened hide.", "A flexible hide tunic.", "Tough hide protection for the legs.", "Soft boots for rough terrain."]],
  ["iron", "Iron", "I", "#d6d5cc", "iron", ["Helmet", "Chestplate", "Leggings", "Boots"], [2, 6, 5, 2], ["A fitted iron helmet.", "A solid iron chestplate.", "Articulated iron leg protection.", "Heavy iron boots."]],
  ["golden", "Golden", "G", "#f5d142", "gold", ["Helmet", "Chestplate", "Leggings", "Boots"], [2, 5, 3, 1], ["A soft but brilliant gold helmet.", "A gleaming gold chestplate.", "Gold leg protection.", "Light gold boots."]],
  ["diamond", "Diamond", "D", "#48d8cf", "diamond", ["Helmet", "Chestplate", "Leggings", "Boots"], [3, 8, 6, 3], ["A durable diamond helmet.", "The strongest available chest protection.", "Durable diamond leg protection.", "Durable diamond boots."]],
] as const;

const ITEM_ENTRIES: Array<readonly [ItemId, ItemDefinition]> = [
  ...BLOCK_ITEM_SPECS.map(([id, shortLabel, glyph]) => [id, blockItem(id, shortLabel, glyph)] as const),
  ...BASIC_ITEM_SPECS.map(([id, label, shortLabel, description, glyph, color]) => [id, {
    id, label, shortLabel, description, category: "material", maxStack: 64, glyph, color,
  }] as const),
  ...CONTAINER_ITEM_SPECS.map(([id, label, shortLabel, description, color, maxStack]) => [id, {
    id, label, shortLabel, description, category: "material", maxStack, glyph: "▣", color,
    ...(id === "water_bucket" ? { placesBlock: "water" as const }
      : id === "lava_bucket" ? { placesBlock: "lava" as const } : {}),
  }] as const),
  ...UTILITY_ITEM_SPECS.map(([id, label, shortLabel, description, glyph, color, maxDurability]) => [id, {
    id, label, shortLabel, description, category: "tool", maxStack: 1, glyph, color,
    utility: { maxDurability },
  }] as const),
  ...RANGED_ITEM_SPECS.map(([id, label, shortLabel, description, category, maxStack, glyph, color, maxDurability, maxChargeMs]) => [id, {
    id, label, shortLabel, description, category, maxStack, glyph, color,
    ranged: { maxDurability, maxChargeMs },
  }] as const),
  ...FOOD_ITEM_SPECS.map((spec) => [spec[0], foodItem(...spec)] as const),
  ...TOOL_TIER_SPECS.flatMap(([idPrefix, labelPrefix, shortPrefix, tier, color, descriptions]) => (
    TOOL_KIND_SPECS.map(([kind, kindLabel, kindShort, glyph], index) => {
      const id = `${idPrefix}_${kind}` as ToolId;
      return [id, toolItem(id, `${labelPrefix} ${kindLabel}`, `${shortPrefix}·${kindShort}`, kind, tier, descriptions[index], glyph, color)] as const;
    })
  )),
  ...ARMOR_MATERIAL_SPECS.flatMap(([idPrefix, labelPrefix, shortPrefix, color, material, pieceLabels, protections, descriptions]) => (
    ARMOR_PIECE_SPECS.map(([piece, pieceShort, slot, glyph], index) => {
      const id = `${idPrefix}_${piece}` as ArmorId;
      return [id, armorItem(id, `${labelPrefix} ${pieceLabels[index]}`, `${shortPrefix}·${pieceShort}`, slot, protections[index], descriptions[index], glyph, color, material)] as const;
    })
  )),
];

export const ITEMS = Object.fromEntries(ITEM_ENTRIES) as Record<ItemId, ItemDefinition>;

type RecipeIngredientSpec = readonly [itemId: ItemId, count: number, tag?: RecipeIngredientTag];

function craftingTableRecipe(id: ItemId, ingredients: readonly RecipeIngredientSpec[], outputCount = 1): Recipe {
  const item = ITEMS[id];
  return {
    id,
    label: item.label,
    note: item.description,
    craftingContext: "crafting_table",
    ingredients: ingredients.map(([itemId, count, tag]) => ({ itemId, count, ...(tag ? { tag } : {}) })),
    output: { itemId: id, count: outputCount },
  };
}

function woodPlankRecipe(family: WoodFamilyDefinition): Recipe {
  if (!family.log || !family.plankRecipeId) throw new Error(`Wood family ${family.id} cannot make planks from a log.`);
  const log = family.log as ItemId;
  const planks = family.planks as ItemId;
  const familyName = family.id.replaceAll("_", " ");
  const woodName = family.id === "oak" ? "" : `${familyName} `;
  return {
    id: family.plankRecipeId,
    label: `Saw ${woodName}planks`,
    note: `Split one ${woodName}log into four ${family.id === "oak" ? "boards" : `${woodName}planks`}.`,
    craftingContext: "field",
    ingredients: [{ itemId: log, count: 1 }],
    output: { itemId: planks, count: 4 },
  };
}

function woodSmeltingRecipe(family: WoodFamilyDefinition): SmeltingRecipe {
  if (!family.log || !family.charcoalRecipeId) throw new Error(`Wood family ${family.id} cannot make charcoal.`);
  return { id: family.charcoalRecipeId, label: "Make charcoal", input: family.log as ItemId, output: "charcoal" };
}

const WOOD_LOG_FAMILIES = WOOD_FAMILY_DEFINITIONS.filter(
  (family) => family.log !== null && family.plankRecipeId !== null && family.charcoalRecipeId !== null,
);
const GENERATED_WOOD_PLANK_RECIPES = WOOD_LOG_FAMILIES.map(woodPlankRecipe);
const GENERATED_WOOD_SMELTING_RECIPES = WOOD_LOG_FAMILIES.map(woodSmeltingRecipe);

const GENERATED_TOOL_RECIPES = ([
  ["wooden", "planks", "wooden_planks"],
  ["stone", "cobblestone", undefined],
  ["iron", "iron_ingot", undefined],
  ["golden", "gold_ingot", undefined],
  ["diamond", "diamond", undefined],
] as const).flatMap(([prefix, material, materialTag]) => ([
  ["pickaxe", 3, 2],
  ["axe", 3, 2],
  ["shovel", 1, 2],
  ["sword", 2, 1],
] as const).map(([kind, materialCount, stickCount]) => craftingTableRecipe(
  `${prefix}_${kind}` as ToolId,
  [[material, materialCount, materialTag], ["stick", stickCount]],
)));

const GENERATED_ARMOR_RECIPES = ([
  ["leather", "leather"],
  ["iron", "iron_ingot"],
  ["golden", "gold_ingot"],
  ["diamond", "diamond"],
] as const).flatMap(([prefix, material]) => ([
  ["helmet", 5],
  ["chestplate", 8],
  ["leggings", 7],
  ["boots", 4],
] as const).map(([piece, count]) => craftingTableRecipe(
  `${prefix}_${piece}` as ArmorId,
  [[material, count]],
)));

const GENERATED_WOOD_SHAPE_RECIPES = WOOD_FAMILY_DEFINITIONS.flatMap((family) => {
  const planks = family.planks as ItemId;
  const recipes = [
    craftingTableRecipe(family.slab as ItemId, [[planks, 3]], 6),
    craftingTableRecipe(family.stairs as ItemId, [[planks, 6]], 4),
  ];
  if (family.door) recipes.push(craftingTableRecipe(family.door as ItemId, [[planks, 6]]));
  return recipes;
});

export const RECIPES: readonly Recipe[] = [
  ...GENERATED_WOOD_PLANK_RECIPES,
  { id: "sticks_from_planks", label: "Whittle sticks", note: "Two boards make four handles.", craftingContext: "field", ingredients: [{ itemId: "planks", count: 2, tag: "wooden_planks" }], output: { itemId: "stick", count: 4 } },
  { id: "crafting_table", label: "Crafting table", note: "Four boards make a proper workbench.", craftingContext: "field", ingredients: [{ itemId: "planks", count: 4, tag: "wooden_planks" }], output: { itemId: "crafting_table", count: 1 } },
  { id: "torch", label: "Torches", note: "A lump of coal and a stick make four warm lights.", craftingContext: "field", ingredients: [{ itemId: "coal", count: 1 }, { itemId: "stick", count: 1 }], output: { itemId: "torch", count: 4 } },
  { id: "torch_charcoal", label: "Charcoal torches", note: "A piece of charcoal and a stick make four warm lights.", craftingContext: "field", ingredients: [{ itemId: "charcoal", count: 1 }, { itemId: "stick", count: 1 }], output: { itemId: "torch", count: 4 } },
  { id: "bone_meal", label: "Bone meal", note: "One bone makes three handfuls of bone meal.", craftingContext: "field", ingredients: [{ itemId: "bone", count: 1 }], output: { itemId: "bone_meal", count: 3 } },
  { id: "stone_bricks", label: "Stone bricks", note: "Four stone blocks make four fitted stone bricks.", craftingContext: "field", ingredients: [{ itemId: "stone", count: 4 }], output: { itemId: "stone_bricks", count: 4 } },
  { id: "oak_fence", label: "Oak fence", note: "Four boards and two sticks make three oak fence sections.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 4 }, { itemId: "stick", count: 2 }], output: { itemId: "oak_fence", count: 3 } },
  { id: "oak_fence_gate", label: "Oak fence gate", note: "Two boards and four sticks make one hinged oak gate.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 2 }, { itemId: "stick", count: 4 }], output: { itemId: "oak_fence_gate", count: 1 } },
  { id: "stone_brick_slab", label: "Stone brick slabs", note: "Three stone bricks make six half-height building slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "stone_bricks", count: 3 }], output: { itemId: "stone_brick_slab", count: 6 } },
  { id: "bricks", label: "Bricks", note: "Four fired bricks make one masonry block.", craftingContext: "field", ingredients: [{ itemId: "brick", count: 4 }], output: { itemId: "bricks", count: 1 } },
  { id: "cobblestone_slab", label: "Cobblestone slabs", note: "Three cobblestone make six half-height building slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "cobblestone", count: 3 }], output: { itemId: "cobblestone_slab", count: 6 } },
  { id: "brick_slab", label: "Brick slabs", note: "Three brick blocks make six half-height building slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "bricks", count: 3 }], output: { itemId: "brick_slab", count: 6 } },
  { id: "cobblestone_stairs", label: "Cobblestone stairs", note: "Six cobblestone make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "cobblestone", count: 6 }], output: { itemId: "cobblestone_stairs", count: 4 } },
  { id: "stone_brick_stairs", label: "Stone brick stairs", note: "Six stone bricks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "stone_bricks", count: 6 }], output: { itemId: "stone_brick_stairs", count: 4 } },
  { id: "brick_stairs", label: "Brick stairs", note: "Six brick blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "bricks", count: 6 }], output: { itemId: "brick_stairs", count: 4 } },
  { id: "furnace", label: "Furnace", note: "Eight cobblestone make a furnace for ore and food.", craftingContext: "crafting_table", ingredients: [{ itemId: "cobblestone", count: 8 }], output: { itemId: "furnace", count: 1 } },
  { id: "ladder", label: "Ladders", note: "Seven sticks make three climbable rungs.", craftingContext: "crafting_table", ingredients: [{ itemId: "stick", count: 7 }], output: { itemId: "ladder", count: 3 } },
  { id: "chest", label: "Chest", note: "Eight boards make shared storage.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 8, tag: "wooden_planks" }], output: { itemId: "chest", count: 1 } },
  { id: "bed", label: "Bed", note: "Three wool and three boards make a bed.", craftingContext: "crafting_table", ingredients: [{ itemId: "wool", count: 3, tag: "wool" }, { itemId: "planks", count: 3, tag: "wooden_planks" }], output: { itemId: "bed", count: 1 } },
  { id: "tnt", label: "TNT", note: "Five gunpowder and four sand make one volatile block.", craftingContext: "crafting_table", ingredients: [{ itemId: "gunpowder", count: 5 }, { itemId: "sand", count: 4 }], output: { itemId: "tnt", count: 1 } },
  { id: "stone_slab", label: "Stone Slab", note: "Three stone blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "stone", count: 3 }], output: { itemId: "stone_slab", count: 6 } },
  { id: "stone_stairs", label: "Stone Stairs", note: "Six stone blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "stone", count: 6 }], output: { itemId: "stone_stairs", count: 4 } },
  { id: "sandstone_slab", label: "Sandstone Slab", note: "Three sandstone blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "sandstone", count: 3 }], output: { itemId: "sandstone_slab", count: 6 } },
  { id: "sandstone_stairs", label: "Sandstone Stairs", note: "Six sandstone blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "sandstone", count: 6 }], output: { itemId: "sandstone_stairs", count: 4 } },
  { id: "smooth_sandstone_slab", label: "Smooth Sandstone Slab", note: "Three smooth sandstone blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "smooth_sandstone", count: 3 }], output: { itemId: "smooth_sandstone_slab", count: 6 } },
  { id: "smooth_sandstone_stairs", label: "Smooth Sandstone Stairs", note: "Six smooth sandstone blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "smooth_sandstone", count: 6 }], output: { itemId: "smooth_sandstone_stairs", count: 4 } },
  { id: "red_sandstone_slab", label: "Red Sandstone Slab", note: "Three red sandstone blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "red_sandstone", count: 3 }], output: { itemId: "red_sandstone_slab", count: 6 } },
  { id: "red_sandstone_stairs", label: "Red Sandstone Stairs", note: "Six red sandstone blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "red_sandstone", count: 6 }], output: { itemId: "red_sandstone_stairs", count: 4 } },
  { id: "smooth_red_sandstone_slab", label: "Smooth Red Sandstone Slab", note: "Three smooth red sandstone blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "smooth_red_sandstone", count: 3 }], output: { itemId: "smooth_red_sandstone_slab", count: 6 } },
  { id: "smooth_red_sandstone_stairs", label: "Smooth Red Sandstone Stairs", note: "Six smooth red sandstone blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "smooth_red_sandstone", count: 6 }], output: { itemId: "smooth_red_sandstone_stairs", count: 4 } },
  { id: "nether_brick_slab", label: "Nether Brick Slab", note: "Three nether bricks blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "nether_bricks", count: 3 }], output: { itemId: "nether_brick_slab", count: 6 } },
  { id: "nether_brick_stairs", label: "Nether Brick Stairs", note: "Six nether bricks blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "nether_bricks", count: 6 }], output: { itemId: "nether_brick_stairs", count: 4 } },
  { id: "blackstone_slab", label: "Blackstone Slab", note: "Three blackstone blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "blackstone", count: 3 }], output: { itemId: "blackstone_slab", count: 6 } },
  { id: "blackstone_stairs", label: "Blackstone Stairs", note: "Six blackstone blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "blackstone", count: 6 }], output: { itemId: "blackstone_stairs", count: 4 } },
  { id: "polished_blackstone_slab", label: "Polished Blackstone Slab", note: "Three polished blackstone blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "polished_blackstone", count: 3 }], output: { itemId: "polished_blackstone_slab", count: 6 } },
  { id: "polished_blackstone_stairs", label: "Polished Blackstone Stairs", note: "Six polished blackstone blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "polished_blackstone", count: 6 }], output: { itemId: "polished_blackstone_stairs", count: 4 } },
  { id: "polished_blackstone_brick_slab", label: "Polished Blackstone Brick Slab", note: "Three polished blackstone bricks blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "polished_blackstone_bricks", count: 3 }], output: { itemId: "polished_blackstone_brick_slab", count: 6 } },
  { id: "polished_blackstone_brick_stairs", label: "Polished Blackstone Brick Stairs", note: "Six polished blackstone bricks blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "polished_blackstone_bricks", count: 6 }], output: { itemId: "polished_blackstone_brick_stairs", count: 4 } },
  { id: "cobbled_deepslate_slab", label: "Cobbled Deepslate Slab", note: "Three cobbled deepslate blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "cobbled_deepslate", count: 3 }], output: { itemId: "cobbled_deepslate_slab", count: 6 } },
  { id: "cobbled_deepslate_stairs", label: "Cobbled Deepslate Stairs", note: "Six cobbled deepslate blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "cobbled_deepslate", count: 6 }], output: { itemId: "cobbled_deepslate_stairs", count: 4 } },
  { id: "polished_deepslate_slab", label: "Polished Deepslate Slab", note: "Three polished deepslate blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "polished_deepslate", count: 3 }], output: { itemId: "polished_deepslate_slab", count: 6 } },
  { id: "polished_deepslate_stairs", label: "Polished Deepslate Stairs", note: "Six polished deepslate blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "polished_deepslate", count: 6 }], output: { itemId: "polished_deepslate_stairs", count: 4 } },
  { id: "deepslate_brick_slab", label: "Deepslate Brick Slab", note: "Three deepslate bricks blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "deepslate_bricks", count: 3 }], output: { itemId: "deepslate_brick_slab", count: 6 } },
  { id: "deepslate_brick_stairs", label: "Deepslate Brick Stairs", note: "Six deepslate bricks blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "deepslate_bricks", count: 6 }], output: { itemId: "deepslate_brick_stairs", count: 4 } },
  { id: "deepslate_tile_slab", label: "Deepslate Tile Slab", note: "Three deepslate tiles blocks make six slabs.", craftingContext: "crafting_table", ingredients: [{ itemId: "deepslate_tiles", count: 3 }], output: { itemId: "deepslate_tile_slab", count: 6 } },
  { id: "deepslate_tile_stairs", label: "Deepslate Tile Stairs", note: "Six deepslate tiles blocks make four stairs.", craftingContext: "crafting_table", ingredients: [{ itemId: "deepslate_tiles", count: 6 }], output: { itemId: "deepslate_tile_stairs", count: 4 } },
  {"id":"granite_slab","label":"Granite Slab","note":"Three granite blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"granite","count":3}],"output":{"itemId":"granite_slab","count":6}},
  {"id":"granite_stairs","label":"Granite Stairs","note":"Six granite blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"granite","count":6}],"output":{"itemId":"granite_stairs","count":4}},
  {"id":"polished_granite_slab","label":"Polished Granite Slab","note":"Three polished granite blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"polished_granite","count":3}],"output":{"itemId":"polished_granite_slab","count":6}},
  {"id":"polished_granite_stairs","label":"Polished Granite Stairs","note":"Six polished granite blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"polished_granite","count":6}],"output":{"itemId":"polished_granite_stairs","count":4}},
  {"id":"diorite_slab","label":"Diorite Slab","note":"Three diorite blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"diorite","count":3}],"output":{"itemId":"diorite_slab","count":6}},
  {"id":"diorite_stairs","label":"Diorite Stairs","note":"Six diorite blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"diorite","count":6}],"output":{"itemId":"diorite_stairs","count":4}},
  {"id":"polished_diorite_slab","label":"Polished Diorite Slab","note":"Three polished diorite blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"polished_diorite","count":3}],"output":{"itemId":"polished_diorite_slab","count":6}},
  {"id":"polished_diorite_stairs","label":"Polished Diorite Stairs","note":"Six polished diorite blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"polished_diorite","count":6}],"output":{"itemId":"polished_diorite_stairs","count":4}},
  {"id":"andesite_slab","label":"Andesite Slab","note":"Three andesite blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"andesite","count":3}],"output":{"itemId":"andesite_slab","count":6}},
  {"id":"andesite_stairs","label":"Andesite Stairs","note":"Six andesite blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"andesite","count":6}],"output":{"itemId":"andesite_stairs","count":4}},
  {"id":"polished_andesite_slab","label":"Polished Andesite Slab","note":"Three polished andesite blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"polished_andesite","count":3}],"output":{"itemId":"polished_andesite_slab","count":6}},
  {"id":"polished_andesite_stairs","label":"Polished Andesite Stairs","note":"Six polished andesite blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"polished_andesite","count":6}],"output":{"itemId":"polished_andesite_stairs","count":4}},
  {"id":"mossy_cobblestone_slab","label":"Mossy Cobblestone Slab","note":"Three mossy cobblestone blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"mossy_cobblestone","count":3}],"output":{"itemId":"mossy_cobblestone_slab","count":6}},
  {"id":"mossy_cobblestone_stairs","label":"Mossy Cobblestone Stairs","note":"Six mossy cobblestone blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"mossy_cobblestone","count":6}],"output":{"itemId":"mossy_cobblestone_stairs","count":4}},
  {"id":"mossy_stone_brick_slab","label":"Mossy Stone Brick Slab","note":"Three mossy stone bricks blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"mossy_stone_bricks","count":3}],"output":{"itemId":"mossy_stone_brick_slab","count":6}},
  {"id":"mossy_stone_brick_stairs","label":"Mossy Stone Brick Stairs","note":"Six mossy stone bricks blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"mossy_stone_bricks","count":6}],"output":{"itemId":"mossy_stone_brick_stairs","count":4}},
  {"id":"mud_brick_slab","label":"Mud Brick Slab","note":"Three mud bricks blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"mud_bricks","count":3}],"output":{"itemId":"mud_brick_slab","count":6}},
  {"id":"mud_brick_stairs","label":"Mud Brick Stairs","note":"Six mud bricks blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"mud_bricks","count":6}],"output":{"itemId":"mud_brick_stairs","count":4}},
  {"id":"prismarine_slab","label":"Prismarine Slab","note":"Three prismarine blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"prismarine","count":3}],"output":{"itemId":"prismarine_slab","count":6}},
  {"id":"prismarine_stairs","label":"Prismarine Stairs","note":"Six prismarine blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"prismarine","count":6}],"output":{"itemId":"prismarine_stairs","count":4}},
  {"id":"prismarine_brick_slab","label":"Prismarine Brick Slab","note":"Three prismarine bricks blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"prismarine_bricks","count":3}],"output":{"itemId":"prismarine_brick_slab","count":6}},
  {"id":"prismarine_brick_stairs","label":"Prismarine Brick Stairs","note":"Six prismarine bricks blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"prismarine_bricks","count":6}],"output":{"itemId":"prismarine_brick_stairs","count":4}},
  {"id":"dark_prismarine_slab","label":"Dark Prismarine Slab","note":"Three dark prismarine blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"dark_prismarine","count":3}],"output":{"itemId":"dark_prismarine_slab","count":6}},
  {"id":"dark_prismarine_stairs","label":"Dark Prismarine Stairs","note":"Six dark prismarine blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"dark_prismarine","count":6}],"output":{"itemId":"dark_prismarine_stairs","count":4}},
  {"id":"red_nether_brick_slab","label":"Red Nether Brick Slab","note":"Three red nether bricks blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"red_nether_bricks","count":3}],"output":{"itemId":"red_nether_brick_slab","count":6}},
  {"id":"red_nether_brick_stairs","label":"Red Nether Brick Stairs","note":"Six red nether bricks blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"red_nether_bricks","count":6}],"output":{"itemId":"red_nether_brick_stairs","count":4}},
  {"id":"end_stone_brick_slab","label":"End Stone Brick Slab","note":"Three end stone bricks blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"end_stone_bricks","count":3}],"output":{"itemId":"end_stone_brick_slab","count":6}},
  {"id":"end_stone_brick_stairs","label":"End Stone Brick Stairs","note":"Six end stone bricks blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"end_stone_bricks","count":6}],"output":{"itemId":"end_stone_brick_stairs","count":4}},
  {"id":"purpur_slab","label":"Purpur Slab","note":"Three purpur block blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"purpur_block","count":3}],"output":{"itemId":"purpur_slab","count":6}},
  {"id":"purpur_stairs","label":"Purpur Stairs","note":"Six purpur block blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"purpur_block","count":6}],"output":{"itemId":"purpur_stairs","count":4}},
  {"id":"cut_copper_slab","label":"Cut Copper Slab","note":"Three cut copper blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"cut_copper","count":3}],"output":{"itemId":"cut_copper_slab","count":6}},
  {"id":"cut_copper_stairs","label":"Cut Copper Stairs","note":"Six cut copper blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"cut_copper","count":6}],"output":{"itemId":"cut_copper_stairs","count":4}},
  {"id":"exposed_cut_copper_slab","label":"Exposed Cut Copper Slab","note":"Three exposed cut copper blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"exposed_cut_copper","count":3}],"output":{"itemId":"exposed_cut_copper_slab","count":6}},
  {"id":"exposed_cut_copper_stairs","label":"Exposed Cut Copper Stairs","note":"Six exposed cut copper blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"exposed_cut_copper","count":6}],"output":{"itemId":"exposed_cut_copper_stairs","count":4}},
  {"id":"weathered_cut_copper_slab","label":"Weathered Cut Copper Slab","note":"Three weathered cut copper blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"weathered_cut_copper","count":3}],"output":{"itemId":"weathered_cut_copper_slab","count":6}},
  {"id":"weathered_cut_copper_stairs","label":"Weathered Cut Copper Stairs","note":"Six weathered cut copper blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"weathered_cut_copper","count":6}],"output":{"itemId":"weathered_cut_copper_stairs","count":4}},
  {"id":"oxidized_cut_copper_slab","label":"Oxidized Cut Copper Slab","note":"Three oxidized cut copper blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"oxidized_cut_copper","count":3}],"output":{"itemId":"oxidized_cut_copper_slab","count":6}},
  {"id":"oxidized_cut_copper_stairs","label":"Oxidized Cut Copper Stairs","note":"Six oxidized cut copper blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"oxidized_cut_copper","count":6}],"output":{"itemId":"oxidized_cut_copper_stairs","count":4}},
  {"id":"waxed_cut_copper_slab","label":"Waxed Cut Copper Slab","note":"Three waxed cut copper blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"waxed_cut_copper","count":3}],"output":{"itemId":"waxed_cut_copper_slab","count":6}},
  {"id":"waxed_cut_copper_stairs","label":"Waxed Cut Copper Stairs","note":"Six waxed cut copper blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"waxed_cut_copper","count":6}],"output":{"itemId":"waxed_cut_copper_stairs","count":4}},
  {"id":"waxed_exposed_cut_copper_slab","label":"Waxed Exposed Cut Copper Slab","note":"Three waxed exposed cut copper blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"waxed_exposed_cut_copper","count":3}],"output":{"itemId":"waxed_exposed_cut_copper_slab","count":6}},
  {"id":"waxed_exposed_cut_copper_stairs","label":"Waxed Exposed Cut Copper Stairs","note":"Six waxed exposed cut copper blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"waxed_exposed_cut_copper","count":6}],"output":{"itemId":"waxed_exposed_cut_copper_stairs","count":4}},
  {"id":"waxed_weathered_cut_copper_slab","label":"Waxed Weathered Cut Copper Slab","note":"Three waxed weathered cut copper blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"waxed_weathered_cut_copper","count":3}],"output":{"itemId":"waxed_weathered_cut_copper_slab","count":6}},
  {"id":"waxed_weathered_cut_copper_stairs","label":"Waxed WeathOkay. Yeah, that makes sense. I think we should do that. Another thing too is yes to be honest the value on this product has been going fine so far.ered Cut Copper Stairs","note":"Six waxed weathered cut copper blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"waxed_weathered_cut_copper","count":6}],"output":{"itemId":"waxed_weathered_cut_copper_stairs","count":4}},
  {"id":"waxed_oxidized_cut_copper_slab","label":"Waxed Oxidized Cut Copper Slab","note":"Three waxed oxidized cut copper blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"waxed_oxidized_cut_copper","count":3}],"output":{"itemId":"waxed_oxidized_cut_copper_slab","count":6}},
  {"id":"waxed_oxidized_cut_copper_stairs","label":"Waxed Oxidized Cut Copper Stairs","note":"Six waxed oxidized cut copper blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"waxed_oxidized_cut_copper","count":6}],"output":{"itemId":"waxed_oxidized_cut_copper_stairs","count":4}},
  {"id":"tuff_slab","label":"Tuff Slab","note":"Three tuff blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"tuff","count":3}],"output":{"itemId":"tuff_slab","count":6}},
  {"id":"tuff_stairs","label":"Tuff Stairs","note":"Six tuff blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"tuff","count":6}],"output":{"itemId":"tuff_stairs","count":4}},
  {"id":"polished_tuff_slab","label":"Polished Tuff Slab","note":"Three polished tuff blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"polished_tuff","count":3}],"output":{"itemId":"polished_tuff_slab","count":6}},
  {"id":"polished_tuff_stairs","label":"Polished Tuff Stairs","note":"Six polished tuff blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"polished_tuff","count":6}],"output":{"itemId":"polished_tuff_stairs","count":4}},
  {"id":"tuff_brick_slab","label":"Tuff Brick Slab","note":"Three tuff bricks blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"tuff_bricks","count":3}],"output":{"itemId":"tuff_brick_slab","count":6}},
  {"id":"tuff_brick_stairs","label":"Tuff Brick Stairs","note":"Six tuff bricks blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"tuff_bricks","count":6}],"output":{"itemId":"tuff_brick_stairs","count":4}},
  {"id":"resin_brick_slab","label":"Resin Brick Slab","note":"Three resin bricks blocks make six slabs.","craftingContext":"crafting_table","ingredients":[{"itemId":"resin_bricks","count":3}],"output":{"itemId":"resin_brick_slab","count":6}},
  {"id":"resin_brick_stairs","label":"Resin Brick Stairs","note":"Six resin bricks blocks make four stairs.","craftingContext":"crafting_table","ingredients":[{"itemId":"resin_bricks","count":6}],"output":{"itemId":"resin_brick_stairs","count":4}},
  { id: "flint_and_steel", label: "Flint and steel", note: "Strike flint against iron to make a reusable igniter.", craftingContext: "field", ingredients: [{ itemId: "iron_ingot", count: 1 }, { itemId: "flint", count: 1 }], output: { itemId: "flint_and_steel", count: 1 } },
  { id: "shears", label: "Shears", note: "Two iron ingots make durable clipping shears.", craftingContext: "field", ingredients: [{ itemId: "iron_ingot", count: 2 }], output: { itemId: "shears", count: 1 } },
  { id: "bucket", label: "Bucket", note: "Three iron ingots make a bucket for carrying fluids.", craftingContext: "crafting_table", ingredients: [{ itemId: "iron_ingot", count: 3 }], output: { itemId: "bucket", count: 1 } },
  { id: "bow", label: "Bow", note: "Three sticks and three string make a ranged weapon.", craftingContext: "crafting_table", ingredients: [{ itemId: "stick", count: 3 }, { itemId: "string", count: 3 }], output: { itemId: "bow", count: 1 } },
  { id: "arrows", label: "Arrows", note: "Flint, a stick, and a feather make four arrows.", craftingContext: "crafting_table", ingredients: [{ itemId: "flint", count: 1 }, { itemId: "stick", count: 1 }, { itemId: "feather", count: 1 }], output: { itemId: "arrow", count: 4 } },
  ...GENERATED_TOOL_RECIPES,
  ...GENERATED_ARMOR_RECIPES,
  ...GENERATED_WOOD_SHAPE_RECIPES,
] as const;

export const SMELTING_RECIPES: readonly SmeltingRecipe[] = [
  ...GENERATED_WOOD_SMELTING_RECIPES,
  { id: "stone", label: "Smelt stone", input: "cobblestone", output: "stone" },
  { id: "iron_ingot", label: "Smelt iron", input: "raw_iron", output: "iron_ingot" },
  { id: "gold_ingot", label: "Smelt gold", input: "raw_gold", output: "gold_ingot" },
  { id: "glass", label: "Smelt glass", input: "sand", output: "glass" },
  { id: "brick", label: "Fire brick", input: "clay_ball", output: "brick" },
  { id: "cooked_pork", label: "Cook pork", input: "pork", output: "cooked_pork" },
  { id: "cooked_beef", label: "Cook beef", input: "beef", output: "cooked_beef" },
  { id: "cooked_mutton", label: "Cook mutton", input: "mutton", output: "cooked_mutton" },
  { id: "cooked_chicken", label: "Cook chicken", input: "raw_chicken", output: "cooked_chicken" },
] as const;

export function createEmptyInventory(size = INVENTORY_SIZE): Inventory {
  return Array.from({ length: Math.max(HOTBAR_SIZE, Math.floor(size)) }, () => null);
}

export function createEmptyEquipment(): Equipment {
  return { head: null, chest: null, legs: null, feet: null };
}

export function normalizeEquipment(value: unknown): Equipment {
  const equipment = createEmptyEquipment();
  if (!value || typeof value !== "object") return equipment;
  for (const slot of Object.keys(equipment) as ArmorSlot[]) {
    const candidate = (value as Partial<Record<ArmorSlot, unknown>>)[slot];
    const itemId = typeof candidate === "string"
      ? candidate
      : candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as { itemId?: unknown }).itemId
        : null;
    if (typeof itemId !== "string" || !(itemId in ITEMS)) continue;
    const armor = ITEMS[itemId as ItemId].armor;
    if (!armor || armor.slot !== slot) continue;
    const durabilityCandidate = typeof candidate === "object" && candidate
      ? (candidate as { durability?: unknown }).durability
      : undefined;
    const durability = typeof durabilityCandidate === "number" && Number.isInteger(durabilityCandidate)
      ? Math.max(1, Math.min(armor.maxDurability, durabilityCandidate))
      : armor.maxDurability;
    equipment[slot] = { itemId: itemId as ArmorId, durability };
  }
  return equipment;
}

export function createStarterInventory(): Inventory {
  const inventory = createEmptyInventory();
  inventory[0] = createItemStack("wooden_pickaxe", 1);
  inventory[1] = createItemStack("wooden_axe", 1);
  inventory[2] = { itemId: "dirt", count: 16 };
  inventory[3] = { itemId: "planks", count: 8 };
  return inventory;
}

export function cloneInventory(inventory: readonly (ItemStack | null)[]): Inventory {
  return inventory.map((stack) => stack ? { ...stack } : null);
}

export type SelectedPlacementConsumption =
  | { ok: true; inventory: Inventory }
  | { ok: false; inventory: Inventory };

/** Consumes one block from exactly the selected slot; duplicate stacks elsewhere are untouched. */
export function consumeSelectedPlacementStack(
  inventory: readonly (ItemStack | null)[],
  selectedSlot: number,
  expectedItemId: ItemId,
): SelectedPlacementConsumption {
  const next = cloneInventory(inventory);
  if (!Number.isInteger(selectedSlot) || selectedSlot < 0 || selectedSlot >= next.length) {
    return { ok: false, inventory: next };
  }
  const selected = next[selectedSlot];
  if (!selected || selected.itemId !== expectedItemId || selected.count < 1) {
    return { ok: false, inventory: next };
  }
  if (selected.count === 1) next[selectedSlot] = null;
  else next[selectedSlot] = { ...selected, count: selected.count - 1 };
  return { ok: true, inventory: next };
}

/** Creates canonical stacks; newly acquired tools and armor begin at full durability. */
export function createItemStack(itemId: ItemId, count = 1): ItemStack {
  const maximum = maxItemDurability(itemId);
  return maximum
    ? { itemId, count: 1, durability: maximum }
    : { itemId, count: Math.max(1, Math.min(ITEMS[itemId].maxStack, Math.floor(count))) };
}

export function maxItemDurability(itemId: ItemId): number | null {
  return ITEMS[itemId].tool?.maxDurability
    ?? ITEMS[itemId].armor?.maxDurability
    ?? ITEMS[itemId].ranged?.maxDurability
    ?? ITEMS[itemId].utility?.maxDurability
    ?? null;
}

export type DurableItemUseResult = {
  inventory: Inventory;
  used: boolean;
  broke: boolean;
  itemId: ItemId | null;
  remainingDurability: number | null;
};

/** Spends exactly one use from any canonical durable item after authority confirms an action. */
export function applyConfirmedDurableItemUse(
  inventory: readonly (ItemStack | null)[],
  slot: number,
  expectedItemId?: ItemId | null,
): DurableItemUseResult {
  const next = cloneInventory(inventory);
  if (!Number.isInteger(slot) || slot < 0 || slot >= next.length) {
    return { inventory: next, used: false, broke: false, itemId: null, remainingDurability: null };
  }
  const stack = next[slot];
  const maximum = stack ? maxItemDurability(stack.itemId) : null;
  if (!stack || maximum === null || (expectedItemId !== undefined && stack.itemId !== expectedItemId)) {
    return { inventory: next, used: false, broke: false, itemId: null, remainingDurability: null };
  }
  const remaining = (remainingItemDurability(stack) ?? maximum) - 1;
  if (remaining <= 0) {
    next[slot] = null;
    return { inventory: next, used: true, broke: true, itemId: stack.itemId, remainingDurability: 0 };
  }
  next[slot] = { itemId: stack.itemId, count: 1, durability: remaining };
  return { inventory: next, used: true, broke: false, itemId: stack.itemId, remainingDurability: remaining };
}

/** Legacy durable items without a value are treated as unused, never as broken. */
export function remainingItemDurability(stack: ItemStack): number | null {
  const maximum = maxItemDurability(stack.itemId);
  if (maximum === null) return null;
  return typeof stack.durability === "number" && Number.isInteger(stack.durability)
    ? Math.max(1, Math.min(maximum, stack.durability))
    : maximum;
}

export function itemStackIdentity(stack: ItemStack): string {
  return `${stack.itemId}:${remainingItemDurability(stack) ?? ""}`;
}

export function areItemStacksCompatible(left: ItemStack, right: ItemStack): boolean {
  return itemStackIdentity(left) === itemStackIdentity(right);
}

export type ToolUseKind = "mine" | "attack";
export type ToolUseResult = {
  inventory: Inventory;
  used: boolean;
  broke: boolean;
  itemId: ToolId | null;
  remainingDurability: number | null;
};

/**
 * Applies one confirmed use to the exact selected stack. Swords lose two
 * durability when used as an improvised mining tool, matching Minecraft.
 */
export function applyConfirmedToolUse(
  inventory: readonly (ItemStack | null)[],
  slot: number,
  kind: ToolUseKind,
  expectedItemId?: ItemId | null,
): ToolUseResult {
  const next = cloneInventory(inventory);
  if (!Number.isInteger(slot) || slot < 0 || slot >= next.length) {
    return { inventory: next, used: false, broke: false, itemId: null, remainingDurability: null };
  }
  const stack = next[slot];
  const tool = stack ? ITEMS[stack.itemId].tool : undefined;
  if (!stack || !tool || (expectedItemId !== undefined && stack.itemId !== expectedItemId)) {
    return { inventory: next, used: false, broke: false, itemId: null, remainingDurability: null };
  }
  const spent = kind === "mine" && tool.kind === "sword" ? 2 : 1;
  const remaining = (remainingItemDurability(stack) ?? tool.maxDurability) - spent;
  if (remaining <= 0) {
    next[slot] = null;
    return { inventory: next, used: true, broke: true, itemId: stack.itemId as ToolId, remainingDurability: 0 };
  }
  next[slot] = { itemId: stack.itemId, count: 1, durability: remaining };
  return { inventory: next, used: true, broke: false, itemId: stack.itemId as ToolId, remainingDurability: remaining };
}

export function normalizeInventory(value: unknown, size = INVENTORY_SIZE): Inventory {
  const output = createEmptyInventory(size);
  if (!Array.isArray(value)) return output;
  for (let index = 0; index < Math.min(output.length, value.length); index += 1) {
    const candidate = value[index] as { itemId?: unknown; count?: unknown; durability?: unknown } | null;
    if (!candidate || typeof candidate.itemId !== "string" || !(candidate.itemId in ITEMS) || typeof candidate.count !== "number" || !Number.isFinite(candidate.count)) continue;
    const itemId = candidate.itemId as ItemId;
    const count = Math.min(ITEMS[itemId].maxStack, Math.max(0, Math.floor(candidate.count)));
    if (count <= 0) continue;
    const maximum = maxItemDurability(itemId);
    if (maximum !== null) {
      const durability = typeof candidate.durability === "number" && Number.isInteger(candidate.durability)
        ? Math.max(1, Math.min(maximum, candidate.durability))
        : maximum;
      output[index] = { itemId, count: 1, durability };
    } else {
      output[index] = { itemId, count };
    }
  }
  return output;
}

export function normalizeHunger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_HUNGER, Math.floor(value)))
    : MAX_HUNGER;
}

function normalizeHealth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_HEALTH, value))
    : MAX_HEALTH;
}

function normalizeTimer(value: unknown, intervalSeconds: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(intervalSeconds, value))
    : 0;
}

/** Consumes exactly one food item from `inventoryIndex` when hunger is not full. */
export function consumeFood(
  inventory: readonly (ItemStack | null)[],
  inventoryIndex: number,
  hunger: number,
): FoodConsumptionResult {
  const next = cloneInventory(inventory);
  const currentHunger = normalizeHunger(hunger);
  if (!Number.isInteger(inventoryIndex) || inventoryIndex < 0 || inventoryIndex >= next.length) {
    return { ok: false, inventory: next, hunger: currentHunger, reason: "invalid_slot" };
  }
  const stack = next[inventoryIndex];
  if (!stack) return { ok: false, inventory: next, hunger: currentHunger, reason: "empty_slot" };
  const food = ITEMS[stack.itemId].food;
  if (!food) return { ok: false, inventory: next, hunger: currentHunger, reason: "not_food" };
  if (currentHunger >= MAX_HUNGER) return { ok: false, inventory: next, hunger: currentHunger, reason: "hunger_full" };

  const nextHunger = Math.min(MAX_HUNGER, currentHunger + food.hunger);
  if (stack.count === 1) next[inventoryIndex] = null;
  else stack.count -= 1;
  return {
    ok: true,
    inventory: next,
    hunger: nextHunger,
    consumed: stack.itemId,
    restored: nextHunger - currentHunger,
  };
}

export function createSurvivalTickState(hunger = MAX_HUNGER, health = MAX_HEALTH): SurvivalTickState {
  return {
    hunger: normalizeHunger(hunger),
    health: normalizeHealth(health),
    hungerProgressSeconds: 0,
    recoveryProgressSeconds: 0,
    starvationProgressSeconds: 0,
  };
}

/**
 * Advances hunger and health without accessing clocks or browser state.
 *
 * `activityMultiplier` is capped to 0..4 so callers may distinguish resting,
 * walking, and sprinting without allowing a delayed frame to drain the player
 * unboundedly. Elapsed time is likewise capped per call. Well-fed players heal
 * one point every four seconds at the cost of one hunger point; starving players
 * lose health at the same cadence but never below one health from starvation.
 */
export function tickSurvival(
  input: Readonly<SurvivalTickState>,
  elapsedSeconds: number,
  activityMultiplier = 1,
): SurvivalTickResult {
  const elapsed = Number.isFinite(elapsedSeconds)
    ? Math.max(0, Math.min(MAX_SURVIVAL_STEP_SECONDS, elapsedSeconds))
    : 0;
  const activity = Number.isFinite(activityMultiplier)
    ? Math.max(0, Math.min(4, activityMultiplier))
    : 1;
  let hunger = normalizeHunger(input.hunger);
  let health = normalizeHealth(input.health);
  let hungerProgressSeconds = normalizeTimer(input.hungerProgressSeconds, HUNGER_POINT_INTERVAL_SECONDS)
    + elapsed * activity;
  let recoveryProgressSeconds = normalizeTimer(input.recoveryProgressSeconds, HEALTH_RECOVERY_INTERVAL_SECONDS);
  let starvationProgressSeconds = normalizeTimer(input.starvationProgressSeconds, STARVATION_DAMAGE_INTERVAL_SECONDS);
  let hungerLost = 0;
  let healthRecovered = 0;
  let starvationDamage = 0;

  const passiveHungerLoss = Math.min(hunger, Math.floor(hungerProgressSeconds / HUNGER_POINT_INTERVAL_SECONDS));
  hunger -= passiveHungerLoss;
  hungerLost += passiveHungerLoss;
  hungerProgressSeconds -= passiveHungerLoss * HUNGER_POINT_INTERVAL_SECONDS;
  if (hunger === 0) hungerProgressSeconds = 0;

  if (hunger >= 18 && health < MAX_HEALTH) {
    recoveryProgressSeconds += elapsed;
    const recoveryEvents = Math.min(
      Math.floor(recoveryProgressSeconds / HEALTH_RECOVERY_INTERVAL_SECONDS),
      Math.ceil(MAX_HEALTH - health),
      hunger - 17,
    );
    healthRecovered = Math.min(recoveryEvents, MAX_HEALTH - health);
    health += healthRecovered;
    hunger -= recoveryEvents;
    hungerLost += recoveryEvents;
    recoveryProgressSeconds -= recoveryEvents * HEALTH_RECOVERY_INTERVAL_SECONDS;
    if (hunger < 18 || health >= MAX_HEALTH) recoveryProgressSeconds = 0;
  } else {
    recoveryProgressSeconds = 0;
  }

  if (hunger === 0 && health > STARVATION_MIN_HEALTH) {
    starvationProgressSeconds += elapsed;
    const starvationEvents = Math.min(
      Math.floor(starvationProgressSeconds / STARVATION_DAMAGE_INTERVAL_SECONDS),
      Math.ceil(health - STARVATION_MIN_HEALTH),
    );
    starvationDamage = Math.min(starvationEvents, health - STARVATION_MIN_HEALTH);
    health -= starvationDamage;
    starvationProgressSeconds -= starvationEvents * STARVATION_DAMAGE_INTERVAL_SECONDS;
    if (health <= STARVATION_MIN_HEALTH) starvationProgressSeconds = 0;
  } else {
    starvationProgressSeconds = 0;
  }

  return {
    state: { hunger, health, hungerProgressSeconds, recoveryProgressSeconds, starvationProgressSeconds },
    hungerLost,
    healthRecovered,
    starvationDamage,
  };
}

export function countItem(inventory: readonly (ItemStack | null)[], itemId: ItemId): number {
  return inventory.reduce((total, stack) => total + (stack?.itemId === itemId ? stack.count : 0), 0);
}

export function hasItems(inventory: readonly (ItemStack | null)[], quantities: readonly RecipeIngredient[]): boolean {
  return consumeRecipeIngredients(inventory, quantities) !== null;
}

export function addItem(inventory: readonly (ItemStack | null)[], itemId: ItemId, count = 1): { inventory: Inventory; remainder: number } {
  return addItemStack(inventory, createItemStack(itemId, count), count);
}

/** Atomically exchanges one selected container item without losing it when the inventory is full. */
export function exchangeSelectedItem(
  inventory: readonly (ItemStack | null)[], selected: number, expected: ItemId, replacement: ItemId,
): { ok: boolean; inventory: Inventory } {
  const next = cloneInventory(inventory), stack = next[selected];
  if (!stack || stack.itemId !== expected || stack.count < 1) return { ok: false, inventory: next };
  if (stack.count === 1) {
    next[selected] = createItemStack(replacement, 1);
    return { ok: true, inventory: next };
  }
  stack.count -= 1;
  const added = addItem(next, replacement, 1);
  return added.remainder ? { ok: false, inventory: cloneInventory(inventory) } : { ok: true, inventory: added.inventory };
}

/** Adds an exact metadata-bearing stack without repairing or merging worn tools. */
export function addItemStack(
  inventory: readonly (ItemStack | null)[],
  source: ItemStack,
  count = source.count,
): { inventory: Inventory; remainder: number } {
  const next = cloneInventory(inventory);
  let remainder = Math.max(0, Math.floor(count));
  const maxStack = ITEMS[source.itemId].maxStack;
  for (const stack of next) {
    if (remainder <= 0) break;
    if (!stack || !areItemStacksCompatible(stack, source) || stack.count >= maxStack) continue;
    const added = Math.min(maxStack - stack.count, remainder);
    stack.count += added;
    remainder -= added;
  }
  for (let index = 0; index < next.length && remainder > 0; index += 1) {
    if (next[index]) continue;
    const added = Math.min(maxStack, remainder);
    next[index] = { ...source, count: added };
    remainder -= added;
  }
  return { inventory: next, remainder };
}

export function removeItem(inventory: readonly (ItemStack | null)[], itemId: ItemId, count = 1): { inventory: Inventory; remainder: number } {
  const next = cloneInventory(inventory);
  let remainder = Math.max(0, Math.floor(count));
  for (let index = next.length - 1; index >= 0 && remainder > 0; index -= 1) {
    const stack = next[index];
    if (stack?.itemId !== itemId) continue;
    const removed = Math.min(stack.count, remainder);
    stack.count -= removed;
    remainder -= removed;
    if (stack.count <= 0) next[index] = null;
  }
  return { inventory: next, remainder };
}

function removeRecipeIngredient(
  inventory: readonly (ItemStack | null)[],
  ingredient: RecipeIngredient,
): { inventory: Inventory; remainder: number } {
  if (!ingredient.tag) return removeItem(inventory, ingredient.itemId, ingredient.count);
  const next = cloneInventory(inventory);
  let remainder = Math.max(0, Math.floor(ingredient.count));
  for (let index = next.length - 1; index >= 0 && remainder > 0; index -= 1) {
    const stack = next[index];
    if (!stack || !isItemInRecipeTag(stack.itemId, ingredient.tag)) continue;
    const removed = Math.min(stack.count, remainder);
    stack.count -= removed;
    remainder -= removed;
    if (stack.count <= 0) next[index] = null;
  }
  return { inventory: next, remainder };
}

function consumeRecipeIngredients(
  inventory: readonly (ItemStack | null)[],
  ingredients: readonly RecipeIngredient[],
): Inventory | null {
  let next = cloneInventory(inventory);
  const ordered = [...ingredients].sort((left, right) => Number(Boolean(left.tag)) - Number(Boolean(right.tag)));
  for (const ingredient of ordered) {
    if (!Number.isFinite(ingredient.count) || ingredient.count <= 0) return null;
    const removed = removeRecipeIngredient(next, ingredient);
    if (removed.remainder > 0) return null;
    next = removed.inventory;
  }
  return next;
}

export function recipeCraftingContext(recipeOrId: Recipe | string): CraftingContext | null {
  const recipe = typeof recipeOrId === "string" ? RECIPES.find(({ id }) => id === recipeOrId) : recipeOrId;
  return recipe?.craftingContext ?? null;
}

/** A crafting table includes the player's 2x2 field grid, so it can make either recipe class. */
export function isRecipeAvailableInContext(recipeOrId: Recipe | string, context: CraftingContext): boolean {
  const requiredContext = recipeCraftingContext(recipeOrId);
  return requiredContext === "field" || (requiredContext === "crafting_table" && context === "crafting_table");
}

export function availableRecipes(context: CraftingContext): readonly Recipe[] {
  return RECIPES.filter((recipe) => isRecipeAvailableInContext(recipe, context));
}

export function canCraft(
  inventory: readonly (ItemStack | null)[],
  recipe: Recipe,
  context: CraftingContext = "crafting_table",
): boolean {
  if (!isRecipeAvailableInContext(recipe, context)) return false;
  const consumed = consumeRecipeIngredients(inventory, recipe.ingredients);
  return consumed !== null && addItem(consumed, recipe.output.itemId, recipe.output.count).remainder === 0;
}

export function craftRecipe(
  inventory: readonly (ItemStack | null)[],
  recipeOrId: Recipe | string,
  context: CraftingContext = "crafting_table",
): CraftResult {
  const recipe = typeof recipeOrId === "string" ? RECIPES.find(({ id }) => id === recipeOrId) : recipeOrId;
  const original = cloneInventory(inventory);
  if (!recipe) return { ok: false, inventory: original, reason: "unknown_recipe" };
  if (!isRecipeAvailableInContext(recipe, context)) return { ok: false, inventory: original, reason: "requires_crafting_table" };
  const consumed = consumeRecipeIngredients(original, recipe.ingredients);
  if (!consumed) return { ok: false, inventory: original, reason: "missing_ingredients" };
  const added = addItem(consumed, recipe.output.itemId, recipe.output.count);
  if (added.remainder > 0) return { ok: false, inventory: cloneInventory(inventory), reason: "inventory_full" };
  return { ok: true, inventory: added.inventory, crafted: { ...recipe.output } };
}

/**
 * Burns one coal or charcoal to smelt up to eight matching inputs in one
 * atomic operation. Coal is chosen first when both fuels are present.
 * Capacity is checked after removing the input and fuel, since those removals may
 * legitimately free the slot needed by the output. Every failure returns a
 * detached copy of the original inventory and consumes nothing.
 */
export function smeltRecipe(
  inventory: readonly (ItemStack | null)[],
  recipeOrId: SmeltingRecipe | string,
): SmeltResult {
  const recipeId = typeof recipeOrId === "string" ? recipeOrId : recipeOrId.id;
  const recipe = SMELTING_RECIPES.find(({ id }) => id === recipeId);
  const original = cloneInventory(inventory);
  if (!recipe) return { ok: false, inventory: original, reason: "unknown_recipe" };

  const inputCount = countItem(original, recipe.input);
  if (inputCount < 1) return { ok: false, inventory: original, reason: "missing_input" };
  const fuelId: ItemId | null = countItem(original, "coal") >= 1
    ? "coal"
    : countItem(original, "charcoal") >= 1
      ? "charcoal"
      : null;
  if (!fuelId) return { ok: false, inventory: original, reason: "missing_fuel" };

  const batchSize = Math.min(8, inputCount);
  let next = removeItem(original, recipe.input, batchSize).inventory;
  next = removeItem(next, fuelId, 1).inventory;
  const added = addItem(next, recipe.output, batchSize);
  if (added.remainder > 0) return { ok: false, inventory: cloneInventory(inventory), reason: "inventory_full" };
  return {
    ok: true,
    inventory: added.inventory,
    smelted: { itemId: recipe.output, count: batchSize },
    fuelConsumed: 1,
  };
}

export function canHarvestBlock(blockId: BlockId, itemId?: ItemId | null): boolean {
  const requirement = BLOCKS[blockId].requiredDropTool;
  if (!requirement) return true;
  if (!itemId) return false;
  const tool = ITEMS[itemId].tool;
  if (!tool || tool.kind !== requirement.kind) return false;
  const tierRank: Record<Exclude<ToolTier, "none">, number> = { wood: 1, gold: 1, stone: 2, iron: 3, diamond: 4 };
  return tierRank[tool.tier] >= tierRank[requirement.minimumTier];
}

export function getMiningDrop(blockId: BlockId, itemId?: ItemId | null): ItemQuantity | null {
  if (!canHarvestBlock(blockId, itemId)) return null;
  const drop = BLOCKS[blockId].drop;
  return drop ? { itemId: drop, count: blockId === "clay" ? 4 : 1 } : null;
}

export const FLINT_DROP_CHANCE_DENOMINATOR = 10;
export const APPLE_DROP_CHANCE_DENOMINATOR = 200;
export const SAPLING_DROP_CHANCE_DENOMINATOR = 20;

/**
 * Coordinate-derived mining loot for the authoritative world operation path.
 * A shovel replaces exactly one in ten gravel drops with flint. Oak leaves
 * drop themselves only when cut with shears. Otherwise a leaf resolves one
 * conserved coordinate-derived result: an authentic one-in-two-hundred apple
 * roll has priority over a one-in-twenty sapling roll. No client RNG or extra
 * database row is involved, and every coordinate always resolves to the same
 * result in multiplayer and offline play.
 */
export function getDeterministicMiningDrop(
  blockId: BlockId,
  itemId: ItemId | null | undefined,
  x: number,
  y: number,
  z: number,
): ItemQuantity | null {
  const ordinary = getMiningDrop(blockId, itemId);
  if (blockId === "leaves" && itemId === "shears") return { itemId: "leaves", count: 1 };
  const hasCanonicalCoordinate = Number.isSafeInteger(x) && Number.isSafeInteger(y) && Number.isSafeInteger(z);
  if (blockId === "leaves") {
    if (!hasCanonicalCoordinate) return null;
    const coordinateHash = (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(z, 83_492_791)) >>> 0;
    const appleHash = Math.imul(coordinateHash ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;
    if (appleHash % APPLE_DROP_CHANCE_DENOMINATOR === 0) return { itemId: "apple", count: 1 };
    const saplingHash = Math.imul(coordinateHash ^ 0x6c8e9cf5, 0x45d9f3b) >>> 0;
    return saplingHash % SAPLING_DROP_CHANCE_DENOMINATOR === 0
      ? { itemId: "sapling", count: 1 }
      : null;
  }
  if (blockId !== "gravel" || !itemId || ITEMS[itemId].tool?.kind !== "shovel" || !hasCanonicalCoordinate) return ordinary;
  const coordinateHash = (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(z, 83_492_791)) >>> 0;
  return coordinateHash % FLINT_DROP_CHANCE_DENOMINATOR === 0
    ? { itemId: "flint", count: 1 }
    : ordinary;
}

export function selectedItem(inventory: readonly (ItemStack | null)[], selectedHotbar: number): ItemStack | null {
  return inventory[clampHotbarIndex(selectedHotbar)] ?? null;
}

export function clampHotbarIndex(value: number): number {
  return Math.max(0, Math.min(HOTBAR_SIZE - 1, Math.floor(Number.isFinite(value) ? value : 0)));
}

export function toolEffectiveness(blockId: BlockId, itemId?: ItemId | null): number {
  const block = BLOCKS[blockId];
  if (!itemId) return block.preferredTool === "hand" ? 1 : 0.55;
  const tool = ITEMS[itemId].tool;
  if (!tool) return block.preferredTool === "hand" ? 1 : 0.55;
  if (tool.kind !== block.preferredTool) return 0.5;
  return tool.tier === "gold" ? 12 : tool.tier === "diamond" ? 8 : tool.tier === "iron" ? 6 : tool.tier === "stone" ? 4 : 2.5;
}

export function toolEffectivenessLabel(blockId: BlockId, itemId?: ItemId | null): "ideal" | "workable" | "poor" {
  const multiplier = toolEffectiveness(blockId, itemId);
  return multiplier >= 2.5 ? "ideal" : multiplier >= 1 ? "workable" : "poor";
}

export function miningSeconds(blockId: BlockId, itemId?: ItemId | null): number {
  return Math.max(0.12, BLOCKS[blockId].hardness / toolEffectiveness(blockId, itemId));
}

export function attackDamage(itemId?: ItemId | null): number {
  return itemId ? ITEMS[itemId].tool?.attackDamage ?? 1 : 1;
}

export function armorProtection(itemId?: ItemId | null): number {
  return itemId ? ITEMS[itemId].armor?.protection ?? 0 : 0;
}

export function equippedArmorItemId(value: ArmorStack | ArmorId | null | undefined): ArmorId | null {
  return typeof value === "string" ? value : value?.itemId ?? null;
}

export function equippedArmorProtection(equipment: Equipment): number {
  return (Object.values(equipment) as Array<ArmorStack | ArmorId | null>)
    .reduce((total, stack) => total + armorProtection(equippedArmorItemId(stack)), 0);
}

export type ArmorDamageResult = {
  equipment: Equipment;
  damaged: ArmorSlot[];
  broken: Array<{ slot: ArmorSlot; itemId: ArmorId }>;
};

/** Applies one point of wear to every equipped piece after confirmed damage. */
export function applyConfirmedArmorDamage(equipment: Equipment): ArmorDamageResult {
  const next = normalizeEquipment(equipment);
  const damaged: ArmorSlot[] = [];
  const broken: Array<{ slot: ArmorSlot; itemId: ArmorId }> = [];
  for (const slot of Object.keys(next) as ArmorSlot[]) {
    const stack = next[slot];
    if (!stack) continue;
    damaged.push(slot);
    const remaining = stack.durability - 1;
    if (remaining <= 0) {
      broken.push({ slot, itemId: stack.itemId });
      next[slot] = null;
    } else {
      next[slot] = { ...stack, durability: remaining };
    }
  }
  return { equipment: next, damaged, broken };
}

export function equipArmorFromInventory(inventory: readonly (ItemStack | null)[], equipment: Equipment, inventoryIndex: number): EquipResult {
  const nextInventory = cloneInventory(inventory);
  const nextEquipment = normalizeEquipment(equipment);
  const stack = nextInventory[inventoryIndex];
  const armor = stack ? ITEMS[stack.itemId].armor : undefined;
  if (!stack) return { ok: false, inventory: nextInventory, equipment: nextEquipment, reason: "empty_slot" };
  if (!armor) return { ok: false, inventory: nextInventory, equipment: nextEquipment, reason: "not_armor" };
  const previous = nextEquipment[armor.slot];
  nextEquipment[armor.slot] = {
    itemId: stack.itemId as ArmorId,
    durability: remainingItemDurability(stack) ?? armor.maxDurability,
  };
  nextInventory[inventoryIndex] = previous ? { ...previous, count: 1 } : null;
  return { ok: true, inventory: nextInventory, equipment: nextEquipment };
}

export function unequipArmor(inventory: readonly (ItemStack | null)[], equipment: Equipment, slot: ArmorSlot): EquipResult {
  const nextEquipment = normalizeEquipment(equipment);
  const stack = nextEquipment[slot];
  if (!stack) return { ok: false, inventory: cloneInventory(inventory), equipment: nextEquipment, reason: "empty_slot" };
  const added = addItemStack(inventory, { ...stack, count: 1 }, 1);
  if (added.remainder) return { ok: false, inventory: cloneInventory(inventory), equipment: nextEquipment, reason: "inventory_full" };
  nextEquipment[slot] = null;
  return { ok: true, inventory: added.inventory, equipment: nextEquipment };
}

export function normalizeRespawnPoint(value: unknown): PlayerRespawnPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<Record<keyof PlayerRespawnPoint, unknown>>;
  const { x, y, z, yaw, pitch } = candidate;
  if (typeof x !== "number" || !Number.isFinite(x) || x < -64 || x > 64
    || typeof y !== "number" || !Number.isFinite(y) || y < 1 || y > 192
    || typeof z !== "number" || !Number.isFinite(z) || z < -64 || z > 64
    || typeof yaw !== "number" || !Number.isFinite(yaw) || yaw < -100_000 || yaw > 100_000
    || typeof pitch !== "number" || !Number.isFinite(pitch) || pitch < -1.52 || pitch > 1.52) {
    return null;
  }
  return { x, y, z, yaw, pitch };
}

export function createSerializablePlayerState(
  inventory: readonly (ItemStack | null)[] = createStarterInventory(),
  selectedHotbar = 0,
  equipment: Equipment = createEmptyEquipment(),
  respawnPoint: PlayerRespawnPoint | null = null,
  hunger = MAX_HUNGER,
): SerializablePlayerState {
  return {
    version: 4,
    inventory: normalizeInventory(inventory),
    selectedHotbar: clampHotbarIndex(selectedHotbar),
    equipment: normalizeEquipment(equipment),
    respawnPoint: normalizeRespawnPoint(respawnPoint),
    hunger: normalizeHunger(hunger),
  };
}

export function normalizeSerializablePlayerState(value: unknown): SerializablePlayerState {
  if (Array.isArray(value)) return createSerializablePlayerState(value);
  if (!value || typeof value !== "object") return createSerializablePlayerState();
  const candidate = value as {
    inventory?: unknown;
    selectedHotbar?: unknown;
    equipment?: unknown;
    respawnPoint?: unknown;
    hunger?: unknown;
  };
  return createSerializablePlayerState(
    Array.isArray(candidate.inventory) ? candidate.inventory as Array<ItemStack | null> : createStarterInventory(),
    typeof candidate.selectedHotbar === "number" ? candidate.selectedHotbar : 0,
    normalizeEquipment(candidate.equipment),
    normalizeRespawnPoint(candidate.respawnPoint),
    normalizeHunger(candidate.hunger),
  );
}

export function parseSerializablePlayerStateJson(rawJson: string): SerializablePlayerState | null {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!parsed || (typeof parsed !== "object" && !Array.isArray(parsed))) return null;
    return normalizeSerializablePlayerState(parsed);
  } catch {
    return null;
  }
}
