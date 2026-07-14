# Lakecraft performance contract

Lakecraft is intentionally pushing Lakebed far outside its natural workload. Performance is a product feature and a release gate, not a cleanup task.

## Desktop budgets

- Median frame rate: at least 55 FPS on the development Mac at the default view distance.
- P95 frame time: at most 22 ms during ordinary movement.
- Local block edit mesh work: at most 8 ms P95 and limited to the dirty chunk plus boundary neighbors.
- Main-world join to interactive first frame: at most 3 seconds on a warm connection.
- Remote movement snapshots: no more than 7.5 seconds apart while active, with up to 5 seconds of bounded horizontal dead reckoning between Lakebed writes.
- Presence writes: at most eight in every sliding minute per connected player; idle lease refreshes target six per minute.
- Client world-edit query: capped and collapsed by coordinate before renderer application.

## Required evidence per milestone

1. Run `node --experimental-strip-types tests/model.test.ts`.
2. Run the renderer benchmark in `tests/performance.test.ts` when present.
3. Run `npx lakebed build . --target anonymous --json`.
4. Inspect local and hosted Lakebed logs, table counts, failed indexes, and request/mutation volume.
5. Exercise two separately identified users: join, move, chat, mine, place, disconnect, and reconnect.
6. Record median/P95 frame and mesh timings before and after renderer changes.

## Baseline: commit 7bb2f95

Default radius-18 terrain contains 8,702 blocks, 6,314 exposed faces, and 37,884 vertices. A Node proxy of the original full-world neighbor scan measured 19.474 ms median, 27.471 ms P95, and 31.58 ms maximum across 25 runs. This excludes vertex-array allocation and GPU upload, so the original architecture cannot reliably meet a 16.7 ms frame budget when editing blocks.

## Current alpha: commit c8cdd49+

The richer radius-18 terrain contains roughly 16,019 blocks. A representative interior edit scans 502 dirty-chunk blocks instead of 16,019 (`31.9×` less work) and uploads 912 vertices instead of 44,364 (`48.6×` less data). Radius-40 deterministic terrain generation produces about 55,929 blocks in 15–25 ms. Day/night sampling reuses a single state object and completes one million samples in roughly 100–150 ms. Remote player geometry and nameplates remain capped at two draw calls, with 32-player and 64-block-distance safety limits.

The latest focused benchmark run measured radius-40 terrain generation at 10.83 ms, one million day/night samples at 90.42 ms, 384,000 mob simulation ticks at 36.74 ms, and 50 nearest-light selections across 10,000 torch candidates at 18.44 ms. Doors and beds add fixed-size custom meshes; sleep voting and world-clock updates are event-driven and do not add a frame-loop query or mutation.

Remote Steve/nameplate geometry now uses fixed-capacity typed arrays and preallocated GPU buffers. Animation state advances every frame, while geometry uploads are capped near 30 Hz and skipped entirely with zero remotes. A 32-player maximum-name sample uploads 1,359,360 bytes per refresh—about 38.9 MiB/s at 30 Hz instead of 77.8 MiB/s at 60 Hz—without the previous steady-state array churn. The F3 overlay reports remote mesh time, visible players, and upload size.

Authoritative block state is compacted into 8×8 Lakebed chunk rows. The regression fixture reconstructs 1,500 distinct edits across 34 chunks, past the old 1,000-row divergence boundary. Ore and furnace support crossed the original four-bit palette ceiling, so new rows use a versioned five-bit codec while old v1 rows remain readable and migrate on their next edit. A pathological fully edited 4,416-cell column now encodes to 3,698 bytes, still well below Lakebed's 64 KiB value limit and below the 4 KiB regression budget.

Deterministic 3D ore cells add 1,133 coal and 434 iron blocks to the representative radius-40 world without changing its 55,929-block total. Generation remains in the prior practical range: the integrated run measured 22.46 ms, and an isolated five-run sample had a 20.64 ms median. Coal is capped below 8% and iron below 4% of natural stone, with iron rarer than coal; independently generated regions match exactly at seams. Furnaces add one fixed 72-vertex mesh and no new draw call or periodic Lakebed mutation. One inventory transaction consumes a coal and atomically converts at most eight matching inputs.

The anonymous hosted quota is the harder multiplayer constraint: the current public deploy reports 1,000 mutations/day. Active movement snapshots are therefore deliberately sparse and interpolated locally. Production load testing must track mutation exhaustion as closely as frame time; claiming the deploy is required before treating the current quota as final.

Presence protocol v2 replaces two-second dirty-pose writes with server-validated, quantized velocity snapshots and a deterministic 7.5-second rate gate. A one-hour 250 ms simulation records 360 idle writes and 480 writes during straight movement or adversarial turn spam, with no sliding minute exceeding eight writes. That is a 73.3% reduction from the former 1,800 moving writes/hour per player. Horizontal prediction is capped at five seconds and 14 blocks/second; vertical prediction uses a separate half-second safety horizon so stale jump velocity cannot launch an avatar into the sky. Leave writes preserve the last authoritative pose for reconnect rather than resetting the player to the origin.

Chest transfers now replace the former chest-write-plus-delayed-pack-save sequence with one transactional mutation. A representative dense receipt is about 2.4 KiB including the exact replay result and semantic request fingerprint. Receipts are limited to the newest 16 per user, with a bounded eight-row cleanup batch and a 24-hour stale pass, preventing an ordinary player from growing an unbounded retry log against the anonymous deploy's 1 MiB state ceiling. Inventory autosaves and chest transfers share CAS tokens, and an outcome-unknown client blocks further moves until it replays the same operation ID.

Skeletons share the existing mob simulation and one-buffer/one-draw renderer. Their arrows come from a retained 24-projectile pool, use swept player collision, and never write to Lakebed during flight. The deterministic stress fixture advances 64 skeletons for 3,000 ticks (192,000 skeleton-ticks plus arrows) in about 25–40 ms on the development Mac, comfortably below its 350 ms regression ceiling.

The capsule also reached a Lakebed packaging boundary: a direct deploy request grew to 2.14 MiB because the current CLI snapshots repository metadata and emits inline source maps. `scripts/prepare-lakebed-deploy.mjs` stages only capsule files and minifies them with Lakebed's bundled compiler before the normal `npx lakebed deploy`; the same release payload is 1.55 MiB. Treat 1.9 MiB as the deployment-envelope warning threshold until the upstream packager excludes repository internals.

## Strategy

- Prefer deterministic client generation and compact Lakebed records; world coordinates, presence, and inventories are indexed upserts, while chat remains bounded append-only history.
- Rebuild only dirty chunks; never remesh the entire loaded world for one block.
- Interpolate remote state client-side rather than increasing Lakebed heartbeat volume.
- Cap/paginate append-only feeds and preserve legacy duplicate-collapse helpers for migrated data.
- Track Lakebed daily mutation and row limits alongside rendering performance.
- Persist mob combat only on explicit attacks; deterministic movement and local respawn timers must never create Lakebed writes.
- Keep hostile projectiles in fixed client-side pools and fold their geometry into the existing mob batch.
- Commit chest and pack state together, retain only a bounded exact-replay window, and never optimistically mutate either side on the client.
- Do not move multiplayer or persistence to another backend to solve performance.
