# Lakecraft texture pipeline

Lakecraft uses a deterministic two-source texture pipeline. The checked-in OpenAI ImageGen concept sheet supplies original fallback tiles. A hash-pinned importer then selects only compatibility assets for implemented content from the project owner's locally installed Minecraft Java 26.2 client. Runtime code imports compact generated modules; Lakebed does not need loose static assets.

## Regenerate the block atlas

```sh
node scripts/import-minecraft-visual-assets.mjs \
  "/Users/shawn/Library/Application Support/minecraft/versions/26.2/26.2.jar" \
  scripts/generated/minecraft-visual-assets-v26.2.json

node scripts/pixelate-texture-sheet.mjs \
  design/texture-concepts/lakecraft-materials-v1.png \
  client/game/generated/texture-atlas-v1.png \
  --columns 6 \
  --rows 8 \
  --source-columns 4 \
  --source-rows 4 \
  --tile-size 16 \
  --inset 0 \
  --names grass_top,grass_side,dirt,stone,cobblestone,oak_log,oak_planks,leaves,sand,coal_ore,iron_ore,gold_ore,diamond_ore,glass,crafting_table_side,furnace_side,oak_log_end,crafting_table_top,crafting_table_front,furnace_front,furnace_top,tnt_side,tnt_top,tnt_bottom,gravel,wool,sapling,stone_bricks,clay,bricks \
  --ts client/game/generated/textureAtlas.ts
```

The importer enforces the reviewed 26.2 JAR SHA-256 before reading assets, then validates every selected path and required dimension. The atlas script decodes PNGs itself, prepares the original concept fallback, and replaces every implemented material from the installed sources. Twenty-seven atlas tiles preserve their source RGBA exactly. Minecraft stores grass top and oak leaves as grayscale tint masks, and stores the green edge of a grass side as a separate overlay, so those three production tiles deterministically apply fixed plains-biome colors (`#91bd59` grass and `#77ab2f` foliage) and composite the installed side overlay over the installed dirt-bearing base. The result is written as a 96×128 PNG for human inspection and emitted as bit-packed per-tile local indexes into a 16-bit-addressed global palette, with the exact 64×64 normal-chest texture occupying one contiguous 4×4-tile region. Re-running the commands with the same installed version must produce byte-identical outputs.

At runtime WebGL uploads the reconstructed 96×128 RGBA array once with nearest-neighbor filtering. Blocks select a tile per face: logs expose installed growth rings, workbenches and furnaces have their installed top, front, and side materials, and stone bricks use the installed masonry tile. One contiguous 64×64 region preserves the complete installed normal-chest entity texture without resampling, allowing the retained three-part chest mesh to address native UVs directly without another texture, draw pass, or split-face seam. Connected oak-fence posts, rails, and swinging gate bars reuse the installed oak-plank tile in the retained terrain batch, so they add no atlas cell or draw pass. Glass is kept out of the opaque terrain buffers and composited in a far-to-near, per-visible-chunk alpha pass with depth writes disabled. Oak saplings use a fixed 12-vertex crossed mesh in the ordinary chunk batch with a 0.5 alpha cutoff.

Minecraft renders chest, oak-fence, oak-fence-gate, and stone-brick-slab items from model or special-entity geometry rather than standalone 16×16 item PNGs. The importer therefore records each exact 26.2 item/model parent chain and the normal 64×64 chest entity texture. The item-art generator resolves inherited display transforms, elements, face UVs, and texture references, then deterministically rasterizes those sources into the bounded 16×16 inventory stream. First-person, dropped, and remote held views reuse that same generated catalog art; calibration of a live multi-cuboid first-person model remains a separate orientation task. The bed remains intentionally Lakecraft-authored.

## Regenerate the mob atlas

```sh
node scripts/generate-mob-texture-atlas.mjs
```

The mob generator reads only the already hash-pinned import manifest. It packs the exact installed temperate pig, cow, chicken, sheep base/wool, zombie, skeleton, creeper, and spider PNGs into one deterministic 208×128 atlas, with the installed bow sprite reserved for the skeleton's held item. The generated module records the atlas and individual source SHA-256 values; parity tests compare every production texel with its installed source. Standard Java pixel-unit cuboids, texture offsets, part pivots, limb gait, sheep wool overlay, skeleton bow pose, and creeper fuse tint all feed the same fixed retained mob buffer used by the world and Visual Lab. Nearest-neighbor sampling preserves native pixels, while hurt, torch/day lighting, and death fall remain lightweight vertex/material transforms rather than alternate textures.

## Check deployment headroom

After preparing and building a staged release, keep at least 32 KiB below Lakebed's observed 1 MiB anonymous artifact ceiling:

```sh
node scripts/check-lakebed-artifact-size.mjs \
  /tmp/lakecraft-release/lakecraft/.lakebed/artifacts/lakecraft.anonymous.json
```

The check exits non-zero when either the hard ceiling or the safety margin is exceeded, so it can be reused in release automation.

## Art constraints

- imported compatibility files must come from the project owner's installed, user-owned client and remain limited to implemented content
- record the exact version, JAR SHA-256, selected paths, and provenance notice in the generated manifest
- atlas tiles remain power-of-two, seamless, front-facing, and legible at 16×16
- generated artifacts are verified byte-for-byte against imported RGBA and reviewed in the live Visual Lab
