/** Append-only creative families shared by the browser, Lakebed, and Railway. */
export const EXTRA_WOOD_FAMILIES = [
  "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry",
] as const;
export type ExtraWoodFamily = typeof EXTRA_WOOD_FAMILIES[number];

function defineStandardWoodFamily<const Family extends ExtraWoodFamily>(family: Family) {
  return {
    id: family,
    log: `${family}_log` as const,
    planks: `${family}_planks` as const,
    leaves: `${family}_leaves` as const,
    slab: `${family}_slab` as const,
    stairs: `${family}_stairs` as const,
    door: `${family}_door` as const,
    plankRecipeId: `${family}_planks_from_log` as const,
    charcoalRecipeId: `charcoal_from_${family}_log` as const,
  } as const;
}

/**
 * Single source of truth for wood capabilities and recipe relationships.
 * Standard tree families follow one naming convention. Oak keeps its legacy
 * item ids, while bamboo explicitly has no log, leaves, door, or charcoal path.
 */
export const WOOD_FAMILY_DEFINITIONS = [
  {
    id: "oak", log: "log", planks: "planks", leaves: "leaves",
    slab: "oak_slab", stairs: "oak_stairs", door: "door",
    plankRecipeId: "planks_from_log", charcoalRecipeId: "charcoal",
  },
  ...EXTRA_WOOD_FAMILIES.map(defineStandardWoodFamily),
  {
    id: "bamboo", log: null, planks: "bamboo_planks", leaves: null,
    slab: "bamboo_slab", stairs: "bamboo_stairs", door: null,
    plankRecipeId: null, charcoalRecipeId: null,
  },
] as const;
export type WoodFamilyDefinition = typeof WOOD_FAMILY_DEFINITIONS[number];
export type WoodFamilyId = WoodFamilyDefinition["id"];
export type WoodLogItemId = Exclude<WoodFamilyDefinition["log"], null>;
export type WoodPlankItemId = WoodFamilyDefinition["planks"];

export const BUILDING_DIRECTIONS = ["east", "north", "south", "west"] as const;
export type BuildingDirection = typeof BUILDING_DIRECTIONS[number];
export const BUILDING_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;
export type BuildingColor = typeof BUILDING_COLORS[number];
export const WOOD_LOG_ITEM_IDS = WOOD_FAMILY_DEFINITIONS.flatMap(({ log }) => log ? [log] : []) as readonly WoodLogItemId[];
export const WOOD_PLANK_ITEM_IDS = WOOD_FAMILY_DEFINITIONS.map(({ planks }) => planks) as readonly WoodPlankItemId[];
export const WOOL_ITEM_IDS = [
  "wool", ...BUILDING_COLORS.filter((color) => color !== "white").map((color) => `${color}_wool` as const),
] as const;
export const CRAFTABLE_WOOD_SHAPE_FAMILIES = WOOD_FAMILY_DEFINITIONS
  .filter(({ id }) => id !== "oak")
  .map(({ id }) => id) as readonly Exclude<WoodFamilyId, "oak">[];
export const LUMINOUS_BLOCK_ITEMS = [
  "glowstone", "sea_lantern", "shroomlight", "ochre_froglight", "verdant_froglight",
  "pearlescent_froglight", "magma_block",
] as const;
export const DECORATIVE_STONE_ITEMS = [
  "mossy_cobblestone", "mossy_stone_bricks", "cracked_stone_bricks", "chiseled_stone_bricks",
  "packed_mud", "mud_bricks", "prismarine", "prismarine_bricks", "dark_prismarine",
  "nether_bricks", "red_nether_bricks", "blackstone", "polished_blackstone",
  "polished_blackstone_bricks", "end_stone", "end_stone_bricks", "purpur_block", "obsidian",
  "crying_obsidian",
] as const;
export const ADDITIONAL_COLOR_BLOCK_ITEMS = [
  ...BUILDING_COLORS.filter((color) => color !== "white").map((color) => `${color}_wool` as const),
  ...BUILDING_COLORS.flatMap((color) => [
    `${color}_terracotta` as const,
    `${color}_glazed_terracotta` as const,
  ]),
] as const;
export const ADDITIONAL_ARCHITECTURAL_ITEMS = [
  "red_sandstone", "cut_red_sandstone", "chiseled_red_sandstone", "smooth_sandstone",
  "smooth_red_sandstone", "amethyst_block", "budding_amethyst", "tuff", "dripstone_block",
  "copper_block", "exposed_copper", "weathered_copper", "oxidized_copper", "cut_copper",
  "exposed_cut_copper", "weathered_cut_copper", "oxidized_cut_copper", "sculk",
  "nether_wart_block",
] as const;

