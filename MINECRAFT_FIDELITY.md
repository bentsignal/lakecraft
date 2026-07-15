# Lakecraft Minecraft fidelity target

Lakecraft should feel immediately familiar to a Minecraft Java Edition player. This is a functional and visual reference target, not permission to redistribute Mojang textures, fonts, sounds, or other proprietary files. Use original pixel art, permissively licensed fonts, and code-generated assets.

## In-world HUD

- The WebGL world fills the visual viewport edge to edge. There is no branded header, card, frame, vignette, or permanent tutorial.
- Exactly one small high-contrast crosshair is fixed at the true render center.
- Nine square hotbar slots sit at bottom center. The selected slot uses a bright, thicker inset border; item counts sit at the lower right.
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
- The title/home screen uses a generated voxel-world panorama, a centered logo, and stacked gray pixel buttons. It should resemble the interaction hierarchy of Minecraft without copying its logo or menu art.

## Texture and type pipeline

- World and item art use original 16×16 pixel tiles with nearest-neighbor sampling, deliberately limited palettes, readable edge contrast, and no smooth gradients.
- ImageGen may produce concept sheets. A deterministic script must crop, quantize, downsample, and validate the final dimensions/palette before assets enter the renderer.
- Because Lakebed capsules only serve the favicon as a loose static asset, final atlases/fonts must be embedded as compact source data or generated at runtime.
- Use a permissively licensed pixel font (Pixelify Sans is the initial candidate) and preserve its license. Render at integer-ish pixel sizes with a dark one-pixel-style shadow.

## Performance and multiplayer

- Target 60 FPS on an ordinary desktop, p95 frame time under 25 ms, and no unbounded mesh or DOM growth while traveling.
- Generate/unload horizontal chunk windows as the player moves; global coordinates must be deterministic and seam-free in every direction.
- Moving players target 5 updates/second through Lakebed, with local interpolation between compact snapshots and much slower idle keepalive. Measure the resulting mutation quota honestly.
- Dropped items and pickups are authoritative Lakebed state changes, never client-only duplication opportunities and never frame-loop writes.
- Right-clicking a sheep with shears yields one to three wool, spends one durability only on acceptance, and visibly removes its wool coat until death/respawn; retrying the same multiplayer operation cannot pay twice.

## Reference sources

- Minecraft Java HUD screenshots: health/hunger above a centered nine-slot hotbar with a single centered crosshair.
- [Minecraft Java chat parity description](https://feedback.minecraft.net/hc/en-us/community/posts/360036192232--Java-Parity-Chat-UI): bottom chat, simple gray input, history visible only while open.
- [Official crafting guide](https://www.minecraft.net/en-us/article/how-craft): exact grid placement and ingredient matching.
- [Official Java hotkeys](https://help.minecraft.net/hc/en-us/articles/360059148111): Escape menu, scrolling hotbar, and shift-click behavior.
- [Java menu reference](https://minecraft.wiki/w/Tutorial%3AMenu_screen/Java_Edition): main-menu and pause-menu hierarchy.
