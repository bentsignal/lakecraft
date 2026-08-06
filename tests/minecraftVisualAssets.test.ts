import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getBowIconArt, getItemIconArt, type ItemIconArt } from "../client/components/itemIconArt.ts";
import { createLakecraftDefaultSkinPixels } from "../client/game/playerSkin.ts";
import { decodePng } from "../scripts/png-rgba.mjs";
import { ITEMS, type ItemId } from "../shared/game.ts";
import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
} from "../client/game/generated/textureAtlas.ts";

type ImportedAssets = Readonly<{
  format: number;
  source: Readonly<{ version: string; jarSha256: string; notice: string }>;
  itemTextures: Readonly<Record<string, string>>;
  bowStages: readonly string[];
  models: Readonly<Record<string, { display?: Record<string, unknown> }>>;
  entities: Readonly<Record<string, string>>;
  blocks: Readonly<Record<string, string>>;
}>;
const assets = JSON.parse(readFileSync(
  new URL("../scripts/generated/minecraft-visual-assets-v26.2.json", import.meta.url),
  "utf8",
)) as ImportedAssets;

assert.equal(assets.format, 1);
assert.equal(assets.source.version, "26.2");
assert.equal(assets.source.jarSha256, "40896ee9f1e2bec3c934daac7e93d41e9e3d9c2f8ae0ca366d52ffbfd1afa290");
assert.match(assets.source.notice, /locally installed, user-owned Minecraft client/);
assert.equal(Object.keys(assets.itemTextures).length, 67);
assert.equal(assets.bowStages.length, 3);
assert.equal(Object.keys(assets.entities).length, 10);
assert.equal(Object.keys(assets.blocks).length, 7);

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

function assertExactPixels(art: ItemIconArt, payload: string, label: string): void {
  const image = decodePng(Buffer.from(payload, "base64"));
  assert.deepEqual([image.width, image.height], [16, 16], `${label} source remains 16x16`);
  const actual = new Map<string, string>();
  for (const run of art.runs) for (let x = run.x; x < run.x + run.width; x += 1) {
    actual.set(`${x}:${run.y}`, run.color.toLowerCase());
  }
  const expected = new Map<string, string>();
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
    const offset = (y * 16 + x) * 4;
    if (image.rgba[offset + 3] < 128) continue;
    expected.set(`${x}:${y}`, `#${[0, 1, 2]
      .map((channel) => image.rgba[offset + channel].toString(16).padStart(2, "0")).join("")}`);
  }
  assert.deepEqual(actual, expected, `${label} production runs exactly preserve installed RGBA pixels`);
}

const exactItems = Object.entries(ITEMS)
  .filter(([itemId, item]) => Boolean(item.tool) || ["bow", "shears", "flint_and_steel"].includes(itemId))
  .map(([itemId]) => itemId as ItemId);
assert.equal(exactItems.length, 23);
for (const itemId of exactItems) assertExactPixels(getItemIconArt(itemId), assets.itemTextures[itemId], itemId);
for (const stage of [1, 2, 3] as const) {
  assertExactPixels(getBowIconArt(stage), assets.bowStages[stage - 1], `bow_pulling_${stage - 1}`);
}

for (const [name, payload] of Object.entries(assets.entities)) {
  const image = decodePng(Buffer.from(payload, "base64"));
  assert.ok(image.width >= 32 && image.height >= 32, `${name} retains a complete installed entity texture`);
}
assert.deepEqual(
  createLakecraftDefaultSkinPixels(),
  decodePng(Buffer.from(assets.entities.player_wide, "base64")).rgba,
  "the production default player skin exactly preserves the installed standard 64x64 RGBA texture",
);
for (const [name, payload] of Object.entries(assets.blocks)) {
  const image = decodePng(Buffer.from(payload, "base64"));
  assert.deepEqual([image.width, image.height], [16, 16], `${name} retains its exact block tile`);
  const tile = TEXTURE_ATLAS_NAMES.indexOf(name as typeof TEXTURE_ATLAS_NAMES[number]);
  assert.ok(tile >= 0, `${name} has a production atlas slot`);
  const tileX = tile % TEXTURE_ATLAS_COLUMNS;
  const tileY = Math.floor(tile / TEXTURE_ATLAS_COLUMNS);
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

console.log(`Minecraft 26.2 visual import verified (${exactItems.length} exact production items + 3 bow stages + 7 block tiles + default player skin)`);