/**
 * Append-only third catalog wave. Waxing preserves the corresponding copper
 * texture, while the tuff/resin entries use their own reviewed 26.2 tiles.
 * Keep this wave after every state shipped by the 499-entry v1 palette.
 */
export const CATALOG_V3_BLOCK_ITEMS = [
  "waxed_copper_block", "waxed_exposed_copper", "waxed_weathered_copper", "waxed_oxidized_copper",
  "waxed_cut_copper", "waxed_exposed_cut_copper", "waxed_weathered_cut_copper", "waxed_oxidized_cut_copper",
  "polished_tuff", "tuff_bricks", "resin_bricks",
] as const;

/**
 * Minecraft families whose existing full block has matching slab and stair
 * variants.  The tuple keeps the item/state prefix beside the exact source
 * block so catalog, recipes, rendering, and both multiplayer authorities
 * cannot silently disagree about plural names such as nether bricks.
 */
export const LEGACY_STONE_SHAPE_FAMILIES = [
  ["stone", "stone"],
  ["sandstone", "sandstone"],
  ["smooth_sandstone", "smooth_sandstone"],
  ["red_sandstone", "red_sandstone"],
  ["smooth_red_sandstone", "smooth_red_sandstone"],
  ["nether_brick", "nether_bricks"],
  ["blackstone", "blackstone"],
  ["polished_blackstone", "polished_blackstone"],
  ["polished_blackstone_brick", "polished_blackstone_bricks"],
  ["cobbled_deepslate", "cobbled_deepslate"],
  ["polished_deepslate", "polished_deepslate"],
  ["deepslate_brick", "deepslate_bricks"],
  ["deepslate_tile", "deepslate_tiles"],
] as const;

/** Matching slab/stair families appended after the complete deployed v1 tail. */
export const CATALOG_V3_STONE_SHAPE_FAMILIES = [
  ["granite", "granite"],
  ["polished_granite", "polished_granite"],
  ["diorite", "diorite"],
  ["polished_diorite", "polished_diorite"],
  ["andesite", "andesite"],
  ["polished_andesite", "polished_andesite"],
  ["mossy_cobblestone", "mossy_cobblestone"],
  ["mossy_stone_brick", "mossy_stone_bricks"],
  ["mud_brick", "mud_bricks"],
  ["prismarine", "prismarine"],
  ["prismarine_brick", "prismarine_bricks"],
  ["dark_prismarine", "dark_prismarine"],
  ["red_nether_brick", "red_nether_bricks"],
  ["end_stone_brick", "end_stone_bricks"],
  ["purpur", "purpur_block"],
  ["cut_copper", "cut_copper"],
  ["exposed_cut_copper", "exposed_cut_copper"],
  ["weathered_cut_copper", "weathered_cut_copper"],
  ["oxidized_cut_copper", "oxidized_cut_copper"],
  ["waxed_cut_copper", "cut_copper", "waxed_cut_copper"],
  ["waxed_exposed_cut_copper", "exposed_cut_copper", "waxed_exposed_cut_copper"],
  ["waxed_weathered_cut_copper", "weathered_cut_copper", "waxed_weathered_cut_copper"],
  ["waxed_oxidized_cut_copper", "oxidized_cut_copper", "waxed_oxidized_cut_copper"],
  ["tuff", "tuff"],
  ["polished_tuff", "polished_tuff"],
  ["tuff_brick", "tuff_bricks"],
  ["resin_brick", "resin_bricks"],
] as const;
export const STONE_SHAPE_FAMILIES = [
  ...LEGACY_STONE_SHAPE_FAMILIES,
  ...CATALOG_V3_STONE_SHAPE_FAMILIES,
] as const;
export type StoneShapeFamily = typeof STONE_SHAPE_FAMILIES[number][0];
export type StoneShapeSourceItem = typeof STONE_SHAPE_FAMILIES[number][1];
export const DEEPSLATE_BUILDING_ITEMS = [
  "cobbled_deepslate", "polished_deepslate", "deepslate_bricks", "deepslate_tiles",
] as const;
export const STAIR_MATERIAL_FAMILIES = [
  "oak", "cobblestone", "stone_brick", "brick", ...EXTRA_WOOD_FAMILIES, "bamboo", "quartz",
  ...STONE_SHAPE_FAMILIES.map(([family]) => family),
] as const;
export const STONE_SHAPE_TEXTURES = Object.freeze(Object.fromEntries(
  STONE_SHAPE_FAMILIES.map(([family, source]) => [family, source]),
)) as Readonly<Record<StoneShapeFamily, StoneShapeSourceItem>>;
export type DecorativeBlockItemId =
  | `${BuildingColor}_${"stained_glass" | "concrete"}`
  | typeof LUMINOUS_BLOCK_ITEMS[number]
  | typeof DECORATIVE_STONE_ITEMS[number]
  | typeof ADDITIONAL_COLOR_BLOCK_ITEMS[number]
  | typeof ADDITIONAL_ARCHITECTURAL_ITEMS[number]
  | typeof CATALOG_V3_BLOCK_ITEMS[number];

