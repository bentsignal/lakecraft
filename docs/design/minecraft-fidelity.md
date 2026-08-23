# Lakecraft Minecraft fidelity target

Lakecraft targets the proportions, interactions, timing, and pixel presentation
of Minecraft Java Edition. The project owner's installed Java 26.2 client is
the compatibility source for selected item, block, and player visuals. Import
only files used by implemented Lakecraft content. Record their provenance and
keep regeneration deterministic.

## In-world HUD

- The WebGL world fills the visual viewport edge to edge. There is no branded header, card, frame, vignette, or permanent tutorial.
- Exactly one small high-contrast crosshair is fixed at the true render center.
- Nine square hotbar slots sit at bottom center using the installed 182×22 HUD
  sprite at 2× scale. The selected slot uses the 24×23 selection sprite. Item
  counts use the bitmap font with one hard lower-right shadow.
- Health is ten hearts above the hotbar on the left, hunger is ten food icons on the right, and armor appears above health only when equipped.
- HUD labels are absent during normal play. Connection/performance diagnostics belong behind F3.

## Chat and player list

- Closed chat is only recent shadowed text at the lower left, with no button, badge, header, timestamp, or panel chrome.
- Pressing T or Enter opens one translucent dark input bar along the bottom and
  reveals more history above it. Enter sends. Escape closes.
- Player messages use `<username> message`. System and warning colors may differ,
  but they keep the same line layout.
- Holding Tab shows a compact translucent player list centered near the top. It disappears on keyup and replaces the removed permanent online/status header.

## Inventory, crafting, furnace, and chests

- Interfaces are centered light-gray pixel panels over a dimmed live world, with dark outer borders and beveled square slots.
- The player inventory contains a 2×2 manual crafting grid, result slot, armor slots, 27 storage slots, and the nine-slot hotbar.
- A crafting table uses a 3×3 manual grid. Item placement determines the recipe.
  There are no recipe cards or craft buttons.
- Clicking moves a cursor stack. Right-click splits a stack or places one item.
  Shift-click transfers where supported. Taking the result consumes the matched
  ingredients.
- Furnaces use input, fuel, and result slots with flame/progress indicators. Chests use rows of nine slots above the player inventory.

## Menus

- Escape releases pointer lock and opens a centered `Game Menu` overlay. Multiplayer simulation continues behind it.
- Primary actions are `Back to Game`, `Options…`, and either `Disconnect` or
  `Save and Quit to Title`.
- The home screen uses a voxel-world panorama, the "MINECRAFT / LAKE BED
  EDITION" title asset, and stacked gray pixel buttons. Player authentication
  stays at bottom left.

## Texture and type pipeline

- World and item art use selected installed 16×16 compatibility files with
  nearest-neighbor sampling. Lakecraft's concept atlas is the fallback for
  content without an imported match.
- The importer must validate source version/hash, paths, dimensions, and exact production RGBA parity before assets enter the renderer.
- Because Lakebed capsules only serve the favicon as a loose static asset, final atlases/fonts must be embedded as compact source data or generated at runtime.
- Use the reviewed installed bitmap glyph geometry already embedded for compatibility. Render at integer-ish pixel sizes with a dark one-pixel-style shadow and no synthetic weight or stroke.

## Transparent-block regression contract

- Draw installed glass in two passes. The alpha-tested frame writes depth first.
  The blended fill then adds color without depth writes. Third-person held glass
  uses volumetric frame edges instead of coplanar transparent texels.
  `tests/glassMaterials.test.ts` and `tests/playerSkinRenderer.test.ts` guard both
  paths.
- The installed water tile has constant 180/255 alpha. Draw water near to far in
  its own depth-writing blended buffer, before the far-to-near glass fill. Stable
  depth ownership keeps both materials visible when chunk order changes.

## Breaking and dropped-item rendering

- Block mining uses the ten installed `destroy_stage_0` through
  `destroy_stage_9` textures on all six collision faces. Progress advances
  through the stages. Releasing the button removes the overlay.
- Dropped full blocks are rotating cubes that use the placed block's atlas
  faces. Dropped tools and flat items keep their front and back art and add edge
  faces along opaque pixels.

## Performance and multiplayer

- Target 60 FPS on an ordinary desktop, p95 frame time under 25 ms, and no unbounded mesh or DOM growth while traveling.
- Chunk mesh rebuilds must reuse retained geometry, upload scratch, and numeric
  block keys. Do not restore per-block string splitting or exact-size typed-array
  allocation on each rebuild. At 12 chunks, those allocations caused repeated
  100 to 160 ms garbage-collection stalls.
- Generate and unload horizontal chunk windows as the player moves. Global
  coordinates must remain deterministic and seam-free.
- Railway servers own realtime multiplayer simulation and persistence. Clients predict presentation where useful, then reconcile to bounded authoritative snapshots and revisioned results.
- Multiplayer drops and pickups are authoritative Railway operations, never client-only duplication opportunities or frame-loop writes. Single-player applies the same conservation rules through its local authority.
- Right-clicking a sheep with shears yields one to three wool, spends one
  durability on acceptance, and removes its wool coat until death or respawn.
  Retrying the same multiplayer operation cannot pay twice.
- White wool is directly placeable, uses an original woven 16×16 texture, breaks softly by hand, drops itself, and remains the same item used in the three-wool bed recipe.

## Reference sources

- Minecraft Java HUD screenshots: health/hunger above a centered nine-slot hotbar with a single centered crosshair.
- [Minecraft Java chat parity description](https://feedback.minecraft.net/hc/en-us/community/posts/360036192232--Java-Parity-Chat-UI): bottom chat, simple gray input, history visible only while open.
- [Official crafting guide](https://www.minecraft.net/en-us/article/how-craft): exact grid placement and ingredient matching.
- [Official Java hotkeys](https://help.minecraft.net/hc/en-us/articles/360059148111): Escape menu, scrolling hotbar, and shift-click behavior.
- [Java menu reference](https://minecraft.wiki/w/Tutorial%3AMenu_screen/Java_Edition): main-menu and pause-menu hierarchy.
