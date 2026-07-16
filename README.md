# Lakecraft

Lakecraft is a deliberately unreasonable multiplayer voxel sandbox built entirely as a [Lakebed](https://lakebed.dev) capsule. Lakebed is intentionally the auth system, database, realtime-ish presence/chat transport, runtime, and host even though it was not designed to be a game backend. The 3D renderer is dependency-free TypeScript/WebGL.

Play the current production build at [craft.lakebed.app](https://craft.lakebed.app).

## Run locally

```sh
npx lakebed dev
```

Google sign-in and a unique explorer username are required before joining the shared world. For local identity testing, use Lakebed's development auth command before opening the app:

```sh
npx lakebed auth as alice
```

Singleplayer requires no account and saves only in that browser. The title screen opens it directly; Multiplayer opens a separate dirt-background server directory where the compact account panel offers Sign In, username setup, and Fern Hollow's Join Server action.

## Controls

- Click the world to capture the mouse
- `W A S D` move, `Space` jumps, and the mouse looks around
- Hold either `Ctrl` while moving forward to sprint (requires more than six hunger); hold either `Shift` to sneak, lower your view, and stop at ledges
- While touching a ladder, `W` or `Space` climbs, `S` or either `Shift` key descends, and `A`/`D` steps off
- Hold left click to mine continuously across successive blocks; right click places the selected block
- Left click a mob to attack it; a successful hit swings the held item and plays immediate hit confirmation
- Mined resources pop into the single-player world and are collected by walking over them; a full pack leaves them safely on the ground
- Hold right click with a bow to draw, then release to fire an authoritative arrow
- Clip oak leaves with shears to recover the block; ordinary breaking has a deterministic sparse apple drop
- Break oak leaves for renewable saplings, craft one bone into three bone meal, plant on dirt/grass, then right click the sapling with bone meal to grow it
- Smelt oak logs into charcoal; coal and charcoal both fuel furnaces and craft four torches over a stick
- Smelt cobblestone back into stone, then arrange four stone in the 2×2 pack grid to craft four stone bricks
- At a crafting table, place three stone bricks across one horizontal row to craft six bottom-half stone brick slabs
- At a crafting table, arrange two rows of plank–stick–plank to craft three connecting oak fences
- Arrange two rows of stick–plank–stick to craft an oak fence gate; right click it to open or close the passage
- Right click a crafting table, furnace, chest, door, or bed to interact; right click held food to eat
- In single-player, a bed always sets your respawn point; at night it sleeps through to dawn, and breaking that bed restores world spawn
- Single-player chests and furnaces use the same full-stack transfer and smelting rules, but persist entirely in the local world save
- Double-click food in the pack to eat it
- Single-player hunger drains with activity, gates sprint below seven points, regenerates health while well fed, and starves down to one health
- Falls up to three blocks are safe; longer single-player falls deal shared Minecraft-style landing damage and can kill
- `1`–`9` selects the hotbar; `E` opens inventory and crafting
- `Q` drops one held item and Ctrl/Cmd+`Q` drops its whole stack; multiplayer drops enter the shared world
- `T` or `Enter` opens world chat
- Hold `Tab` for the live player list; `Esc` opens the game menu
- In single-player, the game menu can save immediately; dirty worlds also autosave after five minutes of active play and save before leaving
- `F3` toggles live frame, mesh, chunk, and draw-call counters

## Project shape

- `client/game/` — custom streamed-chunk WebGL renderer with a nearest-filtered original 16×16 texture atlas, deterministic deep terrain with coal/iron/gold/diamond, lighting, blocky player avatars, passive/hostile mobs, combat, movement, collisions, raycasting, and dropped-item rendering
- `client/components/` — Minecraft-style survival HUD, 93 original pixel item sprites, manual 2×2/3×3 crafting, inventory/armor, pause/player-list menus, a three-slot furnace interface, and shared chests
- `client/singleplayer/` — offline world integration plus a checksummed two-slot browser journal for inventory, edits, drops, containers, TNT, pose, health, time, and deterministic mob state
- `server/index.ts` — Lakebed schema, auth-backed profiles, compact authoritative world chunks, quota-batched multiplayer history/chat, CAS-safe inventories, atomic world item drops/pickups, persistent furnaces and shared-chest transfers, a leased deterministic mob authority, and the synchronized sleep clock
- `shared/` — pure item, recipe, furnace, and wire-protocol types

The original pixel-art workflow and exact regeneration command live in [TEXTURE_PIPELINE.md](./TEXTURE_PIPELINE.md).

## Build and deploy

```sh
npx lakebed build . --target anonymous --json
stage="$(mktemp -d)"
node scripts/prepare-lakebed-deploy.mjs "$stage"
LAKEBED_COMPACT_BUNDLE=1 npx lakebed deploy "$stage" --json
```

The staging step works around the current Lakebed packager including repository metadata and inline source maps until the deploy request exceeds 2 MiB. It uses Lakebed's bundled compiler to flatten the client and server into two minified entrypoints, minifies and safely dictionary-packs embedded CSS, shortens private client selector prefixes, and enables Lakebed's opt-in compact production bundle, then still builds and deploys through `npx lakebed`. `tests/cssTemplateCompression.test.mjs` proves stylesheet round trips and the transform fails safe on its reserved delimiter. Normal `npx lakebed dev` builds keep their source maps and unchanged source identifiers. The helper carries `lakebed.json` into the release capsule so every update targets the claimed production deployment. The hosted Lakebed database persists shared world edits and player state at [craft.lakebed.app](https://craft.lakebed.app). Local development data resets when the dev process restarts.

## Multiplayer architecture

Lakebed owns accounts, unique usernames, compact block-edit snapshots, chat, inventories and hunger, furnaces, chests, dropped items, the world clock, and mob/player combat state. Players sample motion locally, publish bounded quantized history batches at a daily-quota-derived cadence, and fetch one proximity composite containing nearby histories plus deterministic mob authority. Clients replay/interpolate that delayed history locally; combat, blocks and items remain separate server-authoritative operations. A sparse authoritative presence lease keeps reach, survival and world actions fenced without restoring the old 5 Hz write loop. Each placed furnace has one persistent Lakebed state with Minecraft-style input, coal-fuel, and output slots. Cooking takes ten seconds per item; elapsed work is materialized from trusted server time when a client reads or transfers a stack, so cooking can finish while every client is away without a background timer or periodic mutation. The open furnace UI projects that trusted state locally at 20 Hz and reconciles with Lakebed at 0.5 Hz, while only explicit stack transfers write. Inventory and furnace changes commit together behind inventory, revision, and placed-block-instance compare-and-swap tokens plus bounded exact-replay receipts, preventing duplicated or lost items across retries and concurrent users.

World mining loot is coordinate-derived and replay-safe. Gravel resolves flint only for shovels; oak leaves resolve to the block only for 238-use iron shears, otherwise to a one-in-200 apple, a one-in-20 sapling, or nothing. Single-player and Lakebed world operations call the same pure resolver, while successful shears wear commits atomically with the block edit and rejected or replayed operations consume no durability. Logs can be smelted into charcoal, and a shared fuel predicate keeps the furnace UI and Lakebed transfer authority aligned on coal and charcoal. Both fuels reuse the same trusted-time 80-second burn materializer and exact-replay receipts.

A single Lakebed row holds the fixed-point mob timeline behind a session-bound lease; the owner checkpoints it at a sparse 30-second cadence together with canonical player/night input, while all clients receive that state through the same quota-bounded composite and deterministically replay the 10 Hz timeline locally. Passive mobs now include pigs, cows, sheep, and chickens, while the hostile set includes zombies, skeletons, creepers, and wide eight-legged spiders. Every kind reuses the same checkpoint, one-batch renderer, receipt-idempotent damage, and one-time loot authority. Chickens supply feathers for the centered flint-over-stick-over-feather arrow recipe and raw chicken that cooks in the existing elapsed-time furnace model. Hostile damage is a discrete mutation that Lakebed revalidates against the canonical mob, target, range, cadence, and current player health; only a persisted death can authorize a respawn. That respawn is also the exact-once transaction boundary for clearing inventory/armor and creating conserved world loot at the locked authoritative death pose. The public deployment is a deliberately constrained systems experiment, not an attempt to disguise Lakebed's small hosted quotas. Terrain still streams as a bounded 7×7 window over effectively unbounded X/Z coordinates, and neither mob rendering nor AI emits frame-loop writes. Replacing Lakebed with a conventional game backend remains out of scope.

Sheep can be clipped by right-clicking with shears. The interaction is a discrete Lakebed mutation that reuses the active presence/reach checks and bounded combat receipt window; one accepted transaction changes the shared coat state, spends exactly one durability, and inserts a deterministic one-to-three wool into the same authoritative inventory. Replays return the current inventory without paying again, and the existing proximity composite carries the narrower pink sheared model without another query loop. Single-player uses the same visible state transition and inventory-capacity fence locally.

The resulting white wool is a normal building block rather than a recipe-only token. Its existing item ID now places an opaque, collision-bearing 16×16 woven-fleece cube, mines back into itself by hand, and still feeds the unchanged bed recipe. Wool appends as world-chunk palette code 25 and protocol index 24, leaving every deployed block code stable; placement and mining reuse the ordinary exact-once world mutation and add no network loop.

Oak wood is renewable through the same offline/Lakebed rules. Uncut leaves resolve one deterministic conserved drop—an apple at one in 200, otherwise an oak sapling at one in 20—while shears still recover exactly one leaf block. One bone crafts three bone meal. Saplings append as world-chunk code 26/protocol index 25, render as alpha-tested crossed pixel art, only place above dirt or grass, and grow into a deterministic 4–5-log oak after a valid bone-meal use. Multiplayer commits the complete tree across at most four chunks and 70 edits together with exactly one selected bone meal and a bounded replay receipt; it adds no timer or polling loop.

Stone building now has a renewable furnace progression: cobblestone smelts into stone, and an exact 2×2 arrangement of four stone crafts four stone bricks. The opaque masonry block appends as world-chunk code 27/protocol index 26, requires at least a wooden pickaxe to recover, and reuses the ordinary exact-once place/mine transaction without adding a request loop.

Oak fences use the exact two-row plank–stick–plank crafting-table pattern and produce three sections. They append as world-chunk code 28/protocol index 27, connect their two rails toward neighboring fences or solid cubes with four bounded probes, reuse the oak-plank texture batch, and extend collision to 1.5 blocks so ordinary jumps cannot clear them. Placement and recovery stay on the generic exact-once Lakebed block transaction.

Oak fence gates complete those enclosures with the inverse two-row stick–plank–stick recipe. The closed/open states append as world-chunk codes 29/30 and protocol indices 28/29; either mines back to the one gate item, while placement always starts closed. Right-click generalizes the existing exact-once door toggle request, so one Lakebed mutation atomically flips the state and its receipt without touching inventory. Closed gates retain 1.5-block collision and projectile/fall cover; open gates swing their bars out of the passage and stop occluding movement or shots.

Stone brick slabs use the exact crafting-table pattern of three stone bricks across one horizontal row and produce six slabs. Placement creates a bottom-half, 0.5-block masonry course with half-height collision and open space above it. The slab keeps deployed world-chunk palette code 31 and protocol index 30 without renumbering any block; the current six-bit v4 chunk codec leaves codes 32–63 available, while v1–v3 rows remain readable and upgrade only when touched. Crafting, placement, and mining reuse the generic inventory and exact-once Lakebed world operations, with no extra request cadence or rendering draw pass.

Clay adds another authentic resource loop without prematurely introducing water or biomes. Globally anchored shallow lenses replace two or three eligible dirt/stone layers beneath intact grass outside the spawn sanctuary and match exactly across streamed chunk seams. Clay appends as world-chunk code 32/protocol index 31 and always yields four conserved clay balls; each ball fires into one brick through the existing trusted-time furnace. An exact 2×2 brick pattern crafts one placeable bricks block at code 33/index 32, which mines back into itself. The terrain, furnace, crafting, placement, and mining paths reuse existing deterministic or exact-once operations and add no network cadence.

Performance budgets and the repeatable benchmark loop live in [PERFORMANCE.md](./PERFORMANCE.md).
