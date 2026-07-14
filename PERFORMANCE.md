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

## Strategy

- Prefer deterministic client generation and compact Lakebed edit/event records.
- Rebuild only dirty chunks; never remesh the entire loaded world for one block.
- Interpolate remote state client-side rather than increasing Lakebed heartbeat volume.
- Cap/paginate append-only feeds and compact logical state in client helpers.
- Track Lakebed daily mutation and row limits alongside rendering performance.
- Do not move multiplayer or persistence to another backend to solve performance.
