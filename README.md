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

## Controls

- Click the world to capture the mouse
- `W A S D` move, `Space` jumps, and the mouse looks around
- Hold either `Ctrl` while moving forward to sprint (requires more than six hunger); hold either `Shift` to sneak, lower your view, and stop at ledges
- While touching a ladder, `W` or `Space` climbs, `S` or either `Shift` key descends, and `A`/`D` steps off
- Left click mines; right click places the selected block
- Hold right click with a bow to draw, then release to fire an authoritative arrow
- Right click a crafting table, furnace, chest, door, or bed to interact; right click held food to eat
- Double-click food in the pack to eat it
- `1`–`9` selects the hotbar; `E` opens inventory and crafting
- `Q` drops one held item into the shared world for another player to pick up
- `T` or `Enter` opens world chat
- Hold `Tab` for the live player list; `Esc` opens the game menu
- `F3` toggles live frame, mesh, chunk, and draw-call counters

## Project shape

- `client/game/` — custom streamed-chunk WebGL renderer with a nearest-filtered original 16×16 texture atlas, deterministic deep terrain with coal/iron/gold/diamond, lighting, blocky player avatars, passive/hostile mobs, combat, movement, collisions, raycasting, and dropped-item rendering
- `client/components/` — Minecraft-style survival HUD, 72 original pixel item sprites, manual 2×2/3×3 crafting, inventory/armor, pause/player-list menus, a three-slot furnace interface, and shared chests
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

The staging step works around the current Lakebed packager including repository metadata and inline source maps until the deploy request exceeds 2 MiB. It uses Lakebed's bundled compiler to flatten the client and server into two minified entrypoints and enables Lakebed's opt-in compact production bundle, then still builds and deploys through `npx lakebed`. Normal `npx lakebed dev` builds keep their source maps. The helper carries `lakebed.json` into the release capsule so every update targets the claimed production deployment. The hosted Lakebed database persists shared world edits and player state at [craft.lakebed.app](https://craft.lakebed.app). Local development data resets when the dev process restarts.

## Multiplayer architecture

Lakebed owns accounts, unique usernames, compact block-edit snapshots, chat, inventories and hunger, furnaces, chests, dropped items, the world clock, and mob/player combat state. Players sample motion locally, publish bounded quantized history batches at a daily-quota-derived cadence, and fetch one proximity composite containing nearby histories plus deterministic mob authority. Clients replay/interpolate that delayed history locally; combat, blocks and items remain separate server-authoritative operations. A sparse authoritative presence lease keeps reach, survival and world actions fenced without restoring the old 5 Hz write loop. Each placed furnace has one persistent Lakebed state with Minecraft-style input, coal-fuel, and output slots. Cooking takes ten seconds per item; elapsed work is materialized from trusted server time when a client reads or transfers a stack, so cooking can finish while every client is away without a background timer or periodic mutation. The open furnace UI projects that trusted state locally at 20 Hz and reconciles with Lakebed at 0.5 Hz, while only explicit stack transfers write. Inventory and furnace changes commit together behind inventory, revision, and placed-block-instance compare-and-swap tokens plus bounded exact-replay receipts, preventing duplicated or lost items across retries and concurrent users.

A single Lakebed row holds the fixed-point mob timeline behind a session-bound lease; the owner checkpoints it at a sparse 30-second cadence together with canonical player/night input, while all clients receive that state through the same quota-bounded composite and deterministically replay the 10 Hz timeline locally. Passive mobs now include pigs, cows, sheep, and chickens, while the hostile set includes zombies, skeletons, creepers, and wide eight-legged spiders. Every kind reuses the same checkpoint, one-batch renderer, receipt-idempotent damage, and one-time loot authority. Chickens supply feathers for the centered flint-over-stick-over-feather arrow recipe and raw chicken that cooks in the existing elapsed-time furnace model. Hostile damage is a discrete mutation that Lakebed revalidates against the canonical mob, target, range, cadence, and current player health; only a persisted death can authorize a respawn. That respawn is also the exact-once transaction boundary for clearing inventory/armor and creating conserved world loot at the locked authoritative death pose. The public deployment is a deliberately constrained systems experiment, not an attempt to disguise Lakebed's small hosted quotas. Terrain still streams as a bounded 7×7 window over effectively unbounded X/Z coordinates, and neither mob rendering nor AI emits frame-loop writes. Replacing Lakebed with a conventional game backend remains out of scope.

Performance budgets and the repeatable benchmark loop live in [PERFORMANCE.md](./PERFORMANCE.md).
