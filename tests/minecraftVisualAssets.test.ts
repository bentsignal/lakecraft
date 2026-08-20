import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getBowIconArt, getItemIconArt, type ItemIconArt } from "../client/components/itemIconArt.ts";
import { createLakecraftDefaultSkinPixels } from "../client/game/playerSkin.ts";
import { PLAYER_ARMOR_ATLAS_RGBA } from "../client/game/generated/playerArmorTexture.ts";
import { DESTROY_STAGE_RGBA, DESTROY_STAGE_RGBA_SHA256, DESTROY_STAGE_SOURCE_SHA256 } from "../client/game/generated/destroyStageAtlas.ts";
import { createHash } from "node:crypto";
import { decodePng } from "../scripts/png-rgba.mjs";
import { ITEMS, type ItemId } from "../shared/game.ts";
import {
  CHEST_ATLAS_COLUMN,
  CHEST_ATLAS_ROW,
  TEXTURE_ATLAS_CELLS,
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
} from "../client/game/generated/textureAtlas.ts";

type ImportedAssets = Readonly<{
  format: number;
  source: Readonly<{ version: string; jarSha256: string; notice: string }>;
  itemTextures: Readonly<Record<string, string>>;
  itemTextureOverlays: Readonly<Record<string, string>>;
  bowStages: readonly string[];
  models: Readonly<Record<string, { display?: Record<string, unknown> }>>;
  entities: Readonly<Record<string, string>>;
  armorTextures: Readonly<Record<string, string>>;
  blocks: Readonly<Record<string, string>>;
  blockItemTextures: Readonly<Record<string, string>>;
  blockLayers: Readonly<Record<string, string>>;
  blockItemModelChains: Readonly<Record<string, readonly Readonly<{
    path: string;
    model: Record<string, unknown>;
  }> []>>;
}>;
const assets = JSON.parse(readFileSync(
  new URL("../scripts/generated/minecraft-visual-assets-v26.2.json", import.meta.url),
  "utf8",
)) as ImportedAssets;

assert.equal(assets.format, 1);
assert.equal(assets.source.version, "26.2");
assert.equal(assets.source.jarSha256, "40896ee9f1e2bec3c934daac7e93d41e9e3d9c2f8ae0ca366d52ffbfd1afa290");
assert.match(assets.source.notice, /locally installed, user-owned Minecraft client/);
const importerSource = readFileSync(new URL("../scripts/import-minecraft-visual-assets.mjs", import.meta.url), "utf8");
assert.ok(importerSource.includes(`EXPECTED_JAR_SHA256 = "${assets.source.jarSha256}"`)
  && importerSource.includes("jarSha256 !== EXPECTED_JAR_SHA256"),
"the importer fails before asset extraction unless the installed JAR matches the reviewed 26.2 hash");
assert.equal(Object.keys(assets.itemTextures).length, 70);
for (const bucket of ["bucket", "water_bucket", "lava_bucket"]) {
  assert.ok(Object.hasOwn(assets.itemTextures, bucket), `${bucket} uses the exact installed 26.2 item texture`);
}
assert.deepEqual(Object.keys(assets.itemTextureOverlays), [
  "leather_helmet", "leather_chestplate", "leather_leggings", "leather_boots",
]);
assert.equal(assets.bowStages.length, 3);
assert.equal(Object.keys(assets.entities).length, 12);
assert.equal(Object.keys(assets.armorTextures).length, 10);
assert.ok(Object.hasOwn(assets.entities, "chicken"), "the exact temperate chicken joins every implemented mob texture");
assert.equal(Object.keys(assets.blocks).length, 248);
assert.ok(Object.hasOwn(assets.blocks, "lava"), "lava uses the exact installed 26.2 still texture");
for (let stage = 0; stage < 10; stage += 1) {
  const name = `destroy_stage_${stage}`;
  const png = Buffer.from(assets.blocks[name], "base64");
  const decoded = decodePng(png);
  assert.deepEqual([...DESTROY_STAGE_RGBA.subarray(stage * 16 * 16 * 4, (stage + 1) * 16 * 16 * 4)], [...decoded.rgba],
    `${name} is preserved pixel-exactly in the runtime destroy atlas`);
  assert.equal(DESTROY_STAGE_SOURCE_SHA256[name as keyof typeof DESTROY_STAGE_SOURCE_SHA256],
    createHash("sha256").update(png).digest("hex"));
}
assert.equal(createHash("sha256").update(DESTROY_STAGE_RGBA).digest("hex"), DESTROY_STAGE_RGBA_SHA256);
assert.equal(Object.keys(assets.blockItemTextures).length, 15);
assert.deepEqual(Object.keys(assets.blockLayers), ["grass_side_overlay"]);
assert.deepEqual(Object.keys(assets.blockItemModelChains), [
  "chest", "oak_fence", "oak_fence_gate", "stone_brick_slab",
  "oak_slab", "cobblestone_slab", "brick_slab", "oak_stairs", "cobblestone_stairs", "stone_brick_stairs", "brick_stairs",
]);
assert.deepEqual(Object.fromEntries(Object.entries(assets.blockItemModelChains).map(([itemId, chain]) => [
  itemId,
  chain.map(({ path }) => path),
])), {
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
}, "every model-rendered catalog item retains its exact installed inheritance chain");
assert.deepEqual(Object.fromEntries(["oak_fence", "oak_fence_gate", "stone_brick_slab", "oak_slab", "cobblestone_slab", "brick_slab", "oak_stairs", "cobblestone_stairs", "stone_brick_stairs", "brick_stairs"].map((itemId) => {
  const parent = assets.blockItemModelChains[itemId].find(({ model }) => Array.isArray(model.elements));
  return [itemId, (parent?.model.elements as unknown[] | undefined)?.length];
})), { oak_fence: 8, oak_fence_gate: 8, stone_brick_slab: 1, oak_slab: 1, cobblestone_slab: 1, brick_slab: 1, oak_stairs: 2, cobblestone_stairs: 2, stone_brick_stairs: 2, brick_stairs: 2 },
"installed parent elements remain the sole source of non-cube inventory geometry");

