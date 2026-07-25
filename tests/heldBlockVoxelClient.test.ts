import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockTextureForFace, type BlockFace } from "../client/game/blockTextures.ts";
import { BLOCK } from "../client/game/types.ts";

const faces: readonly BlockFace[] = ["east", "west", "top", "bottom", "south", "north"];
for (const block of [BLOCK.DIRT, BLOCK.GRASS, BLOCK.WOOD, BLOCK.STONE_BRICKS, BLOCK.CLAY, BLOCK.BRICKS]) {
  for (const face of faces) assert.ok(blockTextureForFace(block, face), `held cube face ${face} reuses the world atlas`);
}

const renderer = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
assert.ok(renderer.includes("blockTextureForFace(block, face.face)"), "held blocks use the canonical face material resolver");
assert.ok(renderer.includes("textureAtlasUv(texture)"), "held blocks use the canonical half-texel atlas UV resolver");
assert.equal((renderer.match(/face: "(east|west|top|bottom|south|north)"/g) ?? []).length, 6,
  "one canonical cube basis has six complete solid faces");
assert.ok(renderer.includes("appendSpecialBlock"), "thin placeables receive compact solid geometry rather than a sprite exception");
assert.equal(renderer.includes("ItemIcon"), false, "first-person block/tool geometry has no inventory-icon dependency");

const hud = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.equal(hud.includes("lc-held-voxel"), false, "CSS block approximations are removed");
assert.equal(hud.includes("lc-held-sprite"), false, "stacked sprite extrusions are removed");

console.log("canonical held-block WebGL geometry tests passed");