/** Naturally generated plants that are also available for Creative decoration. */
export const NATURAL_DECORATION_ITEMS = ["cactus", "short_grass", "dandelion", "poppy"] as const;
export type NaturalDecorationItem = typeof NATURAL_DECORATION_ITEMS[number];

export type ExpandedBlockItemId =
  | `${ExtraWoodFamily}_${"log" | "planks" | "leaves" | "slab" | "stairs" | "door"}`
  | `bamboo_${"block" | "planks" | "slab" | "stairs"}`
  | "quartz_block" | "quartz_pillar" | "chiseled_quartz" | "quartz_slab" | "quartz_stairs"
  | "granite" | "polished_granite" | "diorite" | "polished_diorite"
  | "andesite" | "polished_andesite" | "sandstone" | "cut_sandstone"
  | "chiseled_sandstone" | "smooth_stone" | "calcite" | "deepslate"
  | typeof DEEPSLATE_BUILDING_ITEMS[number]
  | `${StoneShapeFamily}_${"slab" | "stairs"}`
  | DecorativeBlockItemId | NaturalDecorationItem;

export type ExpandedWorldBlockState = ExpandedBlockItemId
  | `${"oak" | "cobblestone" | "stone_brick" | "brick"}_stairs_upside_${BuildingDirection}`
  | `${ExtraWoodFamily | "bamboo" | "quartz"}_stairs_${BuildingDirection}`
  | `${ExtraWoodFamily | "bamboo" | "quartz"}_stairs_upside_${BuildingDirection}`
  | `${StoneShapeFamily}_stairs_${BuildingDirection}`
  | `${StoneShapeFamily}_stairs_upside_${BuildingDirection}`
  | `${ExtraWoodFamily}_door_${"closed" | "open"}_${BuildingDirection}`
  | `oak_door_${"closed" | "open"}_${Exclude<BuildingDirection, "north">}`;

/** Natural states append after every deployed state so existing numeric IDs never move. */
export const NATURAL_BLOCK_STATE_TYPES = [
  "water", ...NATURAL_DECORATION_ITEMS,
  "water_flow_1", "water_flow_2", "water_flow_3", "water_flow_4",
  "water_flow_5", "water_flow_6", "water_flow_7",
  "lava", "lava_flow_1", "lava_flow_2", "lava_flow_3",
] as const;
export type NaturalBlockState = typeof NATURAL_BLOCK_STATE_TYPES[number];

