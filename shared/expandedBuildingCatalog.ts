/** Append-only creative families shared by the browser, Lakebed, and Railway. */
export const EXTRA_WOOD_FAMILIES = [
  "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry",
] as const;
export type ExtraWoodFamily = typeof EXTRA_WOOD_FAMILIES[number];
export const BUILDING_DIRECTIONS = ["east", "north", "south", "west"] as const;
export type BuildingDirection = typeof BUILDING_DIRECTIONS[number];
export const BUILDING_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;
export type BuildingColor = typeof BUILDING_COLORS[number];
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
export type DecorativeBlockItemId =
  | `${BuildingColor}_${"stained_glass" | "concrete"}`
  | typeof LUMINOUS_BLOCK_ITEMS[number]
  | typeof DECORATIVE_STONE_ITEMS[number]
  | typeof ADDITIONAL_COLOR_BLOCK_ITEMS[number]
  | typeof ADDITIONAL_ARCHITECTURAL_ITEMS[number];

export type ExpandedBlockItemId =
  | `${ExtraWoodFamily}_${"log" | "planks" | "leaves" | "slab" | "stairs" | "door"}`
  | `bamboo_${"block" | "planks" | "slab" | "stairs"}`
  | "quartz_block" | "quartz_pillar" | "chiseled_quartz" | "quartz_slab" | "quartz_stairs"
  | "granite" | "polished_granite" | "diorite" | "polished_diorite"
  | "andesite" | "polished_andesite" | "sandstone" | "cut_sandstone"
  | "chiseled_sandstone" | "smooth_stone" | "calcite" | "deepslate"
  | DecorativeBlockItemId;

export type ExpandedWorldBlockState = ExpandedBlockItemId
  | `${"oak" | "cobblestone" | "stone_brick" | "brick"}_stairs_upside_${BuildingDirection}`
  | `${ExtraWoodFamily | "bamboo" | "quartz"}_stairs_${BuildingDirection}`
  | `${ExtraWoodFamily | "bamboo" | "quartz"}_stairs_upside_${BuildingDirection}`
  | `${ExtraWoodFamily}_door_${"closed" | "open"}_${BuildingDirection}`
  | `oak_door_${"closed" | "open"}_${Exclude<BuildingDirection, "north">}`;

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
] as ExpandedBlockItemId[]);
