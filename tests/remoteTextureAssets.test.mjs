import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  remoteBlockTextureAtlasModule,
  remoteMobTextureAtlasModule,
} from "../scripts/remote-texture-assets.mjs";

const blockSource = await readFile(new URL("../client/game/generated/textureAtlas.ts", import.meta.url), "utf8");
const mobSource = await readFile(new URL("../client/game/generated/mobTextureAtlas.ts", import.meta.url), "utf8");
const blockStage = remoteBlockTextureAtlasModule(blockSource);
const mobStage = remoteMobTextureAtlasModule(mobSource);

assert.ok(blockStage.length < 5_000, "the sealed Lakebed stage does not embed the full block atlas");
assert.match(blockStage, /await load\(\)/);
assert.match(blockStage, /block-texture-atlas-d94c19f9\.png/);
assert.match(blockStage, /0xd94c19f9/);
assert.match(blockStage, /TEXTURE_ATLAS_NAMES=.*crying_obsidian/);
assert.doesNotMatch(blockStage, /decodeStaticBytes/);
assert.ok(mobStage.length < 600, "the sealed Lakebed stage does not embed the mob PNG");
assert.match(mobStage, /mob-texture-atlas-204e2b83\.png/);
assert.doesNotMatch(mobStage, /iVBOR/);

for (const [path, expected] of [
  ["../apps/game-server/assets/block-texture-atlas-d94c19f9.png", "1ac5805312f699ef1afd78a0038ccc6f2596e290dd4e6050b5ab1cd6b649ef89"],
  ["../apps/game-server/assets/mob-texture-atlas-204e2b83.png", "204e2b831ffd3716b9a1c04fab27fc832f0f0ce686c20896364a91d1b553e9f3"],
]) {
  const bytes = await readFile(new URL(path, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
}

const dockerfile = await readFile(new URL("../apps/game-server/Dockerfile", import.meta.url), "utf8");
assert.match(dockerfile, /COPY apps\/game-server\/assets \.\/assets/);
console.log("hash-versioned Railway texture assets preserve the compact Lakebed reserve");
