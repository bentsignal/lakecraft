# Lakecraft Minecraft fidelity target

Lakecraft should feel immediately familiar to a Minecraft Java Edition player. The project owner's locally installed, user-owned Java 26.2 client is the authoritative compatibility source for selected item, block, and standard-player visuals. Import only the files used by implemented Lakecraft content, retain deterministic provenance and regeneration, and do not import unrelated game data.

## In-world HUD

- The WebGL world fills the visual viewport edge to edge. There is no branded header, card, frame, vignette, or permanent tutorial.
- Exactly one small high-contrast crosshair is fixed at the true render center.
- Nine square hotbar slots sit at bottom center using the exact installed 182×22 HUD sprite at 2× scale. The selected slot uses the installed 24×23 selection sprite; item counts use the regular bitmap face and one hard lower-right shadow.
- Health is ten hearts above the hotbar on the left, hunger is ten food icons on the right, and armor appears above health only when equipped.
- HUD labels are absent during normal play. Connection/performance diagnostics belong behind F3.

## Chat and player list

- Closed chat is only recent shadowed text at the lower left, with no button, badge, header, timestamp, or panel chrome.
- Pressing T or Enter opens a single translucent dark input bar along the bottom and reveals more history above it. Enter sends; Escape closes.
- Player messages use `<username> message`; system/warning colors may differ but keep the same line layout.
- Holding Tab shows a compact translucent player list centered near the top. It disappears on keyup and replaces the removed permanent online/status header.

## Inventory, crafting, furnace, and chests

- Interfaces are centered light-gray pixel panels over a dimmed live world, with dark outer borders and beveled square slots.
- The player inventory contains a 2×2 manual crafting grid, result slot, armor slots, 27 storage slots, and the nine-slot hotbar.
- A crafting table uses a 3×3 manual grid. Recipes are recognized from item placement; there are no recipe cards or craft buttons.
- Clicking moves a cursor stack; right-click splits/places one; shift-click transfers where meaningful. Taking the result consumes the exact matched ingredients.
- Furnaces use input, fuel, and result slots with flame/progress indicators. Chests use rows of nine slots above the player inventory.

## Menus

- Escape releases pointer lock and opens a centered `Game Menu` overlay. Multiplayer simulation continues behind it.
- Primary actions are `Back to Game`, `Options…` (initially limited settings), and `Disconnect`/`Save and Quit to Title`.
- The title/home screen uses a generated voxel-world panorama, the generated “MINECRAFT / LAKE BED EDITION” title asset, and stacked gray pixel buttons. Compact player authentication lives at bottom left rather than competing with the title.

## Texture and type pipeline

- World and item art use the selected installed 16×16 compatibility files with nearest-neighbor sampling. Lakecraft's original concept atlas remains the deterministic fallback for content without an imported match.
- The importer must validate source version/hash, paths, dimensions, and exact production RGBA parity before assets enter the renderer.
- Because Lakebed capsules only serve the favicon as a loose static asset, final atlases/fonts must be embedded as compact source data or generated at runtime.
- Use the reviewed installed bitmap glyph geometry already embedded for compatibility. Render at integer-ish pixel sizes with a dark one-pixel-style shadow and no synthetic weight or stroke.

## Transparent-block regression contract

- Ordinary glass previously disappeared with camera/order changes because its opaque frame and translucent fill both lived in a non-depth-writing transparent chunk pass. Keep the installed glass geometry in two passes: the alpha-tested frame first writes depth, then the blended fill contributes color without depth writes. Third-person held glass uses bounded volumetric frame edges rather than coplanar transparent texels. `tests/glassMaterials.test.ts` and `tests/playerSkinRenderer.test.ts` guard both paths.
- Water's installed tile is constant 180/255 alpha. Keep water in its own near-to-far, depth-writing blended buffer before the far-to-near glass fill buffer. Stable depth ownership prevents water surfaces changing or disappearing when transparent chunk order changes without drawing every transparent face twice.

## Breaking and dropped-item rendering

- Block mining uses the exact ten installed `destroy_stage_0` through `destroy_stage_9` textures, sampled with nearest-neighbor filtering on all six collision faces. Progress advances through the stages, and releasing the button removes the overlay immediately.
- Dropped full blocks are small rotating cubes textured from the same per-face world atlas as placed blocks. Dropped tools and other flat item sprites retain their installed front/back art but include opaque-pixel edge faces, so they read as thin 3D objects rather than untextured cards.

## Performance and multiplayer

- Target 60 FPS on an ordinary desktop, p95 frame time under 25 ms, and no unbounded mesh or DOM growth while traveling.
- Chunk mesh rebuilds must reuse retained geometry/upload scratch and private numeric block keys. Do not restore per-block string splitting or per-rebuild exact-size typed-array allocation: at 12 chunks those allocations produced repeated 100–160 ms garbage-collection stalls even though steady-state GPU rendering was fast.
- Generate/unload horizontal chunk windows as the player moves; global coordinates must be deterministic and seam-free in every direction.
- Railway servers own realtime multiplayer simulation and persistence. Clients predict presentation where useful, then reconcile to bounded authoritative snapshots and revisioned results.
- Multiplayer drops and pickups are authoritative Railway operations, never client-only duplication opportunities or frame-loop writes. Single-player applies the same conservation rules through its local authority.
- Right-clicking a sheep with shears yields one to three wool, spends one durability only on acceptance, and visibly removes its wool coat until death/respawn; retrying the same multiplayer operation cannot pay twice.
- White wool is directly placeable, uses an original woven 16×16 texture, breaks softly by hand, drops itself, and remains the same item used in the three-wool bed recipe.

## Reference sources

- Minecraft Java HUD screenshots: health/hunger above a centered nine-slot hotbar with a single centered crosshair.
- [Minecraft Java chat parity description](https://feedback.minecraft.net/hc/en-us/community/posts/360036192232--Java-Parity-Chat-UI): bottom chat, simple gray input, history visible only while open.
- [Official crafting guide](https://www.minecraft.net/en-us/article/how-craft): exact grid placement and ingredient matching.
- [Official Java hotkeys](https://help.minecraft.net/hc/en-us/articles/360059148111): Escape menu, scrolling hotbar, and shift-click behavior.
- [Java menu reference](https://minecraft.wiki/w/Tutorial%3AMenu_screen/Java_Edition): main-menu and pause-menu hierarchy.