assert.deepEqual(assets.models.handheld.display?.firstperson_righthand, {
  rotation: [0, -90, 25],
  translation: [1.13, 3.2, 1.13],
  scale: [0.68, 0.68, 0.68],
});
assert.deepEqual(assets.models.block.display?.firstperson_righthand, {
  rotation: [0, 45, 0],
  translation: [0, 0, 0],
  scale: [0.4, 0.4, 0.4],
});

function assertExactPixels(
  art: ItemIconArt, payload: string, label: string, tintChannels?: readonly [number, number, number], overlayPayload?: string,
): void {
  const image = decodePng(Buffer.from(payload, "base64"));
  const overlay = overlayPayload ? decodePng(Buffer.from(overlayPayload, "base64")) : null;
  assert.deepEqual([image.width, image.height], [16, 16], `${label} source remains 16x16`);
  const actual = new Map<string, string>();
  for (const run of art.runs) for (let x = run.x; x < run.x + run.width; x += 1) {
    actual.set(`${x}:${run.y}`, run.color.toLowerCase());
  }
  const expected = new Map<string, string>();
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
    const offset = (y * 16 + x) * 4;
    if (image.rgba[offset + 3] < 128 && (!overlay || overlay.rgba[offset + 3] < 128)) continue;
    expected.set(`${x}:${y}`, `#${[0, 1, 2].map((channel) => (
      overlay?.rgba[offset + 3] === 255 ? overlay.rgba[offset + channel]
        : tintChannels ? Math.round(image.rgba[offset + channel] * tintChannels[channel] / 255) : image.rgba[offset + channel]
    ).toString(16).padStart(2, "0")).join("")}`);
  }
  assert.deepEqual(actual, expected, `${label} production runs exactly preserve installed RGBA pixels`);
}

const exactItems = Object.entries(ITEMS)
  .filter(([, item]) => item.category !== "block")
  .map(([itemId]) => itemId as ItemId);
assert.equal(exactItems.length, 70);
for (const itemId of exactItems) assertExactPixels(getItemIconArt(itemId), assets.itemTextures[itemId], itemId,
  itemId.startsWith("leather_") ? [0xa0, 0x65, 0x40] : undefined, assets.itemTextureOverlays[itemId]);
for (const [itemId, payload] of Object.entries(assets.blockItemTextures)) {
  if (itemId === "cactus") continue; // Full blocks use the shared isometric atlas cube in inventory.
  assertExactPixels(getItemIconArt(itemId as ItemId), payload, itemId,
    itemId === "short_grass" ? [0x91, 0xbd, 0x59] : undefined);
}
for (const stage of [1, 2, 3] as const) {
  assertExactPixels(getBowIconArt(stage), assets.bowStages[stage - 1], `bow_pulling_${stage - 1}`);
}

