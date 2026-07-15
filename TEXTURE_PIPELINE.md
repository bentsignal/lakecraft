# Lakecraft texture pipeline

Lakecraft's texture art is original project material, not extracted game assets. The checked-in concept sheet was generated for Lakecraft with OpenAI ImageGen and then passed through a deterministic, dependency-free pixelation step. Runtime code imports only a compact palette-indexed RGBA module; Lakebed does not need an image loader or a static-asset pipeline.

## Regenerate the block atlas

```sh
node scripts/pixelate-texture-sheet.mjs \
  design/texture-concepts/lakecraft-materials-v1.png \
  client/game/generated/texture-atlas-v1.png \
  --columns 5 \
  --rows 6 \
  --source-columns 4 \
  --source-rows 4 \
  --tile-size 16 \
  --inset 0 \
  --names grass_top,grass_side,dirt,stone,cobblestone,oak_log,oak_planks,leaves,sand,coal_ore,iron_ore,gold_ore,diamond_ore,glass,crafting_table_side,furnace_side,oak_log_end,crafting_table_top,crafting_table_front,furnace_front,furnace_top,tnt_side,tnt_top,tnt_bottom,gravel,wool,sapling \
  --ts client/game/generated/textureAtlas.ts
```

The script decodes RGB/RGBA PNG files itself, area-averages the original 4×4 concept sheet into 16×16 tiles, adds deterministic original pixel-art tiles for later materials and alpha-cutout plants, quantizes each RGB channel to a stable palette, writes an 80×96 PNG for human inspection, and emits palette indexes that reconstruct the exact RGBA bytes as TypeScript. Re-running the command with the same input must produce byte-identical outputs.

At runtime WebGL uploads the reconstructed 80×96 RGBA array once with nearest-neighbor filtering. Blocks select a tile per face: logs expose growth rings, and workbenches and furnaces have recognizable top, front, and side materials. Glass is kept out of the opaque terrain buffers and composited in a far-to-near, per-visible-chunk alpha pass with depth writes disabled. Oak saplings use a fixed 12-vertex crossed mesh in the ordinary chunk batch with a 0.5 alpha cutoff.

## Check deployment headroom

After preparing and building a staged release, keep at least 32 KiB below Lakebed's observed 1 MiB anonymous artifact ceiling:

```sh
node scripts/check-lakebed-artifact-size.mjs \
  /tmp/lakecraft-release/lakecraft/.lakebed/artifacts/lakecraft.anonymous.json
```

The check exits non-zero when either the hard ceiling or the safety margin is exceeded, so it can be reused in release automation.

## Art constraints

- every source sheet must be original and safe to redistribute
- no Mojang/Minecraft texture, icon, font, logo, screenshot crop, or traced asset may enter the repository
- atlas tiles remain power-of-two, seamless, front-facing, and legible at 16×16
- generated artifacts are reviewed visually after deterministic reduction; ImageGen output is direction, not a runtime dependency
