# Third-party notices

## Minecraft visual compatibility assets

This development branch contains the subset of Minecraft Java Edition 26.2
visual assets needed for Lakecraft compatibility testing. They were imported
from the project owner's locally installed, user-owned client by
`scripts/import-minecraft-visual-assets.mjs`; the source JAR hash and selected
files are recorded in the generated manifest. Minecraft and its assets are
copyright Mojang Studios/Microsoft. Lakecraft is not affiliated with or
endorsed by Mojang Studios or Microsoft.

The interface font, survival-inventory panel, and hotbar/selection sprites are
generated from that same installed client's 26.2 assets. Each font-atlas pixel becomes a square
TrueType outline, allowing the ordinary HTML menus, chat, and HUD to use the
original glyph geometry without a runtime font request or a separately
maintained text renderer. The small inventory PNG is retained losslessly so
the slot and player-preview chrome is not reconstructed approximately in CSS.
The 182×22 hotbar and 24×23 selection frame are retained losslessly at 2× UI
scale so their borders and slot bevels also are not reconstructed in CSS.
The ten block-destruction stages and the item/block art used by dropped-item
renders are likewise selected from that pinned client. Destruction stages are
packed losslessly into one nearest-neighbor atlas; dropped blocks reuse the
world texture atlas, while dropped tools/items extrude their installed sprite
silhouettes into thin, depth-bearing meshes.

The home-screen “MINECRAFT / LAKE BED EDITION” title image was generated for
this project with OpenAI ImageGen from a user-supplied composition reference,
then cropped, scaled, and WebP-compressed locally with transparency preserved.

The basic compatibility sound set is resolved from the owner's installed
Minecraft Java Edition 26.2 asset index. Lakecraft stores only the reviewed
logical-event-to-SHA-1 manifest and asks Mojang's official content-addressed
resource host for those OGG objects at runtime; the capsule does not redistribute
the audio payloads. Browsers cache those immutable URLs under their normal HTTP
cache policy, and Lakecraft falls back to its original procedural audio when a
resource is unavailable.

## Original Lakecraft texture concepts

The material concept sheets in `design/texture-concepts/` were generated specifically for Lakecraft with OpenAI ImageGen. They remain the deterministic fallback source; the compatibility importer replaces matching production tiles with the selected locally installed Minecraft files.
