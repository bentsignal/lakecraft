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
- `W A S D` move, `Space` jump, mouse to look
- While touching a ladder, `W` or `Space` climbs, `S` or either `Shift` key descends, and `A`/`D` steps off
- Left click mines; right click places the selected block
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
- `server/index.ts` — Lakebed schema, auth-backed profiles, compact authoritative world chunks, 5 Hz multiplayer presence/chat, CAS-safe inventories, atomic world item drops/pickups, persistent furnaces and shared-chest transfers, a leased deterministic mob authority, and the synchronized sleep clock
- `shared/` — pure item, recipe, furnace, and wire-protocol types

The original pixel-art workflow and exact regeneration command live in [TEXTURE_PIPELINE.md](./TEXTURE_PIPELINE.md).

## Build and deploy

```sh
npx lakebed build . --target anonymous --json
stage="$(mktemp -d)"
node scripts/prepare-lakebed-deploy.mjs "$stage"
npx lakebed deploy "$stage" --json
```

The staging step works around the current Lakebed packager including repository metadata and inline source maps until the deploy request exceeds 2 MiB. It uses Lakebed's bundled compiler to flatten the client and server into two minified entrypoints, then still builds and deploys through `npx lakebed`. The helper carries `lakebed.json` into the release capsule so every update targets the claimed production deployment. The hosted Lakebed database persists shared world edits and player state at [craft.lakebed.app](https://craft.lakebed.app). Local development data resets when the dev process restarts.

## Multiplayer architecture

Lakebed owns accounts, unique usernames, compact block-edit snapshots, chat, inventories and hunger, furnaces, chests, dropped items, the world clock, and mob/player combat state. Active players publish server-validated, quantized poses at 5 Hz (with an explicit 300-writes/minute limiter), and clients use bounded dead reckoning between updates while rendering held gear and armor. Each placed furnace has one persistent Lakebed state with Minecraft-style input, coal-fuel, and output slots. Cooking takes ten seconds per item; elapsed work is materialized from trusted server time when a client reads or transfers a stack, so cooking can finish while every client is away without a background timer or periodic mutation. The open furnace UI projects that trusted state locally at 20 Hz and reconciles with Lakebed at 0.5 Hz, while only explicit stack transfers write. Inventory and furnace changes commit together behind inventory, revision, and placed-block-instance compare-and-swap tokens plus bounded exact-replay receipts, preventing duplicated or lost items across retries and concurrent users.

A single Lakebed row holds the fixed-point mob timeline behind a session-bound 30-second lease; the owner checkpoints it every second together with the immutable canonical player/night input for the following interval, while every in-world client deliberately samples the Lakebed query at 5 Hz and smoothly interpolates the same 10 Hz deterministic poses and stable target IDs. Hostile damage is a discrete, receipt-idempotent mutation that Lakebed revalidates against the canonical mob, target, range, cadence, and current player health; only a persisted death can authorize a respawn. This intentionally burns through Lakebed's small hosted request and write quotas quickly: the public deployment is a systems experiment, not an attempt to disguise the platform limitation. Terrain still streams as a bounded 7×7 window over effectively unbounded X/Z coordinates, and neither mob rendering nor AI emits frame-loop writes. Replacing Lakebed with a conventional game backend remains out of scope.

Performance budgets and the repeatable benchmark loop live in [PERFORMANCE.md](./PERFORMANCE.md).
