# Third-party notices

## Minecraft visual compatibility assets

This repository contains the subset of Minecraft Java Edition 26.2
visual assets needed for Lakecraft compatibility testing. They were imported
from the project owner's locally installed, user-owned client by
`scripts/import-minecraft-visual-assets.mjs`. The source JAR hash and selected
files are recorded in the generated manifest. Minecraft and its assets are
copyright Mojang Studios/Microsoft. Lakecraft is not affiliated with or
endorsed by Mojang Studios or Microsoft.

The interface font, survival inventory panel, hotbar, and selection frame come
from that same client. Each font-atlas pixel becomes a square TrueType outline,
so HTML menus, chat, and the HUD use the installed glyph geometry without a
runtime font request. Lakecraft keeps the inventory PNG, 182×22 hotbar, and
24×23 selection frame losslessly.

The ten block-destruction stages and dropped-item art also come from the pinned
client. One nearest-neighbor atlas stores the destruction stages. Dropped
blocks reuse the world atlas. Dropped tools and items extrude the opaque edges
of their installed sprites into thin meshes.

The home-screen "MINECRAFT / LAKE BED EDITION" title image was generated for
this project with OpenAI ImageGen from a user-supplied composition reference,
then cropped, scaled, and WebP-compressed locally with transparency preserved.

The basic compatibility sound set is resolved from the owner's installed
Minecraft Java Edition 26.2 asset index. Lakecraft stores only the reviewed
logical-event-to-SHA-1 manifest and asks Mojang's official content-addressed
resource host for those OGG objects at runtime. The capsule does not redistribute
the audio payloads. Browsers cache those immutable URLs under their normal HTTP
cache policy, and Lakecraft falls back to its original procedural audio when a
resource is unavailable.

## Original Lakecraft texture concepts

OpenAI ImageGen generated the material concept sheets in
`design/texture-concepts/` for Lakecraft. They remain the fallback source. The
compatibility importer replaces matching production tiles with selected files
from the owner's installed Minecraft client.
