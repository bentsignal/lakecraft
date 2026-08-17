import assert from "node:assert/strict";
import { AGENT_BLOCK_NAMES } from "../apps/game-server/src/agentBuilder.ts";
import { blockTextureForFace } from "../client/game/blockTextures.ts";
import { BLOCK, isGlassBlock, isLightEmittingBlock, isLuminousBlock } from "../client/game/types.ts";
import { blockFaceIsOccluded } from "../client/game/voxelEngine.ts";
import { ITEM_TO_ENGINE, placementBlockMatchesItem } from "../client/gameplay/catalog.ts";
import { TEXTURE_ATLAS_NAMES } from "../client/game/generated/textureAtlas.ts";
import {
  ADDITIONAL_ARCHITECTURAL_ITEMS,
  ADDITIONAL_COLOR_BLOCK_ITEMS,
  BUILDING_COLORS,
  CATALOG_V3_BLOCK_ITEMS,
  CATALOG_V3_STONE_SHAPE_FAMILIES,
  DECORATIVE_STONE_ITEMS,
  DEEPSLATE_BUILDING_ITEMS,
  EXPANDED_BLOCK_ITEM_IDS,
  LEGACY_STONE_SHAPE_FAMILIES,
  LUMINOUS_BLOCK_ITEMS,
  NATURAL_DECORATION_ITEMS,
  STONE_SHAPE_FAMILIES,
} from "../shared/expandedBuildingCatalog.ts";
import { ITEMS } from "../shared/game.ts";
import { BLOCK_TYPES } from "../shared/protocol.ts";

const additions = [
  ...BUILDING_COLORS.flatMap((color) => [`${color}_stained_glass`, `${color}_concrete`]),
  ...LUMINOUS_BLOCK_ITEMS,
  ...DECORATIVE_STONE_ITEMS,
];
assert.equal(additions.length, 58);
const secondWave = [...ADDITIONAL_COLOR_BLOCK_ITEMS, ...ADDITIONAL_ARCHITECTURAL_ITEMS];
const legacyShapeTail = [
  ...DEEPSLATE_BUILDING_ITEMS,
  ...LEGACY_STONE_SHAPE_FAMILIES.flatMap(([family]) => [`${family}_slab`, `${family}_stairs`]),
];
const v3Tail = [
  ...CATALOG_V3_BLOCK_ITEMS,
  ...CATALOG_V3_STONE_SHAPE_FAMILIES.flatMap(([family]) => [`${family}_slab`, `${family}_stairs`]),
];
const naturalTailLength = NATURAL_DECORATION_ITEMS.length;
assert.equal(secondWave.length, 66);
assert.deepEqual(EXPANDED_BLOCK_ITEM_IDS.slice(-(additions.length + secondWave.length + legacyShapeTail.length + v3Tail.length + naturalTailLength), -(secondWave.length + legacyShapeTail.length + v3Tail.length + naturalTailLength)), additions,
  "the first decorative wave retains its append-only IDs");
assert.deepEqual(EXPANDED_BLOCK_ITEM_IDS.slice(-(secondWave.length + legacyShapeTail.length + v3Tail.length + naturalTailLength), -(legacyShapeTail.length + v3Tail.length + naturalTailLength)), secondWave,
  "the second decorative wave is one append-only tail");
assert.deepEqual(EXPANDED_BLOCK_ITEM_IDS.slice(-(legacyShapeTail.length + v3Tail.length + naturalTailLength), -(v3Tail.length + naturalTailLength)), legacyShapeTail,
  "the deployed stone slab/stair expansion preserves its complete id range");
assert.deepEqual(EXPANDED_BLOCK_ITEM_IDS.slice(-(v3Tail.length + NATURAL_DECORATION_ITEMS.length), -NATURAL_DECORATION_ITEMS.length), v3Tail,
  "waxed copper and the widened shape catalog are one new append-only tail");
assert.deepEqual(EXPANDED_BLOCK_ITEM_IDS.slice(-NATURAL_DECORATION_ITEMS.length), NATURAL_DECORATION_ITEMS,
  "Creative natural decorations append without moving any deployed item IDs");
assert.deepEqual(AGENT_BLOCK_NAMES, BLOCK_TYPES, "browser and agent builders publish the identical numeric palette");

