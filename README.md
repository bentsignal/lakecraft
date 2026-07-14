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
- Right click a chest, door, or bed to interact
- `1`–`9` selects the hotbar; `E` opens inventory and crafting
- `T` or `Enter` opens world chat
- `F3` toggles live frame, mesh, chunk, and draw-call counters
- `Esc` releases the pointer

## Project shape

- `client/game/` — custom chunked WebGL renderer, terrain, lighting, Steve avatars, mobs, combat, movement, collisions, and raycasting
- `client/components/` — HUD, inventory, crafting, shared chests, onboarding, and feedback
- `server/index.ts` — Lakebed schema, auth-backed profiles, bounded world state, multiplayer presence/chat, inventories, shared chests, and the synchronized sleep clock
- `shared/` — pure item, recipe, and wire-protocol types

## Build and deploy

```sh
npx lakebed build . --target anonymous --json
npx lakebed deploy . --json
```

The hosted Lakebed database persists shared world edits and player state. Anonymous deploys expire after seven days; run `npx lakebed auth login` and `npx lakebed claim .` to attach a deploy to a Lakebed account. Local development data resets when the dev process restarts.

## Multiplayer architecture

Lakebed owns accounts, unique usernames, block edits, sparse player poses, chat, inventories, chests, and the world clock. Expensive high-frequency simulation stays deterministic on clients: remote poses are interpolated, terrain is generated from a shared seed, and alpha mob combat is intentionally client-authoritative. This compromise is deliberate—the project is an experiment in how far Lakebed can be pushed, so replacing it with a conventional game backend is out of scope.

Performance budgets and the repeatable benchmark loop live in [PERFORMANCE.md](./PERFORMANCE.md).
