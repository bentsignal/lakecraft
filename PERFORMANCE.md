# Lakecraft performance contract

Lakecraft is intentionally pushing Lakebed far outside its natural workload. Performance is a product feature and a release gate, not a cleanup task.

## Desktop budgets

- Median frame rate: at least 55 FPS on the development Mac at the default view distance.
- P95 frame time: at most 22 ms during ordinary movement.
- Local block edit mesh work: at most 8 ms P95 and limited to the dirty chunk plus boundary neighbors.
- Main-world join to interactive first frame: at most 3 seconds on a warm connection.
- Remote movement freshness: target under 2.5 seconds while a player is active.
- Idle presence writes: no more than one every 12 seconds per connected player.
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

Authoritative block state is compacted into 8×8 Lakebed chunk rows. The regression fixture reconstructs 1,500 distinct edits across 34 chunks, past the old 1,000-row divergence boundary; a pathological fully edited 4,416-cell column encodes to 2,962 bytes, well below Lakebed's 64 KiB value limit.

The anonymous hosted quota is the harder multiplayer constraint: the current public deploy reports 1,000 mutations/day. Active movement snapshots are therefore deliberately sparse and interpolated locally. Production load testing must track mutation exhaustion as closely as frame time; claiming the deploy is required before treating the current quota as final.

## Strategy

- Prefer deterministic client generation and compact Lakebed records; world coordinates, presence, and inventories are indexed upserts, while chat remains bounded append-only history.
- Rebuild only dirty chunks; never remesh the entire loaded world for one block.
- Interpolate remote state client-side rather than increasing Lakebed heartbeat volume.
- Cap/paginate append-only feeds and preserve legacy duplicate-collapse helpers for migrated data.
- Track Lakebed daily mutation and row limits alongside rendering performance.
- Do not move multiplayer or persistence to another backend to solve performance.
