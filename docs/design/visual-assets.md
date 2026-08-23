# Reference-driven visual asset pipeline

Status: active implementation contract, updated 2026-08-23

## Purpose

Every block, item, tool, player part, and mob must use one catalog definition
across world, inventory, first-person, third-person, dropped-item, and Visual Lab
rendering. Do not substitute one-off colored boxes or separate inventory art.

## Provenance boundary

Lakecraft uses Minecraft's public file formats, coordinate systems, model
inheritance, display contexts, skin layout, and visible behavior as engineering
references. For compatibility testing, the project also checks in the bounded
subset of visual assets imported from the owner's installed, user-owned Java
26.2 client. The pinned source hash, exact selected paths, generated manifests,
and attribution are documented in `docs/design/texture-pipeline.md` and
`THIRD_PARTY_NOTICES.md`; do not expand that subset casually.

Original Lakecraft art remains the fallback and records its source concept and
generator revision. A user may import a 64x64 or 128x128 PNG skin that they own
or may use. The browser stores the selected PNG locally. Multiplayer may relay
an exact 64x64 RGBA reduction after join, but the original PNG never leaves the
browser or enters a hosted deployment.

The machine-readable provenance boundary and reviewed fingerprints live in
`shared/visualAssetManifest.ts`; fingerprint tests bind the generated item and
atlas artifacts back to that manifest.

Reference behavior does not determine asset provenance. Lakecraft may match
16px silhouettes, cuboid proportions, UV conventions, display contexts, and
animation while drawing assets from the four explicit sources below.

- `bundled-compatibility`: the reviewed, hash-pinned installed-client subset.
- `bundled-original`: original Lakecraft pixels used as fallback content.
- `user-skin`: user-selected PNG, stored in the browser for that user.
- `reference-audit`: metadata or measurements gathered during development;
  never texture pixels copied from another game.

## Canonical visual catalog

Every `ItemId` has exactly one `VisualDefinition`. A definition selects one of
three production model families:

1. `block`: cuboid or authored block geometry with per-face texture regions.
2. `sprite`: a pixel-art layer extruded to a shallow 3D item. Opaque front and
   back texels are rendered as faces and every transparent/opaque boundary
   produces a narrow edge face. Tools, swords, bows, food, materials, and armor
   inventory items use this family.
3. `entity`: a textured hierarchy of cuboids with named bones, pivots, UV boxes,
   optional outer layers, and animation channels. Players and mobs use this
   family.

Each definition also carries named display transforms. The minimum contexts
are:

- `gui`
- `firstPersonRight`
- `thirdPersonRight`
- `ground`
- `fixed`

Each transform contains `translation`, `rotation`, `scale`, and an optional
`pivot`. Renderer code may apply gameplay animation after the catalog transform
but must not replace it with hard-coded per-item guesses.

The format contract is grounded in Microsoft's public Creator documentation,
not extracted game files. Its item-display reference defines the same GUI,
first-person, third-person, ground, and fixed contexts plus explicit rotation
and scale pivots; its skin-pack documentation defines separate wide and slim
humanoid geometries backed by creator-supplied PNG textures. The official
entity-authoring guide also identifies 16px as the default texture resolution.
These are interoperability and behavior references only:

- https://learn.microsoft.com/minecraft/creator/reference/content/blockreference/examples/itemdisplaytransforms
- https://learn.microsoft.com/minecraft/creator/documents/packagingaskinpack
- https://learn.microsoft.com/minecraft/creator/documents/entitymodelingandanimation

Model inheritance is resolved before rendering. For example, all Lakecraft
pickaxes, axes, shovels, and swords inherit the project's shared `handheld`
display transform. Bow charge variants inherit the bow transform and swap only
the catalog sprite.

## Original asset authoring rules

- Source sprites are pixel art at a fixed logical resolution (normally 16x16).
- Nearest-neighbor sampling is mandatory. No antialiasing or filtered scaling.
- Tool silhouettes share a deliberate material-independent mask. The material
  palette changes by tier; the silhouette and grip do not drift between tiers.
- Inventory icons and held sprites are the same source pixels.
- Blocks declare top, bottom, and side faces explicitly when they differ.
- Transparent textures use alpha cutout. They are not converted to opaque dark
  pixels.
