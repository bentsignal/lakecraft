/** Auditable provenance for bundled visuals; metadata only, never third-party pixels. */
export const VISUAL_ASSET_MANIFEST = Object.freeze({
  policyVersion: 1,
  provenance: "bundled-original" as const,
  itemIcons: Object.freeze({
    sourceKind: "procedural-original" as const,
    generator: "scripts/generate-item-icon-art.ts",
    output: "client/components/itemIconArt.ts",
    logicalResolution: 16,
    fingerprint: "58ee9f11",
  }),
  blockAtlas: Object.freeze({
    sourceKind: "original-concept-and-procedural" as const,
    concept: "design/texture-concepts/lakecraft-materials-v1.png",
    generator: "scripts/pixelate-texture-sheet.mjs",
    output: "client/game/generated/texture-atlas-v1.png",
    logicalResolution: 16,
    fingerprint: "31bd8151",
  }),
  defaultPlayerSkin: Object.freeze({
    sourceKind: "procedural-original" as const,
    generator: "client/game/playerSkin.ts#createLakecraftDefaultSkinPixels",
    logicalResolution: 64,
  }),
  userSkin: Object.freeze({
    sourceKind: "user-supplied-local" as const,
    acceptedResolutions: Object.freeze([64, 128] as const),
    bundled: false,
    uploaded: false,
  }),
});
