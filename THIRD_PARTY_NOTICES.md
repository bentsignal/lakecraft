# Third-party notices

## Pixelify Sans

Lakecraft loads the Latin subset of **Pixelify Sans** from Google Fonts for its in-game UI.

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

## Original Lakecraft texture concepts

The material concept sheets in `design/texture-concepts/` were generated specifically for Lakecraft with OpenAI ImageGen. They remain the deterministic fallback source; the compatibility importer replaces matching production tiles with the selected locally installed Minecraft files.
