import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ITEMS } from "../shared/game.ts";
import { decodePng, encodePngRgba } from "./png-rgba.mjs";

const [jarArgument, outputArgument] = process.argv.slice(2);
if (!jarArgument || !outputArgument) {
  throw new Error("Usage: node scripts/import-minecraft-visual-assets.mjs minecraft-version.jar output.json");
}
const jarPath = resolve(jarArgument);
const outputPath = resolve(outputArgument);
const EXPECTED_JAR_SHA256 = "40896ee9f1e2bec3c934daac7e93d41e9e3d9c2f8ae0ca366d52ffbfd1afa290";
const jarBytes = await readFile(jarPath);
const jarSha256 = createHash("sha256").update(jarBytes).digest("hex");
if (jarSha256 !== EXPECTED_JAR_SHA256) {
  throw new Error(`Minecraft visual import requires the reviewed 26.2 JAR (${EXPECTED_JAR_SHA256}); received ${jarSha256}.`);
}
const ITEM_ALIASES = Object.freeze({
  pork: "porkchop",
  cooked_pork: "cooked_porkchop",
  raw_chicken: "chicken",
});
const MODEL_PATHS = Object.freeze({
  generated: "assets/minecraft/models/item/generated.json",
  handheld: "assets/minecraft/models/item/handheld.json",
  bow: "assets/minecraft/models/item/bow.json",
  block: "assets/minecraft/models/block/block.json",
});
const ENTITY_PATHS = Object.freeze({
  player_wide: "assets/minecraft/textures/entity/player/wide/steve.png",
  player_slim: "assets/minecraft/textures/entity/player/slim/steve.png",
  zombie: "assets/minecraft/textures/entity/zombie/zombie.png",
  skeleton: "assets/minecraft/textures/entity/skeleton/skeleton.png",
  creeper: "assets/minecraft/textures/entity/creeper/creeper.png",
  spider: "assets/minecraft/textures/entity/spider/spider.png",
  cow: "assets/minecraft/textures/entity/cow/cow_temperate.png",
  pig: "assets/minecraft/textures/entity/pig/pig_temperate.png",
  chicken: "assets/minecraft/textures/entity/chicken/chicken_temperate.png",
  sheep: "assets/minecraft/textures/entity/sheep/sheep.png",
  sheep_wool: "assets/minecraft/textures/entity/sheep/sheep_wool.png",
  chest_normal: "assets/minecraft/textures/entity/chest/normal.png",
});
const ARMOR_TEXTURE_PATHS = Object.freeze(Object.fromEntries(
  ["leather", "iron", "gold", "diamond"].flatMap((material) =>
    ["humanoid", "humanoid_leggings"].flatMap((layer) => [
      [`${material}_${layer}`, `assets/minecraft/textures/entity/equipment/${layer}/${material}.png`],
      ...(material === "leather" ? [[`${material}_${layer}_overlay`, `assets/minecraft/textures/entity/equipment/${layer}/leather_overlay.png`]] : []),
    ])),
));
const BLOCK_ITEM_MODEL_CHAINS = Object.freeze({
  chest: [
    "assets/minecraft/items/chest.json",
    "assets/minecraft/models/item/chest.json",
    "assets/minecraft/models/item/template_chest.json",
  ],
  oak_fence: [
    "assets/minecraft/items/oak_fence.json",
    "assets/minecraft/models/block/oak_fence_inventory.json",
    "assets/minecraft/models/block/fence_inventory.json",
    "assets/minecraft/models/block/block.json",
  ],
  oak_fence_gate: [
    "assets/minecraft/items/oak_fence_gate.json",
    "assets/minecraft/models/block/oak_fence_gate.json",
    "assets/minecraft/models/block/template_fence_gate.json",
    "assets/minecraft/models/block/block.json",
  ],
  stone_brick_slab: [
    "assets/minecraft/items/stone_brick_slab.json",
    "assets/minecraft/models/block/stone_brick_slab.json",
    "assets/minecraft/models/block/slab.json",
    "assets/minecraft/models/block/block.json",
  ],
  oak_slab: ["assets/minecraft/items/oak_slab.json", "assets/minecraft/models/block/oak_slab.json", "assets/minecraft/models/block/slab.json", "assets/minecraft/models/block/block.json"],
  cobblestone_slab: ["assets/minecraft/items/cobblestone_slab.json", "assets/minecraft/models/block/cobblestone_slab.json", "assets/minecraft/models/block/slab.json", "assets/minecraft/models/block/block.json"],
  brick_slab: ["assets/minecraft/items/brick_slab.json", "assets/minecraft/models/block/brick_slab.json", "assets/minecraft/models/block/slab.json", "assets/minecraft/models/block/block.json"],
  oak_stairs: ["assets/minecraft/items/oak_stairs.json", "assets/minecraft/models/block/oak_stairs.json", "assets/minecraft/models/block/stairs.json", "assets/minecraft/models/block/block.json"],
  cobblestone_stairs: ["assets/minecraft/items/cobblestone_stairs.json", "assets/minecraft/models/block/cobblestone_stairs.json", "assets/minecraft/models/block/stairs.json", "assets/minecraft/models/block/block.json"],
  stone_brick_stairs: ["assets/minecraft/items/stone_brick_stairs.json", "assets/minecraft/models/block/stone_brick_stairs.json", "assets/minecraft/models/block/stairs.json", "assets/minecraft/models/block/block.json"],
  brick_stairs: ["assets/minecraft/items/brick_stairs.json", "assets/minecraft/models/block/brick_stairs.json", "assets/minecraft/models/block/stairs.json", "assets/minecraft/models/block/block.json"],
});
const BUILDING_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
];
const BLOCK_PATHS = Object.freeze({
  grass_top: "assets/minecraft/textures/block/grass_block_top.png",
  grass_side: "assets/minecraft/textures/block/grass_block_side.png",
  dirt: "assets/minecraft/textures/block/dirt.png",
  stone: "assets/minecraft/textures/block/stone.png",
  cobblestone: "assets/minecraft/textures/block/cobblestone.png",
  oak_log: "assets/minecraft/textures/block/oak_log.png",
  oak_planks: "assets/minecraft/textures/block/oak_planks.png",
  leaves: "assets/minecraft/textures/block/oak_leaves.png",
  sand: "assets/minecraft/textures/block/sand.png",
  coal_ore: "assets/minecraft/textures/block/coal_ore.png",
  iron_ore: "assets/minecraft/textures/block/iron_ore.png",
  gold_ore: "assets/minecraft/textures/block/gold_ore.png",
  diamond_ore: "assets/minecraft/textures/block/diamond_ore.png",
  glass: "assets/minecraft/textures/block/glass.png",
  crafting_table_side: "assets/minecraft/textures/block/crafting_table_side.png",
  furnace_side: "assets/minecraft/textures/block/furnace_side.png",
  oak_log_end: "assets/minecraft/textures/block/oak_log_top.png",
  crafting_table_top: "assets/minecraft/textures/block/crafting_table_top.png",
  crafting_table_front: "assets/minecraft/textures/block/crafting_table_front.png",
  furnace_front: "assets/minecraft/textures/block/furnace_front.png",
  furnace_top: "assets/minecraft/textures/block/furnace_top.png",
  tnt_side: "assets/minecraft/textures/block/tnt_side.png",
  tnt_top: "assets/minecraft/textures/block/tnt_top.png",
  tnt_bottom: "assets/minecraft/textures/block/tnt_bottom.png",
  gravel: "assets/minecraft/textures/block/gravel.png",
  wool: "assets/minecraft/textures/block/white_wool.png",
  sapling: "assets/minecraft/textures/block/oak_sapling.png",
  stone_bricks: "assets/minecraft/textures/block/stone_bricks.png",
  clay: "assets/minecraft/textures/block/clay.png",
  bricks: "assets/minecraft/textures/block/bricks.png",
  bedrock: "assets/minecraft/textures/block/bedrock.png",
  torch: "assets/minecraft/textures/block/torch.png",
  water: "assets/minecraft/textures/block/water_still.png",
  cactus: "assets/minecraft/textures/block/cactus_side.png",
  short_grass: "assets/minecraft/textures/block/short_grass.png",
  dandelion: "assets/minecraft/textures/block/dandelion.png",
  poppy: "assets/minecraft/textures/block/poppy.png",
  oak_door_bottom: "assets/minecraft/textures/block/oak_door_bottom.png",
  oak_door_top: "assets/minecraft/textures/block/oak_door_top.png",
  spruce_log: "assets/minecraft/textures/block/spruce_log.png",
  spruce_log_end: "assets/minecraft/textures/block/spruce_log_top.png",
  spruce_planks: "assets/minecraft/textures/block/spruce_planks.png",
  spruce_leaves: "assets/minecraft/textures/block/spruce_leaves.png",
  spruce_door_bottom: "assets/minecraft/textures/block/spruce_door_bottom.png",
  spruce_door_top: "assets/minecraft/textures/block/spruce_door_top.png",
  birch_log: "assets/minecraft/textures/block/birch_log.png",
  birch_log_end: "assets/minecraft/textures/block/birch_log_top.png",
  birch_planks: "assets/minecraft/textures/block/birch_planks.png",
  birch_leaves: "assets/minecraft/textures/block/birch_leaves.png",
  birch_door_bottom: "assets/minecraft/textures/block/birch_door_bottom.png",
  birch_door_top: "assets/minecraft/textures/block/birch_door_top.png",
  jungle_log: "assets/minecraft/textures/block/jungle_log.png",
  jungle_log_end: "assets/minecraft/textures/block/jungle_log_top.png",
  jungle_planks: "assets/minecraft/textures/block/jungle_planks.png",
  jungle_leaves: "assets/minecraft/textures/block/jungle_leaves.png",
  jungle_door_bottom: "assets/minecraft/textures/block/jungle_door_bottom.png",
  jungle_door_top: "assets/minecraft/textures/block/jungle_door_top.png",
  acacia_log: "assets/minecraft/textures/block/acacia_log.png",
  acacia_log_end: "assets/minecraft/textures/block/acacia_log_top.png",
  acacia_planks: "assets/minecraft/textures/block/acacia_planks.png",
  acacia_leaves: "assets/minecraft/textures/block/acacia_leaves.png",
  acacia_door_bottom: "assets/minecraft/textures/block/acacia_door_bottom.png",
  acacia_door_top: "assets/minecraft/textures/block/acacia_door_top.png",
  dark_oak_log: "assets/minecraft/textures/block/dark_oak_log.png",
  dark_oak_log_end: "assets/minecraft/textures/block/dark_oak_log_top.png",
  dark_oak_planks: "assets/minecraft/textures/block/dark_oak_planks.png",
  dark_oak_leaves: "assets/minecraft/textures/block/dark_oak_leaves.png",
  dark_oak_door_bottom: "assets/minecraft/textures/block/dark_oak_door_bottom.png",
  dark_oak_door_top: "assets/minecraft/textures/block/dark_oak_door_top.png",
  mangrove_log: "assets/minecraft/textures/block/mangrove_log.png",
  mangrove_log_end: "assets/minecraft/textures/block/mangrove_log_top.png",
  mangrove_planks: "assets/minecraft/textures/block/mangrove_planks.png",
  mangrove_leaves: "assets/minecraft/textures/block/mangrove_leaves.png",
  mangrove_door_bottom: "assets/minecraft/textures/block/mangrove_door_bottom.png",
  mangrove_door_top: "assets/minecraft/textures/block/mangrove_door_top.png",
  cherry_log: "assets/minecraft/textures/block/cherry_log.png",
  cherry_log_end: "assets/minecraft/textures/block/cherry_log_top.png",
  cherry_planks: "assets/minecraft/textures/block/cherry_planks.png",
  cherry_leaves: "assets/minecraft/textures/block/cherry_leaves.png",
  cherry_door_bottom: "assets/minecraft/textures/block/cherry_door_bottom.png",
  cherry_door_top: "assets/minecraft/textures/block/cherry_door_top.png",
  bamboo_block: "assets/minecraft/textures/block/bamboo_block.png",
  bamboo_block_top: "assets/minecraft/textures/block/bamboo_block_top.png",
  bamboo_planks: "assets/minecraft/textures/block/bamboo_planks.png",
  quartz_block_side: "assets/minecraft/textures/block/quartz_block_side.png",
  quartz_block_top: "assets/minecraft/textures/block/quartz_block_top.png",
  quartz_block_bottom: "assets/minecraft/textures/block/quartz_block_bottom.png",
  quartz_pillar: "assets/minecraft/textures/block/quartz_pillar_side.png",
  quartz_pillar_top: "assets/minecraft/textures/block/quartz_pillar_top.png",
  chiseled_quartz: "assets/minecraft/textures/block/chiseled_quartz_block.png",
  chiseled_quartz_top: "assets/minecraft/textures/block/chiseled_quartz_block_top.png",
  granite: "assets/minecraft/textures/block/granite.png",
  polished_granite: "assets/minecraft/textures/block/polished_granite.png",
  diorite: "assets/minecraft/textures/block/diorite.png",
  polished_diorite: "assets/minecraft/textures/block/polished_diorite.png",
  andesite: "assets/minecraft/textures/block/andesite.png",
  polished_andesite: "assets/minecraft/textures/block/polished_andesite.png",
  sandstone: "assets/minecraft/textures/block/sandstone.png",
  cut_sandstone: "assets/minecraft/textures/block/cut_sandstone.png",
  chiseled_sandstone: "assets/minecraft/textures/block/chiseled_sandstone.png",
  smooth_stone: "assets/minecraft/textures/block/smooth_stone.png",
  calcite: "assets/minecraft/textures/block/calcite.png",
  deepslate: "assets/minecraft/textures/block/deepslate.png",
  cobbled_deepslate: "assets/minecraft/textures/block/cobbled_deepslate.png",
  polished_deepslate: "assets/minecraft/textures/block/polished_deepslate.png",
  deepslate_bricks: "assets/minecraft/textures/block/deepslate_bricks.png",
  deepslate_tiles: "assets/minecraft/textures/block/deepslate_tiles.png",
  ...Object.fromEntries(BUILDING_COLORS.flatMap((color) => [
    [`${color}_stained_glass`, `assets/minecraft/textures/block/${color}_stained_glass.png`],
    [`${color}_concrete`, `assets/minecraft/textures/block/${color}_concrete.png`],
  ])),
  glowstone: "assets/minecraft/textures/block/glowstone.png",
  sea_lantern: "assets/minecraft/textures/block/sea_lantern.png",
  shroomlight: "assets/minecraft/textures/block/shroomlight.png",
  ochre_froglight_side: "assets/minecraft/textures/block/ochre_froglight_side.png",
  ochre_froglight_top: "assets/minecraft/textures/block/ochre_froglight_top.png",
  verdant_froglight_side: "assets/minecraft/textures/block/verdant_froglight_side.png",
  verdant_froglight_top: "assets/minecraft/textures/block/verdant_froglight_top.png",
  pearlescent_froglight_side: "assets/minecraft/textures/block/pearlescent_froglight_side.png",
  pearlescent_froglight_top: "assets/minecraft/textures/block/pearlescent_froglight_top.png",
  magma_block: "assets/minecraft/textures/block/magma.png",
  ...Object.fromEntries([
    "mossy_cobblestone", "mossy_stone_bricks", "cracked_stone_bricks", "chiseled_stone_bricks",
    "packed_mud", "mud_bricks", "prismarine", "prismarine_bricks", "dark_prismarine", "nether_bricks",
    "red_nether_bricks", "blackstone", "polished_blackstone", "polished_blackstone_bricks", "end_stone",
    "end_stone_bricks", "purpur_block", "obsidian", "crying_obsidian",
  ].map((name) => [name, `assets/minecraft/textures/block/${name}.png`])),
  ...Object.fromEntries(BUILDING_COLORS.filter((color) => color !== "white")
    .map((color) => [`${color}_wool`, `assets/minecraft/textures/block/${color}_wool.png`])),
  ...Object.fromEntries(BUILDING_COLORS.flatMap((color) => [
    [`${color}_terracotta`, `assets/minecraft/textures/block/${color}_terracotta.png`],
    [`${color}_glazed_terracotta`, `assets/minecraft/textures/block/${color}_glazed_terracotta.png`],
  ])),
  ...Object.fromEntries([
    "red_sandstone", "cut_red_sandstone", "chiseled_red_sandstone", "amethyst_block",
    "budding_amethyst", "tuff", "dripstone_block",
    "copper_block", "exposed_copper", "weathered_copper", "oxidized_copper", "cut_copper",
    "exposed_cut_copper", "weathered_cut_copper", "oxidized_cut_copper", "sculk", "nether_wart_block",
    "polished_tuff", "tuff_bricks", "resin_bricks",
  ].map((name) => [name, `assets/minecraft/textures/block/${name}.png`])),
  smooth_sandstone: "assets/minecraft/textures/block/sandstone_top.png",
  smooth_red_sandstone: "assets/minecraft/textures/block/red_sandstone_top.png",
});
const BLOCK_ITEM_TEXTURE_PATHS = Object.freeze({
  torch: "assets/minecraft/textures/block/torch.png",
  door: "assets/minecraft/textures/item/oak_door.png",
  ladder: "assets/minecraft/textures/block/ladder.png",
  sapling: "assets/minecraft/textures/block/oak_sapling.png",
  cactus: "assets/minecraft/textures/block/cactus_side.png",
  short_grass: "assets/minecraft/textures/block/short_grass.png",
  dandelion: "assets/minecraft/textures/block/dandelion.png",
  poppy: "assets/minecraft/textures/block/poppy.png",
  spruce_door: "assets/minecraft/textures/item/spruce_door.png",
  birch_door: "assets/minecraft/textures/item/birch_door.png",
  jungle_door: "assets/minecraft/textures/item/jungle_door.png",
  acacia_door: "assets/minecraft/textures/item/acacia_door.png",
  dark_oak_door: "assets/minecraft/textures/item/dark_oak_door.png",
  mangrove_door: "assets/minecraft/textures/item/mangrove_door.png",
  cherry_door: "assets/minecraft/textures/item/cherry_door.png",
});
const BLOCK_LAYER_PATHS = Object.freeze({
  grass_side_overlay: "assets/minecraft/textures/block/grass_block_side_overlay.png",
});

