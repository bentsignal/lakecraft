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
- `client/components/` — Minecraft-style survival HUD, 72 original pixel item sprites, manual 2×2/3×3 crafting, inventory/armor, pause/player-list menus, furnaces, and shared chests
- `server/index.ts` — Lakebed schema, auth-backed profiles, compact authoritative world chunks, 5 Hz multiplayer presence/chat, CAS-safe inventories, atomic world item drops/pickups, shared-chest transfers, and the synchronized sleep clock
- `shared/` — pure item, recipe, and wire-protocol types

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

Lakebed owns accounts, unique usernames, compact block-edit snapshots, chat, inventories and hunger, chests, dropped items, the world clock, and sparse authoritative mob health/death/drop records. Active players publish server-validated, quantized poses at 5 Hz (with an explicit 300-writes/minute limiter), and clients use bounded dead reckoning between updates while rendering held gear and armor without another mutation loop. That intentionally burns through Lakebed's small hosted write quota quickly: the public deployment is a systems experiment, not an attempt to disguise the platform limitation. Item drops and pickups atomically compare-and-swap the player's inventory alongside a replay receipt so retrying a lost response cannot duplicate a stack. Chest moves use the same dual-CAS pattern. Expensive high-frequency simulation stays deterministic on clients: a bounded 7×7 chunk window streams effectively unbounded X/Z terrain, deep caves, sand, coal, iron, gold, and diamond, while mob motion and projectiles never emit frame-loop writes. Player inventory remains Lakebed-persisted as furnaces smelt ore, food, or glass locally, and placed blocks and interactables remain authoritative Lakebed world state. This compromise is deliberate—the project is an experiment in how far Lakebed can be pushed, so replacing it with a conventional game backend is out of scope.

Performance budgets and the repeatable benchmark loop live in [PERFORMANCE.md](./PERFORMANCE.md).
