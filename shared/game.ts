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

export type BlockId = "grass" | "dirt" | "stone" | "cobblestone" | "sand" | "gravel" | "glass" | "coal_ore" | "iron_ore" | "gold_ore" | "diamond_ore" | "log" | "leaves" | "planks" | "crafting_table" | "furnace" | "torch" | "chest" | "door" | "bed" | "ladder" | "tnt";
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
  | "feather"
  | "arrow"
  | "bow"
  | "leather"
  | "wool"
  | "coal"
  | "raw_iron"
  | "iron_ingot"
  | "raw_gold"
  | "gold_ingot"
  | "diamond"
  | "gunpowder"
  | "flint"
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
  placesBlock?: BlockId;
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
  ingredients: ItemQuantity[];
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
  ]) => [id, {
    id,
    label,
    description,
    color,
    accent,
    hardness,
    preferredTool,
    ...(minimumTier ? { requiredDropTool: { kind: "pickaxe" as const, minimumTier } } : {}),
    drop,
  }])) as Record<BlockId, BlockDefinition>;
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
] as const;

const BASIC_ITEM_SPECS: readonly BasicItemSpec[] = [
  ["stick", "Stick", "STK", "A straight handle for simple tools.", "╱", "#c09557"],
  ["string", "String", "STR", "Strong fiber spun by spiders and used to tension bows.", "∿", "#d8d3c5"],
  ["bone", "Bone", "BON", "A dry skeleton bone with no use yet.", "╱", "#ded8bf"],
  ["feather", "Feather", "FTH", "A light chicken feather used to fletch arrows.", "≀", "#e7e1ce"],
  ["arrow", "Arrow", "ARR", "A flint-tipped projectile fired from a bow.", "↗", "#c6b38a"],
  ["leather", "Leather", "LTH", "Tough hide used for lightweight armor.", "◩", "#8d552f"],
  ["wool", "Wool", "WOL", "Soft sheep wool for beds and future textiles.", "◌", "#ddd8c8"],
  ["coal", "Coal", "COL", "Dense furnace fuel recovered from coal ore.", "✦", "#30332e"],
  ["raw_iron", "Raw Iron", "R·FE", "Freshly mined iron that must be smelted.", "◈", "#b78062"],
  ["iron_ingot", "Iron Ingot", "I·FE", "Refined iron for durable tools and armor.", "▰", "#d6d5cc"],
  ["raw_gold", "Raw Gold", "R·AU", "A soft gold-bearing mineral that must be smelted.", "✦", "#dba92d"],
  ["gold_ingot", "Gold Ingot", "I·AU", "Refined gold for fast but fragile equipment.", "▰", "#f5d142"],
  ["diamond", "Diamond", "DIA", "A rare crystal for the strongest available equipment.", "◆", "#48d8cf"],
  ["gunpowder", "Gunpowder", "GUN", "A dark, volatile powder dropped by creepers and used to craft TNT.", "⁙", "#515650"],
  ["flint", "Flint", "FLT", "A sharp stone chip recovered while shoveling gravel.", "◆", "#3f4543"],
];

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

type RecipeIngredientSpec = readonly [itemId: ItemId, count: number];

function craftingTableRecipe(id: ItemId, ingredients: readonly RecipeIngredientSpec[]): Recipe {
  const item = ITEMS[id];
  return {
    id,
    label: item.label,
    note: item.description,
    craftingContext: "crafting_table",
    ingredients: ingredients.map(([itemId, count]) => ({ itemId, count })),
    output: { itemId: id, count: 1 },
  };
}

