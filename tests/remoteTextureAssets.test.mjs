import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  remoteBlockTextureAtlasModule,
  remoteMobTextureAtlasModule,
} from "../scripts/remote-texture-assets.mjs";
import { compactClientIdentifiers } from "../scripts/css-template-compression.mjs";

const blockSource = await readFile(new URL("../client/game/generated/textureAtlas.ts", import.meta.url), "utf8");
const mobSource = await readFile(new URL("../client/game/generated/mobTextureAtlas.ts", import.meta.url), "utf8");
const deploySource = await readFile(new URL("../scripts/prepare-lakebed-deploy.mjs", import.meta.url), "utf8");
const mobStage = remoteMobTextureAtlasModule(mobSource);

// The remote block transform remains audited for rolling old capsules and the
// Railway immutable asset contract, but new Lakebed capsules deliberately ship
// the compact generated atlas in-module. A Railway asset rollout can therefore
// never blank the title screen or game bootstrap again.
assert.doesNotMatch(deploySource, /remoteBlockTextureAtlasModule/);
assert.match(deploySource, /remoteMobTextureAtlasModule/);
assert.throws(() => remoteBlockTextureAtlasModule(blockSource), /Block texture atlas source changed/,
  "the retired remote-block transform fails closed instead of serving the pre-biome PNG for the expanded atlas");
assert.ok(mobStage.length < 600, "the sealed Lakebed stage does not embed the mob PNG");
assert.match(mobStage, /mob-texture-atlas-204e2b83\.png/);
assert.doesNotMatch(mobStage, /iVBOR/);

const compactedMobStage = compactClientIdentifiers(mobStage);
assert.ok(compactedMobStage.includes("https://lakecraft-production.up.railway.app/assets/mob-texture-atlas-204e2b83.png"));
const mobRendererSource = await readFile(new URL("../client/game/mobRenderer.ts", import.meta.url), "utf8");
assert.match(mobRendererSource, /source\.includes\(":"\)/,
  "the runtime recognizes the compact stage's URL contract instead of passing it to atob");
assert.match(mobRendererSource, /visualAssetSha256\(buffer\)/,
  "the remotely loaded mob atlas is hash-verified before decode");
assert.doesNotMatch(compactedMobStage, /https:\/\/yproduction\.up\.railway\.app/);

for (const [path, expected] of [
  ["../apps/game-server/assets/block-texture-atlas-0f3a9517.png", "0f3a9517c9850c970514a2a88873eee2bed205272cc318b484dde0bfbb7973e1"],
  ["../apps/game-server/assets/block-texture-atlas-9a3b9f30.png", "242bbf5316677c49565d829adfd5cadcc2830d5682ce95a80b7add3bbd4effa3"],
  ["../apps/game-server/assets/block-texture-atlas-a607e4c6.png", "e2129f5f77e252a155d8163371485e8279dae0056de5048f5afe44092ae7139e"],
  ["../apps/game-server/assets/block-texture-atlas-d94c19f9.png", "1ac5805312f699ef1afd78a0038ccc6f2596e290dd4e6050b5ab1cd6b649ef89"],
  ["../apps/game-server/assets/mob-texture-atlas-204e2b83.png", "204e2b831ffd3716b9a1c04fab27fc832f0f0ce686c20896364a91d1b553e9f3"],
]) {
  const bytes = await readFile(new URL(path, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
}

const dockerfile = await readFile(new URL("../apps/game-server/Dockerfile", import.meta.url), "utf8");
assert.match(dockerfile, /COPY apps\/game-server\/assets \.\/assets/);
console.log("embedded block atlas fallback and hash-versioned Railway assets preserve release safety");
