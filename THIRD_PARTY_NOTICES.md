# Third-party notices

## Pixelify Sans

Lakecraft embeds the Latin WOFF2 subset of **Pixelify Sans** in the capsule for
its in-game UI. No font file is fetched at runtime.

- Copyright 2021 The Pixelify Sans Project Authors
- Source: <https://github.com/eifetx/Pixelify-Sans>
- License: SIL Open Font License 1.1
- License text: <https://openfontlicense.org/open-font-license-official-text/>

## Minecraft visual compatibility assets

This development branch contains the subset of Minecraft Java Edition 26.2
visual assets needed for Lakecraft compatibility testing. They were imported
from the project owner's locally installed, user-owned client by
`scripts/import-minecraft-visual-assets.mjs`; the source JAR hash and selected
files are recorded in the generated manifest. Minecraft and its assets are
copyright Mojang Studios/Microsoft. Lakecraft is not affiliated with or
endorsed by Mojang Studios or Microsoft.

The basic compatibility sound set is resolved from the owner's installed
Minecraft Java Edition 26.2 asset index. Lakecraft stores only the reviewed
logical-event-to-SHA-1 manifest and asks Mojang's official content-addressed
resource host for those OGG objects at runtime; the capsule does not redistribute
the audio payloads. Browsers cache those immutable URLs under their normal HTTP
cache policy, and Lakecraft falls back to its original procedural audio when a
resource is unavailable.

## Original Lakecraft texture concepts

The material concept sheets in `design/texture-concepts/` were generated specifically for Lakecraft with OpenAI ImageGen. They remain the deterministic fallback source; the compatibility importer replaces matching production tiles with the selected locally installed Minecraft files.
