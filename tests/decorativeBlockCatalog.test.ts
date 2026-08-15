import assert from "node:assert/strict";
import { AGENT_BLOCK_NAMES } from "../apps/game-server/src/agentBuilder.ts";
import { blockTextureForFace } from "../client/game/blockTextures.ts";
import { BLOCK, isGlassBlock, isLightEmittingBlock, isLuminousBlock } from "../client/game/types.ts";
import { blockFaceIsOccluded } from "../client/game/voxelEngine.ts";
import { ITEM_TO_ENGINE } from "../client/gameplay/catalog.ts";
import { TEXTURE_ATLAS_NAMES } from "../client/game/generated/textureAtlas.ts";
import {
  ADDITIONAL_ARCHITECTURAL_ITEMS,
  ADDITIONAL_COLOR_BLOCK_ITEMS,
  BUILDING_COLORS,
  DECORATIVE_STONE_ITEMS,
  EXPANDED_BLOCK_ITEM_IDS,
  LUMINOUS_BLOCK_ITEMS,
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
assert.equal(secondWave.length, 66);
assert.deepEqual(EXPANDED_BLOCK_ITEM_IDS.slice(-(additions.length + secondWave.length), -secondWave.length), additions,
  "the first decorative wave retains its append-only IDs");
assert.deepEqual(EXPANDED_BLOCK_ITEM_IDS.slice(-secondWave.length), secondWave,
  "the second decorative wave is one append-only tail");
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

console.log("124 decorative and luminous building blocks share catalog, texture, light, and wire parity");
