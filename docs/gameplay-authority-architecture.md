# Lakecraft gameplay authority architecture

Lakecraft has one game client and two world-authority adapters. Single-player
and multiplayer are not separate games.

## Shared gameplay core

Every playable session enters through `client/gameplay/`:

- `createGameplaySessionEngine` is the only playable `VoxelEngine` construction boundary.
- `GameplaySessionSurface` owns the common canvas, loading layer, pointer-capture affordance, and diagnostics.
- `createGameplayPresentationOptions` owns authority-independent input, camera, FOV, mining, combat presentation, hotbar, flight, audio, and performance callbacks.
- `catalog.ts` owns the shared item/block/audio mappings.
- `pointerSession.ts` owns the common pause, Escape, chat-close, inventory-close, and pointer-lock state machine.

Screenshots, coordinates/FPS, HUD, chat, fullscreen/keyboard capture, pointer
lock, renderer behavior, player rigs, item poses, and movement belong to this
shared core. A mode-specific implementation of any of those is an architecture
regression.

## Authority adapters

`createLocalGameplayAuthority` owns offline persistence and local simulation.
It reserves and commits edits synchronously and runs the deterministic mob
simulation in the browser.

`createRailwayGameplayAuthority` owns network-backed world state. Railway
accepts commands and publishes canonical players, poses, edits, drops, chat,
appearance, game mode, and respawn results. The browser may predict presentation
locally, but it reconciles to Railway responses and cannot silently fall back to
Lakebed world mutations or local mob authority.

The same Railway world also owns its durable per-server player packs. Placement,
Q-drop, pickup, crafting, eating, selection, and death settlement use the pure
shared inventory transitions, but revisions and idempotency receipts are stored
in Railway SQLite. Lakebed provides a validated one-time seed on a player's
first visit; ordinary multiplayer gameplay spends no Lakebed queries or
mutations.

Lakebed remains the account and control plane: authentication, usernames, and
server registration/join tickets. It must not be used as the realtime world or
multiplayer inventory transport.

## Change rule

Implement a gameplay feature once in the shared engine/presentation/UI layer.
Add authority commands and persistence only where the source of truth differs.
If a feature needs separate single-player and multiplayer presentation code,
stop and move the shared behavior into `client/gameplay/` first.

The architecture regression suite is `tests/gameplayAuthorityArchitecture.test.ts`.
The Lakebed query-budget suite additionally fails if Railway gameplay re-adds a
Lakebed world polling bridge.