for (const [name, payload] of Object.entries(assets.entities)) {
  const image = decodePng(Buffer.from(payload, "base64"));
  assert.ok(image.width >= 32 && image.height >= 32, `${name} retains a complete installed entity texture`);
}
assert.deepEqual(
  [decodePng(Buffer.from(assets.entities.chest_normal, "base64")).width,
    decodePng(Buffer.from(assets.entities.chest_normal, "base64")).height],
  [64, 64],
  "the special chest renderer retains its complete installed normal entity texture",
);
const installedChest = decodePng(Buffer.from(assets.entities.chest_normal, "base64"));
for (let sourceY = 0; sourceY < 64; sourceY += 1) for (let sourceX = 0; sourceX < 64; sourceX += 1) {
  const atlas = (((CHEST_ATLAS_ROW * 16 + sourceY) * TEXTURE_ATLAS_COLUMNS * 16)
    + CHEST_ATLAS_COLUMN * 16 + sourceX) * 4;
  const source = (sourceY * 64 + sourceX) * 4;
  assert.deepEqual([...TEXTURE_ATLAS_RGBA.subarray(atlas, atlas + 4)],
    [...installedChest.rgba.subarray(source, source + 4)],
    `normal chest texel ${sourceX},${sourceY} survives contiguous atlas packing without resampling`);
}
assert.deepEqual(
  createLakecraftDefaultSkinPixels(),
  decodePng(Buffer.from(assets.entities.player_wide, "base64")).rgba,
  "the production default player skin exactly preserves the installed standard 64x64 RGBA texture",
);
assert.equal(createHash("sha256").update(PLAYER_ARMOR_ATLAS_RGBA).digest("hex"), "0e1b5269d33fb6de47f7547cd1ceb46c1f11bd89f5b05e5694db0d62f7fd637b",
  "the production armor atlas remains pinned to the reviewed installed Minecraft textures");
for (const [materialIndex, material] of ["leather", "iron", "gold", "diamond"].entries()) {
  for (const [layerIndex, layer] of ["humanoid", "humanoid_leggings"].entries()) {
    const installed = decodePng(Buffer.from(assets.armorTextures[`${material}_${layer}`], "base64"));
    assert.deepEqual([installed.width, installed.height], [64, 32]);
    for (let pixel = 0; pixel < 64 * 32; pixel += 1) {
      const source = pixel * 4; const atlas = ((materialIndex * 2 + layerIndex) * 64 * 32 + pixel) * 4;
      if (material !== "leather") assert.deepEqual(
        [...PLAYER_ARMOR_ATLAS_RGBA.subarray(atlas, atlas + 4)], [...installed.rgba.subarray(source, source + 4)],
        `${material} ${layer} texel ${pixel} is preserved exactly`,
      );
    }
  }
}
const tintedTiles = new Set(["grass_top", "grass_side", "leaves", "short_grass", "water"]);
for (const [name, payload] of Object.entries(assets.blocks)) {
  const image = decodePng(Buffer.from(payload, "base64"));
  assert.deepEqual([image.width, image.height], [16, 16], `${name} retains its exact block tile`);
  if (name.startsWith("destroy_stage_")) continue;
  const tile = TEXTURE_ATLAS_NAMES.indexOf(name as typeof TEXTURE_ATLAS_NAMES[number]);
  assert.ok(tile >= 0, `${name} has a production atlas slot`);
  const cell = TEXTURE_ATLAS_CELLS[tile];
  const tileX = cell % TEXTURE_ATLAS_COLUMNS;
  const tileY = Math.floor(cell / TEXTURE_ATLAS_COLUMNS);
  if (tintedTiles.has(name)) continue;
  for (let y = 0; y < TEXTURE_TILE_SIZE; y += 1) for (let x = 0; x < TEXTURE_TILE_SIZE; x += 1) {
    const source = (y * TEXTURE_TILE_SIZE + x) * 4;
    const atlas = ((tileY * TEXTURE_TILE_SIZE + y) * TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE
      + tileX * TEXTURE_TILE_SIZE + x) * 4;
    assert.deepEqual(
      [...TEXTURE_ATLAS_RGBA.subarray(atlas, atlas + 4)],
      [...image.rgba.subarray(source, source + 4)],
      `${name} production atlas exactly preserves installed pixel ${x},${y}`,
    );
  }
}