const directions = BUILDING_DIRECTIONS as readonly string[];
const stairStates = (family: string): string[] => [
  ...directions.map((direction) => `${family}_stairs_${direction}`),
  ...directions.map((direction) => `${family}_stairs_upside_${direction}`),
];
const doorStates = (family: string): string[] => [
  ...directions.map((direction) => `${family}_door_closed_${direction}`),
  ...directions.map((direction) => `${family}_door_open_${direction}`),
];

export const EXPANDED_BLOCK_STATE_TYPES = Object.freeze([
  ...["oak", "cobblestone", "stone_brick", "brick"].flatMap((family) =>
    directions.map((direction) => `${family}_stairs_upside_${direction}`)),
  ...EXTRA_WOOD_FAMILIES.flatMap((family) => [
    `${family}_log`, `${family}_planks`, `${family}_leaves`, `${family}_slab`,
    ...stairStates(family), ...doorStates(family),
  ]),
  "bamboo_block", "bamboo_planks", "bamboo_slab", ...stairStates("bamboo"),
  "quartz_block", "quartz_pillar", "chiseled_quartz", "quartz_slab", ...stairStates("quartz"),
  "granite", "polished_granite", "diorite", "polished_diorite", "andesite", "polished_andesite",
  "sandstone", "cut_sandstone", "chiseled_sandstone", "smooth_stone", "calcite", "deepslate",
  ...["east", "south", "west"].map((direction) => `oak_door_closed_${direction}`),
  ...["east", "south", "west"].map((direction) => `oak_door_open_${direction}`),
  ...BUILDING_COLORS.flatMap((color) => [`${color}_stained_glass`, `${color}_concrete`]),
  ...LUMINOUS_BLOCK_ITEMS,
  ...DECORATIVE_STONE_ITEMS,
  ...ADDITIONAL_COLOR_BLOCK_ITEMS,
  ...ADDITIONAL_ARCHITECTURAL_ITEMS,
  ...DEEPSLATE_BUILDING_ITEMS,
  ...LEGACY_STONE_SHAPE_FAMILIES.flatMap(([family]) => [`${family}_slab`, ...stairStates(family)]),
  ...CATALOG_V3_BLOCK_ITEMS,
  ...CATALOG_V3_STONE_SHAPE_FAMILIES.flatMap(([family]) => [`${family}_slab`, ...stairStates(family)]),
] as ExpandedWorldBlockState[]);

export type ExpandedBlockConstantName = Uppercase<ExpandedWorldBlockState>;

export const EXPANDED_BLOCK_ITEM_IDS = Object.freeze([
  ...EXTRA_WOOD_FAMILIES.flatMap((family) => [
    `${family}_log`, `${family}_planks`, `${family}_leaves`, `${family}_slab`, `${family}_stairs`, `${family}_door`,
  ]),
  "bamboo_block", "bamboo_planks", "bamboo_slab", "bamboo_stairs",
  "quartz_block", "quartz_pillar", "chiseled_quartz", "quartz_slab", "quartz_stairs",
  "granite", "polished_granite", "diorite", "polished_diorite", "andesite", "polished_andesite",
  "sandstone", "cut_sandstone", "chiseled_sandstone", "smooth_stone", "calcite", "deepslate",
  ...BUILDING_COLORS.flatMap((color) => [`${color}_stained_glass`, `${color}_concrete`]),
  ...LUMINOUS_BLOCK_ITEMS,
  ...DECORATIVE_STONE_ITEMS,
  ...ADDITIONAL_COLOR_BLOCK_ITEMS,
  ...ADDITIONAL_ARCHITECTURAL_ITEMS,
  ...DEEPSLATE_BUILDING_ITEMS,
  ...LEGACY_STONE_SHAPE_FAMILIES.flatMap(([family]) => [`${family}_slab`, `${family}_stairs`]),
  ...CATALOG_V3_BLOCK_ITEMS,
  ...CATALOG_V3_STONE_SHAPE_FAMILIES.flatMap(([family]) => [`${family}_slab`, `${family}_stairs`]),
  ...NATURAL_DECORATION_ITEMS,
] as ExpandedBlockItemId[]);