for (const item of additions) {
  assert.ok(ITEMS[item as keyof typeof ITEMS], `${item} has a creative inventory definition`);
  const block = ITEM_TO_ENGINE[item as keyof typeof ITEM_TO_ENGINE];
  assert.equal(typeof block, "number", `${item} maps to one engine block`);
  assert.ok(blockTextureForFace(block!, "north"), `${item} has an installed face texture`);
}
for (const item of secondWave) {
  assert.ok(ITEMS[item as keyof typeof ITEMS], `${item} has a creative inventory definition`);
  const block = ITEM_TO_ENGINE[item as keyof typeof ITEM_TO_ENGINE];
  assert.equal(typeof block, "number", `${item} maps to one engine block`);
  assert.equal(blockTextureForFace(block!, "north"), item, `${item} uses its exact installed Minecraft texture`);
}
for (const item of CATALOG_V3_BLOCK_ITEMS) {
  const block = ITEM_TO_ENGINE[item];
  assert.equal(typeof block, "number", `${item} maps to one engine block`);
  assert.ok(blockTextureForFace(block!, "north"), `${item} resolves its exact or oxidation-equivalent texture`);
}
for (const item of NATURAL_DECORATION_ITEMS) {
  assert.ok(ITEMS[item], `${item} is visible in the Creative catalog`);
  assert.equal(ITEM_TO_ENGINE[item], BLOCK[item.toUpperCase() as keyof typeof BLOCK]);
  assert.equal(placementBlockMatchesItem(item, ITEM_TO_ENGINE[item]!), true,
    `${item} placement uses its canonical world state`);
}
assert.equal(blockTextureForFace(BLOCK.WAXED_COPPER_BLOCK, "north"), "copper_block");
assert.equal(blockTextureForFace(BLOCK.WAXED_EXPOSED_CUT_COPPER, "north"), "exposed_cut_copper");
assert.equal(blockTextureForFace(BLOCK.WAXED_WEATHERED_CUT_COPPER, "north"), "weathered_cut_copper");
assert.equal(blockTextureForFace(BLOCK.WAXED_OXIDIZED_CUT_COPPER, "north"), "oxidized_cut_copper");
assert.equal(STONE_SHAPE_FAMILIES.length, LEGACY_STONE_SHAPE_FAMILIES.length + CATALOG_V3_STONE_SHAPE_FAMILIES.length);

for (const color of BUILDING_COLORS) {
  const glass = BLOCK[`${color.toUpperCase()}_STAINED_GLASS` as keyof typeof BLOCK];
  assert.equal(isGlassBlock(glass), true);
  assert.equal(blockTextureForFace(glass, "top"), `${color}_stained_glass`);
  assert.equal(blockFaceIsOccluded(glass, glass), true, "same-color connected glass removes its seam");
  assert.equal(blockFaceIsOccluded(glass, BLOCK.GLASS), false, "different glass materials retain a readable boundary");
}

for (const item of LUMINOUS_BLOCK_ITEMS) {
  const block = BLOCK[item.toUpperCase() as keyof typeof BLOCK];
  assert.equal(isLuminousBlock(block), true);
  assert.equal(isLightEmittingBlock(block), true);
}
assert.equal(blockTextureForFace(BLOCK.OCHRE_FROGLIGHT, "top"), "ochre_froglight_top");
assert.equal(blockTextureForFace(BLOCK.OCHRE_FROGLIGHT, "east"), "ochre_froglight_side");
for (const texture of ["sea_lantern", "glowstone", "black_concrete", "cyan_stained_glass", "crying_obsidian"]) {
  assert.ok((TEXTURE_ATLAS_NAMES as readonly string[]).includes(texture), `${texture} is packed in the production atlas`);
}
for (const texture of ["orange_wool", "cyan_glazed_terracotta", "oxidized_cut_copper", "amethyst_block", "sculk"]) {
  assert.ok((TEXTURE_ATLAS_NAMES as readonly string[]).includes(texture), `${texture} is packed in the production atlas`);
}
for (const texture of DEEPSLATE_BUILDING_ITEMS) {
  assert.ok((TEXTURE_ATLAS_NAMES as readonly string[]).includes(texture), `${texture} uses its exact installed texture`);
}

console.log("decorative, luminous, and stone-shape building blocks share catalog, texture, light, and wire parity");
