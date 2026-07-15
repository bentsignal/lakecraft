# Lakecraft texture pipeline

Lakecraft's texture art is original project material, not extracted game assets. The checked-in concept sheet was generated for Lakecraft with OpenAI ImageGen and then passed through a deterministic, dependency-free pixelation step. Runtime code imports only a compact palette-indexed RGBA module; Lakebed does not need an image loader or a static-asset pipeline.

## Regenerate the block atlas

```sh
node scripts/pixelate-texture-sheet.mjs \
  design/texture-concepts/lakecraft-materials-v1.png \
  client/game/generated/texture-atlas-v1.png \
  --columns 4 \
  --rows 4 \
  --tile-size 16 \
  --inset 0 \
  --names grass_top,grass_side,dirt,stone,cobblestone,oak_log,oak_planks,leaves,sand,coal_ore,iron_ore,gold_ore,diamond_ore,glass,crafting_table,furnace \
  --ts client/game/generated/textureAtlas.ts
```

The script decodes RGB/RGBA PNG files itself, area-averages every source cell into a 16×16 tile, quantizes each RGB channel to a stable palette, writes a 64×64 PNG for human inspection, and emits palette indexes that reconstruct the exact RGBA bytes as TypeScript. Re-running the command with the same input must produce byte-identical outputs.

At runtime WebGL uploads the reconstructed 64×64 RGBA array once with nearest-neighbor filtering. Blocks select a tile per face, so grass uses distinct top/side/bottom materials while logs can use bark on their sides. Non-cube geometry keeps the lightweight color renderer until a purpose-built texture is available.

## Check deployment headroom

After preparing and building a staged release, keep at least 32 KiB below Lakebed's observed 2 MiB anonymous artifact ceiling:

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
