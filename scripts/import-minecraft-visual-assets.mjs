import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ITEMS } from "../shared/game.ts";
import { decodePng } from "./png-rgba.mjs";

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
  sheep: "assets/minecraft/textures/entity/sheep/sheep.png",
  sheep_wool: "assets/minecraft/textures/entity/sheep/sheep_wool.png",
  chest_normal: "assets/minecraft/textures/entity/chest/normal.png",
});
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
});
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
});
const BLOCK_ITEM_TEXTURE_PATHS = Object.freeze({
  torch: "assets/minecraft/textures/block/torch.png",
  door: "assets/minecraft/textures/item/oak_door.png",
  ladder: "assets/minecraft/textures/block/ladder.png",
  sapling: "assets/minecraft/textures/block/oak_sapling.png",
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

const itemTextures = {};
for (const [itemId, definition] of Object.entries(ITEMS)) {
  if (definition.category === "block") continue;
  const texture = ITEM_ALIASES[itemId] ?? itemId;
  itemTextures[itemId] = png(`assets/minecraft/textures/item/${texture}.png`, 16, 16);
}
const bowStages = [0, 1, 2].map((stage) => png(`assets/minecraft/textures/item/bow_pulling_${stage}.png`, 16, 16));
const models = Object.fromEntries(Object.entries(MODEL_PATHS).map(([name, path]) => [name, JSON.parse(entry(path).toString("utf8"))]));
const entities = Object.fromEntries(Object.entries(ENTITY_PATHS).map(([name, path]) => [name, png(path)]));
const blockItemModelChains = Object.fromEntries(Object.entries(BLOCK_ITEM_MODEL_CHAINS).map(([itemId, paths]) => [
  itemId,
  paths.map((path) => Object.freeze({ path, model: JSON.parse(entry(path).toString("utf8")) })),
]));
const blocks = Object.fromEntries(Object.entries(BLOCK_PATHS).map(([name, path]) => [name, png(path, 16, 16)]));
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
  blockItemModelChains,
  blocks,
  blockItemTextures,
  blockLayers,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, items: Object.keys(itemTextures).length, entities: Object.keys(entities).length, blocks: Object.keys(blocks).length, blockItemTextures: Object.keys(blockItemTextures).length, blockLayers: Object.keys(blockLayers).length, jarSha256: manifest.source.jarSha256 }));
