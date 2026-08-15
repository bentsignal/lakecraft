# Lakecraft

Lakecraft is a dependency-free TypeScript/WebGL voxel sandbox whose player client, accounts, and server directory ship as a [Lakebed](https://lakebed.dev) capsule. Low-latency multiplayer worlds run as self-hostable Bun services on Railway, with one SQLite volume and admin console per world.

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
- Use Options from the title screen or Game Menu to persist sound and mouse sensitivity locally across both play modes
- Hold either `Ctrl` while moving forward to sprint (requires more than six hunger); hold either `Shift` to sneak, lower your view, and stop at ledges
- While touching a ladder, `W` or `Space` climbs, `S` or either `Shift` key descends, and `A`/`D` steps off
- Hold left click to mine continuously; in singleplayer, hold right click to place ordinary blocks across successive targets
- Left click a mob to attack it; a successful hit swings the held item, plays immediate hit confirmation, and flashes the mob red
- Mined resources pop into the single-player world and are collected by walking over them; a full pack leaves them safely on the ground
- Defeated single-player mobs drop their rewards beside the body; partial or full packs leave the conserved remainder in the world and the local save
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
- `T` or `Enter` opens world chat in multiplayer or the local command console in single-player
- Single-player commands include `/help`, `/gamemode <survival|creative>`, and `/give <item> [count]`; Up/Down recalls command history
- Hold `Tab` for the live player list; `Esc` opens the game menu
- Single-player worlds autosave after each minute of active play and force a verified save before Save and Quit leaves the world

## Project shape

- `client/game/` — custom streamed-chunk WebGL renderer with a nearest-filtered 98-material compatibility atlas imported from the owner's installed client, deterministic deep terrain with coal/iron/gold/diamond, connected glass, corner/upside-down stairs, exact wood-family doors, lighting, blocky player avatars, passive/hostile mobs, combat, movement, collisions, raycasting, and dropped-item rendering
- `client/components/` — Minecraft-style survival HUD and Creative catalog with exact-texture block/item renders across oak, spruce, birch, jungle, acacia, dark oak, mangrove, cherry, bamboo, quartz, sandstone, and decorative stone families; manual 2×2/3×3 crafting, inventory/armor, pause/player-list menus, a three-slot furnace interface, and shared chests
- `client/singleplayer/` — offline world integration plus a checksummed two-slot browser-local journal for inventory, edits, drops, containers, TNT, pose, health, time, and deterministic mob state; signing in does not currently upload these worlds
- `server/index.ts` — Lakebed schema, auth-backed profiles, public external-server registrations, short-lived join tickets, and the existing shared progression/state authorities
- `apps/game-server/` — self-hostable Railway realtime authority for movement, jumping, chat, block edits, world drops, melee health/PvP, reconnect credentials, roles, and the per-world `/admin` console
- `shared/` — pure item, recipe, furnace, and wire-protocol types

The original pixel-art workflow and exact regeneration command live in [TEXTURE_PIPELINE.md](./TEXTURE_PIPELINE.md).
The repeatable single-player combat smoke route lives in [docs/creative-combat-qa.md](./docs/creative-combat-qa.md); its Creative command preset takes under one minute and stages melee, armor, hostile-cover, TNT, bow, death-drop, and respawn checks without Lakebed traffic.

## Build and deploy

Ordinary and compact audit builds are local-only. The audit wrapper removes the
checked-in production `deployId`, omits `.env.lakebed.server`, preserves every
other `lakebed.json` key, and exports only non-deployable evidence:

```sh
npx lakebed build . --target anonymous --json
evidence_parent="$(mktemp -d)"
node scripts/build-lakebed-audit.mjs "$evidence_parent/build-a"
node scripts/check-lakebed-artifact-size.mjs "$evidence_parent/build-a/artifact-metadata.json"
```

The wrapper owns an unpredictable private transaction, seals the generated
capsule, runs and verifies the anonymous build itself, deletes the capsule, and
never returns a runnable stage. Exported sources use non-capsule filenames, so
the evidence directory has no canonical client/server entrypoint pair. The full
artifact envelope and client bundle never leave the private transaction; only
redacted hashes and byte counts are exported. Direct staging is disabled. Production release
is a separate operator-only concern and is intentionally unsupported by this
helper.

The transaction works around the current Lakebed packager including repository metadata and inline source maps until the deploy request exceeds 2 MiB. It uses Lakebed's bundled compiler to flatten the client and server into two minified entrypoints, minifies and safely dictionary-packs embedded CSS, shortens private client selector prefixes, shares audited repeated runtime strings through ordinary source-level constants, and enables Lakebed's opt-in compact production bundle, then still builds through `npx lakebed`. `tests/cssTemplateCompression.test.mjs` proves stylesheet round trips and the transform fails safe on its reserved delimiter; `tests/bundleStringConstants.test.mjs` verifies the explicit dictionary and exercises adversarial method, regex, label, and automatic-semicolon-insertion grammar without any post-minify JavaScript inference. Normal `npx lakebed dev` builds keep their source maps and unchanged source identifiers. The transaction prevents accidental or other-user contamination and detects persistent payload drift; it does not claim isolation from a malicious process running as the same operating-system user. The hosted Lakebed database persists shared world edits and player state at [craft.lakebed.app](https://craft.lakebed.app). Local development data resets when the dev process restarts.

The fail-closed production audit, quota/ownership gates, release evidence, and
recovery procedure live in
[docs/production-operations.md](./docs/production-operations.md).

## Multiplayer architecture

Lakebed owns accounts, unique usernames, the public server directory, server ownership/registration, and 45-second scoped join tickets. The selected Railway world redeems that ticket and then becomes the low-latency authority for movement, jumping, chat, block edits, world drops, melee health/PvP, reconnect credentials, and per-world Survival/Creative roles. Its SQLite database is deliberately portable with the self-hosted world and is the only source of truth for those realtime records; they are not mirrored into Lakebed. Inventory progression, hunger, containers, the world clock, mobs, and their richer combat rules are still backed by the capsule while that migration boundary is narrowed. Railway consumes a world drop exactly once, but adding that receipt to the current Lakebed-backed inventory is not yet one cross-system transaction; the browser prevents replay within the live session and this remains an explicit beta limitation. The exact operational split and self-hosting flow are documented in [docs/railway-multiplayer-server.md](./docs/railway-multiplayer-server.md).

The older quota-batched Lakebed motion and chat paths are retired from the production client. Railway sends nearby players and events across a 21-chunk authority radius at realtime cadence, stores bounded chat history in server order, and immediately echoes optimistic messages back to the sender. Each browser independently chooses a 2–12 chunk terrain render distance so slower machines do not pay for the server's full feed. Selected browser skins and equipped armor travel through a content-addressed, out-of-band appearance capability: one transient 64×64 skin per connected player, requested sequentially and rendered through a fixed 32-slot atlas rather than repeated in snapshots. Each server carries its own token-protected `/admin` surface for live player controls and persistent role grants without adding bytes to the Lakebed capsule.

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