function entry(path) {
  return execFileSync("unzip", ["-p", jarPath, path], { maxBuffer: 8 * 1_024 * 1_024 });
}

function png(path, expectedWidth = null, expectedHeight = null) {
  const bytes = entry(path);
  const decoded = decodePng(bytes);
  if (expectedWidth !== null && (decoded.width !== expectedWidth || decoded.height !== expectedHeight)) {
    throw new Error(`${path} is ${decoded.width}x${decoded.height}; expected ${expectedWidth}x${expectedHeight}.`);
  }
  return bytes.toString("base64");
}

function blockPng(path) {
  const bytes = entry(path);
  const decoded = decodePng(bytes);
  if (decoded.width !== 16 || decoded.height < 16 || decoded.height % 16 !== 0) {
    throw new Error(`${path} is ${decoded.width}x${decoded.height}; expected a 16px block texture strip.`);
  }
  return (decoded.height === 16 ? bytes : encodePngRgba(16, 16, decoded.rgba.subarray(0, 16 * 16 * 4))).toString("base64");
}

const itemTextures = {};
for (const [itemId, definition] of Object.entries(ITEMS)) {
  if (definition.category === "block") continue;
  const texture = ITEM_ALIASES[itemId] ?? itemId;
  itemTextures[itemId] = png(`assets/minecraft/textures/item/${texture}.png`, 16, 16);
}
const bowStages = [0, 1, 2].map((stage) => png(`assets/minecraft/textures/item/bow_pulling_${stage}.png`, 16, 16));
const models = Object.fromEntries(Object.entries(MODEL_PATHS).map(([name, path]) => [name, JSON.parse(entry(path).toString("utf8"))]));
const entities = Object.fromEntries(Object.entries(ENTITY_PATHS).map(([name, path]) => [name, png(path)]));
const armorTextures = Object.fromEntries(Object.entries(ARMOR_TEXTURE_PATHS).map(([name, path]) => [name, png(path, 64, 32)]));
const blockItemModelChains = Object.fromEntries(Object.entries(BLOCK_ITEM_MODEL_CHAINS).map(([itemId, paths]) => [
  itemId,
  paths.map((path) => Object.freeze({ path, model: JSON.parse(entry(path).toString("utf8")) })),
]));
const blocks = Object.fromEntries(Object.entries(BLOCK_PATHS).map(([name, path]) => [name, blockPng(path)]));
const blockItemTextures = Object.fromEntries(Object.entries(BLOCK_ITEM_TEXTURE_PATHS)
  .map(([name, path]) => [name, png(path, 16, 16)]));
const blockLayers = Object.fromEntries(Object.entries(BLOCK_LAYER_PATHS)
  .map(([name, path]) => [name, png(path, 16, 16)]));
const manifest = {
  format: 1,
  source: {
    version: "26.2",
    jarSha256,
    notice: "Imported from a locally installed, user-owned Minecraft client. Contains only visual files selected for Lakecraft compatibility.",
  },
  itemTextures,
  bowStages,
  models,
  entities,
  armorTextures,
  blockItemModelChains,
  blocks,
  blockItemTextures,
  blockLayers,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, items: Object.keys(itemTextures).length, entities: Object.keys(entities).length, armorTextures: Object.keys(armorTextures).length, blocks: Object.keys(blocks).length, blockItemTextures: Object.keys(blockItemTextures).length, blockLayers: Object.keys(blockLayers).length, jarSha256: manifest.source.jarSha256 }));
