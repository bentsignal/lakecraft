---
name: update-game-assets
description: Use when changing generated textures, models, sounds, or their provenance.
---

# Update game assets

Read `docs/design/visual-assets.md`, `docs/design/texture-pipeline.md`, and
`THIRD_PARTY_NOTICES.md` before changing generated textures, models, sounds, or
their provenance.

Use only the selected files needed by implemented content from the owner's
installed client. Pin source version and hashes, preserve nearest-neighbor pixel
parity and deterministic regeneration, and keep legal/provenance notices
current. Do not hand-edit generated payloads or import an unrelated bulk asset
tree.

Run the relevant catalog, texture, model, hash, compact-build, and live visual
checks. Inspect every affected representation, including world, inventory,
held, third-person, dropped, and mob render paths. One shared source does not
prove that each renderer uses it correctly.
