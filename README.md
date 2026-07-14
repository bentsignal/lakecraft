# Lakecraft

Lakecraft is a deliberately unreasonable multiplayer voxel sandbox built entirely as a [Lakebed](https://lakebed.dev) capsule. Lakebed is intentionally the auth system, database, realtime-ish presence/chat transport, runtime, and host even though it was not designed to be a game backend. The 3D renderer is dependency-free TypeScript/WebGL.

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
- Left click mines; right click places the selected block
- Right click a crafting table, chest, door, or bed to interact; right click held food to eat
- Double-click food in the pack to eat it
- `1`–`9` selects the hotbar; `E` opens inventory and crafting
- `T` or `Enter` opens world chat
- `F3` toggles live frame, mesh, chunk, and draw-call counters
- `Esc` releases the pointer

## Project shape

- `client/game/` — custom chunked WebGL renderer, terrain, lighting, fixed-buffer Steve avatars, passive mobs, zombies, ranged skeletons, combat, movement, collisions, and raycasting
- `client/components/` — HUD, inventory, crafting, shared chests, onboarding, and feedback
- `server/index.ts` — Lakebed schema, auth-backed profiles, compact authoritative world chunks, multiplayer presence/chat, CAS-safe inventories, atomic shared-chest transfers, and the synchronized sleep clock
- `shared/` — pure item, recipe, and wire-protocol types

## Build and deploy

```sh
npx lakebed build . --target anonymous --json
stage="$(mktemp -d)"
node scripts/prepare-lakebed-deploy.mjs "$stage"
npx lakebed deploy "$stage" --json
```

The staging step works around the current Lakebed packager including repository metadata and inline source maps until the deploy request exceeds 2 MiB; it still builds and deploys through `npx lakebed` and uses Lakebed's own bundled compiler. The hosted Lakebed database persists shared world edits and player state. Anonymous deploys expire after seven days; run `npx lakebed auth login` and `npx lakebed claim .` to attach a deploy to a Lakebed account. Local development data resets when the dev process restarts.

## Multiplayer architecture

Lakebed owns accounts, unique usernames, compact block-edit snapshots, sparse player poses, chat, inventories and hunger, chests, the world clock, and sparse authoritative mob health/death/drop records. Presence snapshots carry server-validated, quantized velocity and are rate-gated to eight writes per minute; clients use bounded dead reckoning between updates and reconnect at their last accepted pose. Chest moves use one dual-CAS Lakebed mutation for the player pack, chest, and an idempotency receipt, so a dropped response can be retried without duplicating or losing items. Expensive high-frequency simulation stays deterministic on clients: terrain is generated from a shared seed, while zombie/skeleton movement and arrows never emit frame-loop writes. This compromise is deliberate—the project is an experiment in how far Lakebed can be pushed, so replacing it with a conventional game backend is out of scope.

Performance budgets and the repeatable benchmark loop live in [PERFORMANCE.md](./PERFORMANCE.md).
