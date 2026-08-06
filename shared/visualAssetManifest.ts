/** Auditable provenance for bundled and locally imported visual compatibility data. */
export const VISUAL_ASSET_MANIFEST = Object.freeze({
  policyVersion: 2,
  provenance: "mixed-original-and-user-authorized-local-import" as const,
  itemIcons: Object.freeze({
    sourceKind: "original-plus-minecraft-26.2-local-import" as const,
    importer: "scripts/import-minecraft-visual-assets.mjs",
    generator: "scripts/generate-item-icon-art.ts",
    output: "client/components/itemIconArt.ts",
    logicalResolution: 16,
    fingerprint: "15967dd2",
  }),
  blockAtlas: Object.freeze({
    sourceKind: "original-concept-plus-minecraft-26.2-local-import" as const,
    concept: "design/texture-concepts/lakecraft-materials-v1.png",
    importer: "scripts/import-minecraft-visual-assets.mjs",
    generator: "scripts/pixelate-texture-sheet.mjs",
    output: "client/game/generated/texture-atlas-v1.png",
    logicalResolution: 16,
    fingerprint: "07b23a8c",
  }),
  defaultPlayerSkin: Object.freeze({
    sourceKind: "minecraft-26.2-local-import" as const,
    importer: "scripts/import-minecraft-visual-assets.mjs",
    generator: "scripts/generate-default-player-skin.ts",
    output: "client/game/generated/defaultPlayerSkin.ts",
    logicalResolution: 64,
    fingerprint: "abf17456",
  }),
  userSkin: Object.freeze({
    sourceKind: "user-supplied-local" as const,
    acceptedResolutions: Object.freeze([64, 128] as const),
    bundled: false,
    uploaded: false,
  }),
});
