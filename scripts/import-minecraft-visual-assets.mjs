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
});
const BLOCK_PATHS = Object.freeze({
  coal_ore: "assets/minecraft/textures/block/coal_ore.png",
  iron_ore: "assets/minecraft/textures/block/iron_ore.png",
  gold_ore: "assets/minecraft/textures/block/gold_ore.png",
  diamond_ore: "assets/minecraft/textures/block/diamond_ore.png",
  tnt_side: "assets/minecraft/textures/block/tnt_side.png",
  tnt_top: "assets/minecraft/textures/block/tnt_top.png",
  tnt_bottom: "assets/minecraft/textures/block/tnt_bottom.png",
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
const blocks = Object.fromEntries(Object.entries(BLOCK_PATHS).map(([name, path]) => [name, png(path, 16, 16)]));
const jarBytes = await readFile(jarPath);
const manifest = {
  format: 1,
  source: {
    version: "26.2",
    jarSha256: createHash("sha256").update(jarBytes).digest("hex"),
    notice: "Imported from a locally installed, user-owned Minecraft client. Contains only visual files selected for Lakecraft compatibility.",
  },
  itemTextures,
  bowStages,
  models,
  entities,
  blocks,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, items: Object.keys(itemTextures).length, entities: Object.keys(entities).length, blocks: Object.keys(blocks).length, jarSha256: manifest.source.jarSha256 }));
