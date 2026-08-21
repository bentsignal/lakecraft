# Reference-driven visual asset pipeline

Status: active implementation contract (2026-08-04)

## Purpose

Lakecraft's visual system must make every block, item, tool, player part, held
item, and mob immediately recognizable. It must not rely on one-off colored
boxes or a second, unrelated inventory illustration. The same catalog entry and
the same production geometry must drive the world, inventory, first-person,
third-person, dropped-item, and Visual Lab views.

## Provenance boundary

Lakecraft uses Minecraft's public file formats, coordinate systems, model
inheritance, display contexts, skin layout, and visible behavior as engineering
references. For compatibility testing, the project also checks in the bounded
subset of visual assets imported from the owner's installed, user-owned Java
26.2 client. The pinned source hash, exact selected paths, generated manifests,
and attribution are documented in `TEXTURE_PIPELINE.md` and
`THIRD_PARTY_NOTICES.md`; do not expand that subset casually.

Original Lakecraft art remains the deterministic fallback and is recorded with
its source concept and generator revision. A user may import a 64x64 or 128x128
PNG skin that they own or are authorized to use. That skin remains client-local
and is never included in Lakecraft source or a hosted deployment.

The machine-readable provenance boundary and reviewed fingerprints live in
`shared/visualAssetManifest.ts`; fingerprint tests bind the generated item and
atlas artifacts back to that manifest.

Visual similarity is a specification, not a file source: recognizable 16px
silhouettes, cuboid proportions, UV conventions, display contexts, and animation
behavior may deliberately track the reference closely. Every shipped Lakecraft
pixel and model value is nevertheless authored in this repository. The
implementation must keep these paths visibly distinct:

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
display transform; bow charge variants inherit the bow transform and only swap
the original Lakecraft sprite.

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
same pixel-relative proportions expected by standard skins. Each part renders
its base UV box and optional second-layer UV box (hat, jacket, sleeves, and
trouser overlays). Transparent outer-layer pixels remain transparent. The hand
is part of the arm cuboid: there is no separate offset hand box and therefore no
hand/arm seam.

Skin import must:

1. accept PNG only;
2. validate 64x64 or 128x128 dimensions;
3. ask for `wide` or `slim` rather than guessing silently;
4. accept legal PNG grayscale, indexed/palette, RGB, and RGBA encodings,
   including Adam7-interlaced files, then let the browser decode them to RGBA;
5. upload decoded pixels to WebGL without filtering;
6. retain the validated selection and arm model in origin-local browser storage;
7. fail closed on malformed storage and provide a one-click reset to the bundled
   original Lakecraft skin.

## Camera contract

The `F` key cycles through these modes while gameplay owns keyboard input:

1. first person;
2. third person behind;
3. third person facing the player;
4. first person.

Typing in chat or another text field must never change perspective. Third-person
cameras reuse the local textured player rig, including its actual equipped
armor and held item. The camera ray shortens against terrain so it cannot show
through walls. The first-person arm is hidden outside first person; the local
body is hidden inside first person.

## Visual Lab contract

Visual Lab is an in-app development surface backed by production renderers. It
is not a mockup or a separate CSS illustration. It provides:

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

Current production-backed coverage includes the complete 97-item catalog, a
scrollable 97-asset contact sheet plus deterministic one-image PNG export,
inventory sprite extrusion, atlas-projected
inventory cubes derived from the same authored world faces, exact held
first-person composition, full cube and dedicated special-block meshes,
day/night/torch/neutral lighting, four inspection backgrounds, standard
wide/slim player skins with local persistence, legal indexed/interlaced PNG
decoding, deterministic idle/walk articulation, full-catalog third-person held
item inspection, and bounded 20-piece highlighted/shadowed armor with open
helmet, neckline, belt, bracers, and boots. Third-person full blocks are real
six-face cubes built from exact world-atlas texels; sprites consume canonical
catalog display transforms and grip pivots. A bounded spinning dropped-item
batch uses true six-face authored-atlas mips for full blocks and exact catalog
pixel runs for non-cube items. All eight mob kinds share the production batch,
idle/walk/hurt/death/special states, and original sparse multi-face pixel
detailing within the fixed per-mob vertex envelope. The
furnace now has independently authored neutral side masonry and one distinct
front opening instead of repeating front semantics around the cube.

Remote-player held items now use bounded canonical-sprite distance mips instead
of anonymous colored boxes while preserving one retained batch. Remote bodies
use the bundled-original Lakecraft explorer's exact palette and standard-skin
proportions, including its olive jacket, orange scarf, dark trousers, boots,
hair, eyes, and face details. The distance rig remains a fixed 17-box semantic
mesh in that same retained batch, so this fidelity pass adds no vertices or GPU
buffer capacity.

Remote custom-skin selection is deliberately future work because the
multiplayer protocol does not
transport an authorized skin payload or content reference; this pass does not
invent that network or persistence contract.
That limitation must not be hidden behind an alternate lab-only model.

## Automated acceptance

The visual migration is complete only when all of the following pass:

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

## Migration order

1. Introduce the typed visual catalog, display transforms, and model resolver.
2. Replace the separate inventory sheet with catalog sprites.
3. Implement sprite extrusion and migrate tools, bow stages, materials, food,
   utilities, and armor icons.
4. Route first-person, third-person, and dropped-item rendering through the same
   models.
5. Replace the colored player boxes with the textured standard/slim skin rig.
6. Add camera cycling and Visual Lab around those production paths.
7. Migrate authored blocks and then every mob; close completeness gaps only
   through the catalog rather than renderer-specific fallbacks.

Temporary Pose Lab controls may remain during migration, but they stop being the
source of truth once catalog display transforms are active.