const GENERATED_TOOL_RECIPES = ([
  ["wooden", "planks"],
  ["stone", "cobblestone"],
  ["iron", "iron_ingot"],
  ["golden", "gold_ingot"],
  ["diamond", "diamond"],
] as const).flatMap(([prefix, material]) => ([
  ["pickaxe", 3, 2],
  ["axe", 3, 2],
  ["shovel", 1, 2],
  ["sword", 2, 1],
] as const).map(([kind, materialCount, stickCount]) => craftingTableRecipe(
  `${prefix}_${kind}` as ToolId,
  [[material, materialCount], ["stick", stickCount]],
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

export const RECIPES: readonly Recipe[] = [
  { id: "planks_from_log", label: "Saw planks", note: "Split one log into four boards.", craftingContext: "field", ingredients: [{ itemId: "log", count: 1 }], output: { itemId: "planks", count: 4 } },
  { id: "sticks_from_planks", label: "Whittle sticks", note: "Two boards make four handles.", craftingContext: "field", ingredients: [{ itemId: "planks", count: 2 }], output: { itemId: "stick", count: 4 } },
  { id: "crafting_table", label: "Crafting table", note: "Four boards make a proper workbench.", craftingContext: "field", ingredients: [{ itemId: "planks", count: 4 }], output: { itemId: "crafting_table", count: 1 } },
  { id: "torch", label: "Torches", note: "A lump of coal and a stick make four warm lights.", craftingContext: "field", ingredients: [{ itemId: "coal", count: 1 }, { itemId: "stick", count: 1 }], output: { itemId: "torch", count: 4 } },
  { id: "furnace", label: "Furnace", note: "Eight cobblestone make a furnace for ore and food.", craftingContext: "crafting_table", ingredients: [{ itemId: "cobblestone", count: 8 }], output: { itemId: "furnace", count: 1 } },
  { id: "ladder", label: "Ladders", note: "Seven sticks make three climbable rungs.", craftingContext: "crafting_table", ingredients: [{ itemId: "stick", count: 7 }], output: { itemId: "ladder", count: 3 } },
  { id: "chest", label: "Chest", note: "Eight boards make shared storage.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 8 }], output: { itemId: "chest", count: 1 } },
  { id: "door", label: "Oak door", note: "Six boards make a shelter door.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 6 }], output: { itemId: "door", count: 1 } },
  { id: "bed", label: "Bed", note: "Three wool and three boards make a bed.", craftingContext: "crafting_table", ingredients: [{ itemId: "wool", count: 3 }, { itemId: "planks", count: 3 }], output: { itemId: "bed", count: 1 } },
  { id: "tnt", label: "TNT", note: "Five gunpowder and four sand make one volatile block.", craftingContext: "crafting_table", ingredients: [{ itemId: "gunpowder", count: 5 }, { itemId: "sand", count: 4 }], output: { itemId: "tnt", count: 1 } },
  { id: "flint_and_steel", label: "Flint and steel", note: "Strike flint against iron to make a reusable igniter.", craftingContext: "field", ingredients: [{ itemId: "iron_ingot", count: 1 }, { itemId: "flint", count: 1 }], output: { itemId: "flint_and_steel", count: 1 } },
  { id: "shears", label: "Shears", note: "Two iron ingots make durable clipping shears.", craftingContext: "field", ingredients: [{ itemId: "iron_ingot", count: 2 }], output: { itemId: "shears", count: 1 } },
  { id: "bow", label: "Bow", note: "Three sticks and three string make a ranged weapon.", craftingContext: "crafting_table", ingredients: [{ itemId: "stick", count: 3 }, { itemId: "string", count: 3 }], output: { itemId: "bow", count: 1 } },
  { id: "arrows", label: "Arrows", note: "Flint, a stick, and a feather make four arrows.", craftingContext: "crafting_table", ingredients: [{ itemId: "flint", count: 1 }, { itemId: "stick", count: 1 }, { itemId: "feather", count: 1 }], output: { itemId: "arrow", count: 4 } },
  ...GENERATED_TOOL_RECIPES,
  ...GENERATED_ARMOR_RECIPES,
] as const;

export const SMELTING_RECIPES: readonly SmeltingRecipe[] = [
  { id: "iron_ingot", label: "Smelt iron", input: "raw_iron", output: "iron_ingot" },
  { id: "gold_ingot", label: "Smelt gold", input: "raw_gold", output: "gold_ingot" },
  { id: "glass", label: "Smelt glass", input: "sand", output: "glass" },
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

export function hasItems(inventory: readonly (ItemStack | null)[], quantities: readonly ItemQuantity[]): boolean {
  const needed: Partial<Record<ItemId, number>> = {};
  for (const { itemId, count } of quantities) {
    if (count <= 0 || !Number.isFinite(count)) return false;
    needed[itemId] = (needed[itemId] ?? 0) + Math.floor(count);
  }
  return (Object.entries(needed) as Array<[ItemId, number]>).every(([itemId, count]) => countItem(inventory, itemId) >= count);
}

export function addItem(inventory: readonly (ItemStack | null)[], itemId: ItemId, count = 1): { inventory: Inventory; remainder: number } {
  return addItemStack(inventory, createItemStack(itemId, count), count);
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
  if (!hasItems(inventory, recipe.ingredients)) return false;
  let next = cloneInventory(inventory);
  for (const ingredient of recipe.ingredients) next = removeItem(next, ingredient.itemId, ingredient.count).inventory;
  return addItem(next, recipe.output.itemId, recipe.output.count).remainder === 0;
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
  if (!hasItems(original, recipe.ingredients)) return { ok: false, inventory: original, reason: "missing_ingredients" };
  let next = original;
  for (const ingredient of recipe.ingredients) next = removeItem(next, ingredient.itemId, ingredient.count).inventory;
  const added = addItem(next, recipe.output.itemId, recipe.output.count);
  if (added.remainder > 0) return { ok: false, inventory: cloneInventory(inventory), reason: "inventory_full" };
  return { ok: true, inventory: added.inventory, crafted: { ...recipe.output } };
}

/**
 * Burns one coal to smelt up to eight matching inputs in one atomic operation.
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
  if (countItem(original, "coal") < 1) return { ok: false, inventory: original, reason: "missing_fuel" };

  const batchSize = Math.min(8, inputCount);
  let next = removeItem(original, recipe.input, batchSize).inventory;
  next = removeItem(next, "coal", 1).inventory;
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
  return drop ? { itemId: drop, count: 1 } : null;
}

export const FLINT_DROP_CHANCE_DENOMINATOR = 10;
export const APPLE_DROP_CHANCE_DENOMINATOR = 20;

/**
 * Coordinate-derived mining loot for the authoritative world operation path.
 * A shovel replaces exactly one in ten gravel drops with flint. Oak leaves
 * drop themselves only when cut with shears; otherwise they have a fixed
 * one-in-twenty coordinate-derived chance to drop an apple. No client RNG or
 * extra database row is involved, and every coordinate always resolves to the
 * same conserved result in multiplayer and offline play.
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
    const leafHash = (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(z, 83_492_791)
      ^ 0x5bd1e995) >>> 0;
    return leafHash % APPLE_DROP_CHANCE_DENOMINATOR === 0
      ? { itemId: "apple", count: 1 }
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
  if (!itemId) return block.preferredTool === "hand" ? 1 : 0.35;
  const tool = ITEMS[itemId].tool;
  if (!tool) return block.preferredTool === "hand" ? 1 : 0.35;
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
    || typeof y !== "number" || !Number.isFinite(y) || y < -4 || y > 96
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
