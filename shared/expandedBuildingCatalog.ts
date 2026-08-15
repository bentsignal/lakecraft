/** Append-only creative families shared by the browser, Lakebed, and Railway. */
export const EXTRA_WOOD_FAMILIES = [
  "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry",
] as const;
export type ExtraWoodFamily = typeof EXTRA_WOOD_FAMILIES[number];
export const BUILDING_DIRECTIONS = ["east", "north", "south", "west"] as const;
export type BuildingDirection = typeof BUILDING_DIRECTIONS[number];

export type ExpandedBlockItemId =
  | `${ExtraWoodFamily}_${"log" | "planks" | "leaves" | "slab" | "stairs" | "door"}`
  | `bamboo_${"block" | "planks" | "slab" | "stairs"}`
  | "quartz_block" | "quartz_pillar" | "chiseled_quartz" | "quartz_slab" | "quartz_stairs"
  | "granite" | "polished_granite" | "diorite" | "polished_diorite"
  | "andesite" | "polished_andesite" | "sandstone" | "cut_sandstone"
  | "chiseled_sandstone" | "smooth_stone" | "calcite" | "deepslate";

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
] as ExpandedBlockItemId[]);