- Every generated artifact includes a stable fingerprint so tests can detect
  accidental visual drift.

## Player skin contract

The local player rig supports the standard 64x64 skin layout and both arm
geometries:

- `wide`: 4-pixel-wide arms.
- `slim`: 3-pixel-wide arms.

The rig contains head, torso, right/left arm, and right/left leg bones with the
pixel-relative proportions expected by standard skins. Each part renders its
base UV box and optional second-layer UV box for the hat, jacket, sleeves, and
trouser overlays. Transparent outer-layer pixels remain transparent. The hand
is part of the arm cuboid. There is no separate hand box or hand/arm seam.

Skin import must:

1. Accept PNG only.
2. Validate 64x64 or 128x128 dimensions.
3. Ask for `wide` or `slim` instead of guessing.
4. Accept legal PNG grayscale, indexed/palette, RGB, and RGBA encodings,
   including Adam7-interlaced files, then let the browser decode them to RGBA.
5. Upload decoded pixels to WebGL without filtering.
6. Retain the validated selection and arm model in origin-local browser storage.
7. Fail closed on malformed storage and provide a one-click reset to the bundled
   original Lakecraft skin.

## Camera contract

The `F` key cycles through these modes while gameplay owns keyboard input:

1. First person.
2. Third person behind.
3. Third person facing the player.
4. First person.

Typing in chat or another text field must never change perspective. Third-person
cameras reuse the local textured player rig, including its actual equipped
armor and held item. The camera ray shortens against terrain so it cannot show
through walls. The first-person arm is hidden outside first person; the local
body is hidden inside first person.

## Visual Lab contract

Visual Lab runs the production renderers inside the app. It is not a mockup or
a separate CSS illustration. It provides:

- searchable catalog and next/previous navigation;
- block/item/entity tabs;
- inventory, first-person idle, first-person action, third-person front,
  third-person back, dropped-item, and world-placement viewports;
- drag-to-orbit, wheel zoom, and reset-camera controls;
- flat daylight, flat night, torch light, and unlit lighting presets;
- alpha-checker and solid-color background presets;
- wide/slim player toggles and local skin PNG import;
- bow idle plus every draw stage;
- pose/animation controls that modify production state;
- a contact-sheet mode for the complete catalog;
- a diagnostics panel showing model family, inherited model, sprite dimensions,
  display transform, vertex count, draw calls, and asset fingerprint.

The same visual must not be reimplemented in the lab. A regression in a
production renderer must therefore appear in the lab and vice versa.

Current production coverage includes:

- the complete 97-item catalog and a deterministic contact-sheet PNG export;
- shared inventory, first-person, third-person, dropped-item, and world models;
- day, night, torch, and neutral lighting against four inspection backgrounds;
- wide and slim player skins, local PNG persistence, and indexed or interlaced
  PNG decoding;
- fixed-capacity armor, dropped-item, remote-player, and mob batches;
- all eight mob kinds with idle, walk, hurt, death, and special states.

Third-person full blocks use six world-atlas faces. Sprite items use catalog
display transforms and grip pivots. Remote players and mobs use retained batches
with fixed vertex capacity. Multiplayer sends content-addressed 64x64 skin data
outside realtime pose snapshots. The server validates hashes and bounds the
transfer, but armor remains cosmetic self-report and cannot affect damage.

## Automated acceptance

The visual system passes acceptance when all of the following hold:

- every `ItemId` resolves to a visual definition;
- every placeable block resolves all required faces;
- every sprite is non-empty and has transparent padding around its silhouette;
- all tool tiers share their tool-kind silhouette;
- every display context resolves finite translation, rotation, and scale;
- standard and slim skin UV boxes stay within the texture;
- inventory, held, dropped, and lab renderers reference the same catalog ID;
- Visual Lab contact sheets contain every catalog entry exactly once;
- the F-key cycle and input-focus exclusions pass interaction tests;
- third-person camera obstruction tests pass;
- build, type checks, gameplay tests, and fixed performance budgets pass;
- browser screenshots are reviewed at desktop and compact viewport sizes.
