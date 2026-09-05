# Lakecraft texture pipeline

Lakecraft has two texture sources. The checked-in OpenAI ImageGen concept sheet
supplies fallback tiles. A hash-pinned importer selects compatibility assets for
implemented content from the project owner's installed Minecraft Java 26.2
client. Runtime code imports compact generated modules. Lakebed does not serve
the source images as loose assets.

## Regenerate the block atlas

```sh
node scripts/import-minecraft-visual-assets.mjs \
  "/Users/shawn/Library/Application Support/minecraft/versions/26.2/26.2.jar" \
  scripts/generated/minecraft-visual-assets-v26.2.json

node scripts/pixelate-texture-sheet.mjs \
  design/texture-concepts/lakecraft-materials-v1.png \
  client/game/generated/texture-atlas-v1.png \
  --columns 8 \
  --rows 16 \
  --source-columns 4 \
  --source-rows 4 \
  --tile-size 16 \
  --inset 0 \
  --names "$(node -e 'const s=require("fs").readFileSync("client/game/generated/textureAtlas.ts","utf8"); process.stdout.write(JSON.parse(s.match(/TEXTURE_ATLAS_NAMES = (\[[^;]+\])/)[1]).join(","))')" \
  --ts client/game/generated/textureAtlas.ts
```

The importer checks the 26.2 JAR SHA-256 before reading assets. It then checks
each selected path and dimension. The atlas script decodes PNGs, prepares the
fallback tiles, and replaces each implemented material that has an installed
source.

The 98 named tiles include all eight wood palettes, bamboo, quartz, six
decorative stones, sandstone variants, glass, torch, and separate top and bottom
door art. Minecraft stores grass tops and leaves as grayscale tint masks. It
stores the green strip of a grass side as a separate overlay. Production applies
the fixed plains colors `#91bd59` for grass and `#77ab2f` for foliage, then
composites the side overlay over the dirt base.

The script writes a 128×256 PNG for inspection. Runtime data uses per-tile local
indexes into a 16-bit global palette. The 64×64 normal-chest texture occupies
one contiguous 4×4-tile region. Repeating the commands against the same client
version must produce identical bytes.

WebGL reconstructs and uploads the 128×256 RGBA atlas once with nearest-neighbor
filtering. Blocks choose a tile for each face. Logs expose growth rings, doors
use two-tile art, and quartz pillars keep separate caps.

The chest mesh reads native UVs from the contiguous 64×64 chest region. It needs
no second texture, extra draw pass, or split-face seam. Connected fences and
gates reuse their wood-family tile in the terrain batch. Glass stays out of
opaque terrain buffers, culls faces against adjacent glass, and draws only a
connected window's exposed frame. Saplings use a fixed 12-vertex crossed mesh
with a 0.5 alpha cutoff.

Minecraft renders chest, oak-fence, oak-fence-gate, and stone-brick-slab items
from models or entity geometry instead of standalone 16×16 item PNGs. The
importer records their 26.2 model parent chains and the 64×64 chest texture. The
item-art generator resolves inherited transforms, elements, face UVs, and
texture references into the 16×16 inventory stream. First-person, dropped, and
remote held views reuse that catalog art. The bed remains Lakecraft-authored.

## Regenerate the mob atlas

```sh
node scripts/generate-mob-texture-atlas.mjs
```

The mob generator reads the hash-pinned import manifest. It packs the installed
pig, cow, chicken, sheep, zombie, skeleton, creeper, and spider PNGs into one
208×128 atlas. The skeleton's held bow uses the installed bow sprite.

The generated module records the atlas and each source SHA-256. Parity tests
compare every production texel with its source. The world and Visual Lab share
one fixed mob buffer for cuboids, pivots, gait, wool, bow pose, and creeper fuse
tint. Hurt, lighting, and death effects change vertices or material values. They
do not swap textures.

## Check deployment headroom

Asset changes must pass the
[shared delivery gate](../operations/workflows.md#shared-checks). It builds the
compact capsule twice and checks artifact headroom; a source PNG's size alone
does not establish the deployed cost.

## Art constraints

- imported compatibility files must come from the project owner's installed, user-owned client and remain limited to implemented content
- record the exact version, JAR SHA-256, selected paths, and provenance notice in the generated manifest
- atlas tiles remain power-of-two, seamless, front-facing, and legible at 16×16
- generated artifacts are verified byte-for-byte against imported RGBA and reviewed in the live Visual Lab
