import assert from "node:assert/strict";
import { VISUAL_ASSET_MANIFEST } from "../shared/visualAssetManifest.ts";

assert.equal(VISUAL_ASSET_MANIFEST.provenance, "mixed-original-and-user-authorized-local-import");
assert.equal(VISUAL_ASSET_MANIFEST.itemIcons.importer, "scripts/import-minecraft-visual-assets.mjs");
assert.equal(VISUAL_ASSET_MANIFEST.blockAtlas.importer, "scripts/import-minecraft-visual-assets.mjs");
assert.equal(VISUAL_ASSET_MANIFEST.defaultPlayerSkin.importer, "scripts/import-minecraft-visual-assets.mjs");
assert.equal(VISUAL_ASSET_MANIFEST.itemIcons.logicalResolution, 16);
assert.equal(VISUAL_ASSET_MANIFEST.blockAtlas.logicalResolution, 16);
assert.match(VISUAL_ASSET_MANIFEST.itemIcons.fingerprint, /^[0-9a-f]{8}$/);
assert.match(VISUAL_ASSET_MANIFEST.blockAtlas.fingerprint, /^[0-9a-f]{8}$/);
assert.equal(VISUAL_ASSET_MANIFEST.defaultPlayerSkin.fingerprint, "abf17456");
assert.deepEqual(VISUAL_ASSET_MANIFEST.userSkin.acceptedResolutions, [64, 128]);
assert.equal(VISUAL_ASSET_MANIFEST.userSkin.bundled, false);
assert.equal(VISUAL_ASSET_MANIFEST.userSkin.uploaded, false);
assert.ok(Object.isFrozen(VISUAL_ASSET_MANIFEST));
assert.ok(Object.isFrozen(VISUAL_ASSET_MANIFEST.itemIcons));

console.log("visual asset provenance manifest tests passed");
