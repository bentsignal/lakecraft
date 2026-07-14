# Lakecraft

Lakecraft is a deliberately compact multiplayer voxel sandbox built entirely as a [Lakebed](https://lakebed.dev) capsule. It uses Lakebed's Preact client, hosted database, guest identity, mutations, queries, and deployment pipeline. The 3D renderer is dependency-free WebGL.

## Run locally

```sh
npx lakebed dev
```

Open two local guest sessions to exercise multiplayer:

- `http://localhost:3000/?lakebed_guest=alice`
- `http://localhost:3000/?lakebed_guest=bob`

## Controls

- Click the world to capture the mouse
- `W A S D` move, `Space` jump, mouse to look
- Left click mines; right click places the selected block
- `1`–`9` selects the hotbar; `E` opens inventory and crafting
- `Esc` releases the pointer

## Project shape

- `client/game/` — custom WebGL voxel renderer, terrain, movement, collisions, and raycasting
- `client/components/` — HUD, inventory, crafting, onboarding, and feedback
- `server/index.ts` — Lakebed schema, shared-world edits, and multiplayer presence
- `shared/` — pure item, recipe, and wire-protocol types

## Build and deploy

```sh
npx lakebed build . --target anonymous --json
npx lakebed deploy . --json
```

The hosted Lakebed database persists shared world edits. Local development data resets when the dev process restarts.