const tint = (value: number, channel: number): number => Math.round(value * channel / 255);
const plainsGrass = [0x91, 0xbd, 0x59] as const;
const plainsFoliage = [0x77, 0xab, 0x2f] as const;
const waterTint = [0x3f, 0x76, 0xe4] as const;
const sourceTiles = Object.fromEntries(["grass_top", "grass_side", "leaves", "short_grass", "water"].map((name) => [
  name,
  decodePng(Buffer.from(assets.blocks[name], "base64")),
]));
const grassOverlay = decodePng(Buffer.from(assets.blockLayers.grass_side_overlay, "base64"));
for (const [name, channels] of [["grass_top", plainsGrass], ["short_grass", plainsGrass],
  ["leaves", plainsFoliage], ["water", waterTint]] as const) {
  const source = sourceTiles[name];
  const tile = TEXTURE_ATLAS_NAMES.indexOf(name);
  const cell = TEXTURE_ATLAS_CELLS[tile];
  const tileX = cell % TEXTURE_ATLAS_COLUMNS;
  const tileY = Math.floor(cell / TEXTURE_ATLAS_COLUMNS);
  if (name === "leaves") {
    const installedColors = new Set<string>();
    for (let pixel = 0; pixel < 256; pixel += 1) {
      const offset = pixel * 4;
      if (source.rgba[offset + 3]) installedColors.add(
        [0, 1, 2].map((channel) => tint(source.rgba[offset + channel], channels[channel])).concat(255).join(","),
      );
    }
    for (let pixel = 0; pixel < 256; pixel += 1) {
      const atlasOffset = ((tileY * 16 + Math.floor(pixel / 16)) * TEXTURE_ATLAS_COLUMNS * 16
        + tileX * 16 + pixel % 16) * 4;
      assert.ok(installedColors.has([...TEXTURE_ATLAS_RGBA.subarray(atlasOffset, atlasOffset + 4)].join(",")),
        `opaque leaves pixel ${pixel} remains in the installed tinted palette`);
    }
    continue;
  }
  for (let pixel = 0; pixel < 256; pixel += 1) {
    const sourceOffset = pixel * 4;
    const atlasOffset = ((tileY * 16 + Math.floor(pixel / 16)) * TEXTURE_ATLAS_COLUMNS * 16
      + tileX * 16 + pixel % 16) * 4;
    assert.deepEqual(
      [...TEXTURE_ATLAS_RGBA.subarray(atlasOffset, atlasOffset + 4)],
      [0, 1, 2].map((channel) => tint(source.rgba[sourceOffset + channel], channels[channel]))
        .concat(source.rgba[sourceOffset + 3]),
      `${name} pixel ${pixel} keeps the installed mask under the fixed plains tint`,
    );
  }
}
const grassSide = sourceTiles.grass_side;
const grassSideTile = TEXTURE_ATLAS_NAMES.indexOf("grass_side");
const grassSideCell = TEXTURE_ATLAS_CELLS[grassSideTile];
for (let pixel = 0; pixel < 256; pixel += 1) {
  const sourceOffset = pixel * 4;
  const alpha = grassOverlay.rgba[sourceOffset + 3] / 255;
  const atlasOffset = ((Math.floor(grassSideCell / TEXTURE_ATLAS_COLUMNS) * 16 + Math.floor(pixel / 16))
    * TEXTURE_ATLAS_COLUMNS * 16 + grassSideCell % TEXTURE_ATLAS_COLUMNS * 16 + pixel % 16) * 4;
  const expected = [0, 1, 2].map((channel) => Math.round(
    tint(grassOverlay.rgba[sourceOffset + channel], plainsGrass[channel]) * alpha
      + grassSide.rgba[sourceOffset + channel] * (1 - alpha),
  )).concat(grassSide.rgba[sourceOffset + 3]);
  assert.deepEqual([...TEXTURE_ATLAS_RGBA.subarray(atlasOffset, atlasOffset + 4)], expected,
    `grass side pixel ${pixel} composites the installed tinted overlay over its installed base`);
}

console.log(`Minecraft 26.2 visual import verified (${exactItems.length + Object.keys(assets.blockItemTextures).length} exact production item sprites + 3 bow stages + ${Object.keys(assets.blocks).length} exact block tiles + 3 plains-tinted installed layers + default player skin)`);
