# Lakecraft performance contract

Lakecraft is intentionally pushing Lakebed far outside its natural workload. Performance is a product feature and a release gate, not a cleanup task.

## Desktop budgets

- Median frame rate: at least 55 FPS on the development Mac at the default view distance.
- P95 frame time: at most 22 ms during ordinary movement.
- Local block edit mesh work: at most 8 ms P95 and limited to the dirty chunk plus boundary neighbors.
- Main-world join to interactive first frame: at most 3 seconds on a warm connection.
- Remote movement snapshots: target 5 Hz while a player is moving or turning, with short bounded interpolation between Lakebed writes.
- Presence writes: at most 300 in every sliding minute per actively moving player; idle lease refreshes target six per minute.
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

Remote Steve/nameplate geometry now uses fixed-capacity typed arrays and preallocated GPU buffers. Animation state advances every frame, while geometry uploads are capped near 30 Hz and skipped entirely with zero remotes. A 32-player maximum-name sample uploads 1,359,360 bytes per refresh—about 38.9 MiB/s at 30 Hz instead of 77.8 MiB/s at 60 Hz—without the previous steady-state array churn. Full held tools and four-piece armor raise the 32-player worst case by 331,776 bytes to 1,691,136 bytes per refresh, still inside the single 1,912,320-byte preallocated remote buffer budget and without adding a draw call. The F3 overlay reports remote mesh time, visible players, and upload size.

Authoritative block state is compacted into 8×8 Lakebed chunk rows. The regression fixture reconstructs 1,500 distinct edits across 34 chunks, past the old 1,000-row divergence boundary. Ore and furnace support crossed the original four-bit palette ceiling, so new rows use a versioned five-bit codec while old v1 rows remain readable and migrate on their next edit. The ladder brings the persisted palette to 17 of the codec's 31 available nonzero block codes. A pathological fully edited 4,416-cell column now encodes to 3,698 bytes, still well below Lakebed's 64 KiB value limit and below the 4 KiB regression budget.

Deterministic 3D ore cells add 1,133 coal and 434 iron blocks to the representative radius-40 world without changing its 55,929-block total. Generation remains in the prior practical range: the integrated run measured 22.46 ms, and an isolated five-run sample had a 20.64 ms median. Coal is capped below 8% and iron below 4% of natural stone, with iron rarer than coal; independently generated regions match exactly at seams. Furnaces add one fixed 72-vertex mesh and no new draw call.

Persistent furnaces use at most one bounded Lakebed row per coordinate, tied to the current placed-block instance. A coal item supplies 80 seconds of burn time and each output takes ten seconds, but there is deliberately no server tick, timer mutation, or append-only progress log. Queries and transfers deterministically materialize the stored state to trusted server time, which preserves offline cooking while keeping an idle furnace at zero requests and zero writes. An open drawer projects trusted progress locally at 20 Hz and resamples its read-only Lakebed query at 0.5 Hz (about 30 reads/minute); this keeps the arrows smooth without spending four requests every second. Only user-triggered deposits and withdrawals write, atomically committing the pack and furnace behind inventory, revision, and placed-block-instance compare-and-swap tokens. Exact semantic-operation receipts make outcome-unknown retries idempotent, are capped at 16 per user, become eligible for cleanup after 24 hours, and prune at most eight rows per transfer. The randomized model gate covers 1,500 transfer/cooking histories, and the receipt gate covers 1,000 same-revision contender and replay/reuse cases with item conservation checks.

Deterministic cave cells carve bounded chambers and east/south tunnel links without storing generated terrain in Lakebed. For seed 7319 across a radius-32 fixture, caves remove 1,947 of 19,662 natural stone blocks (9.9%), expose 180 ore blocks, preserve the `y=0` foundation and radius-10 spawn sanctuary, and produce 25 tunnel pairs across an arbitrary region seam. Radius-40 generation measured 21.13 ms median across five runs and 21.45 ms in the final integrated run. Ladders add a fixed 252-vertex mesh to their existing chunk batch, require no extra draw call, and use allocation-free contact and velocity helpers in the frame loop.

Globally anchored sand deposits cover 388 of 6,120 eligible radius-40 columns (6.34%), stay outside the radius-10 spawn sanctuary, and merge exactly across independently generated region seams. The integrated sand-aware radius-40 world contains 873 sand blocks and generated in 28.84 ms. Cobblestone and sand reuse ordinary cube faces; glass is a non-occluding 30-vertex fixed pane inside the existing chunk VBO, so none of the three materials adds a draw call. The representative edit benchmark still scans 30.3× fewer blocks and uploads 58.1× fewer vertices than a full rebuild.

The hosted mutation quota is the harder multiplayer constraint. The last reported public limit was 1,000 mutations/day. At the deliberately aggressive 5 Hz target, one continuously moving player can consume 300 writes/minute, 18,000/hour, or 432,000/day; a 1,000-write allowance would be exhausted in roughly 200 seconds. That is an explicit product experiment, not a hidden optimization win: production QA must record quota exhaustion alongside frame time, and the presence diagnostics expose the active write ceiling. Lakebed remains mandatory even if the result proves impractical.

Presence protocol v3 uses server-validated, quantized velocity snapshots with a 200 ms active gate and a ten-second idle lease. A one-hour 50 ms simulation records 360 idle writes and 18,000 writes during straight movement or adversarial turn spam, with no sliding minute exceeding 300 writes. Horizontal prediction is capped at 750 ms so motion feels responsive without allowing stale snapshots to carry avatars across the map; vertical prediction retains a separate short safety horizon. Leave writes preserve the last authoritative pose for reconnect rather than resetting the player to the origin.

The first streaming-world benchmark generates a nearest-first 7×7 window at a far coordinate: 49 deep chunks, roughly 96,000 blocks, in 70–90 ms on the development Mac. The renderer must load this incrementally rather than generating or meshing the full window in one animation frame, and unload chunks outside the active window so travel remains memory-bounded.

The renderer now keeps exactly 49 horizontal chunks loaded, generates seven new chunks for a one-chunk boundary crossing, and amortizes the resulting seam rebuilds at one chunk per animation frame. Node fake-WebGL evidence measured about 164,000 initial vertices and 3.94 MiB of initial buffer upload; a crossing stayed at 49 chunks and spread 14 affected mesh rebuilds over 14 frames. Generated terrain remains client-deterministic while sparse edits survive chunk eviction/reload.

World snapshot codec v3 stores sparse eight-block vertical sections inside the existing one-row-per-`x:z` API. It expands authoritative edits and presence to X/Z ±1,000,000 and Y -24…128 while retaining v1/v2 decoding and migration-on-write. A worst-case 9,792-edit column uses 20 sections and encodes to 8,970 bytes (roughly 10 ms encode / 5 ms decode); a sparse two-section snapshot is 916 bytes. Both stay below the 16,384-byte application guard and Lakebed's value ceiling.

Gold and diamond generation is confined to deep streamed layers and bounded deterministic veins. The progression fixture produces 12 gold and three diamond blocks in its sampled chunk; gold requires iron-tier harvesting and smelting, while diamond drops directly from an iron-tier harvest. These materials reuse the chunk batch and add no draw call.

Chest transfers now replace the former chest-write-plus-delayed-pack-save sequence with one transactional mutation. A representative dense receipt is about 2.4 KiB including the exact replay result and semantic request fingerprint. Receipts are limited to the newest 16 per user, with a bounded eight-row cleanup batch and a 24-hour stale pass, preventing an ordinary player from growing an unbounded retry log against the anonymous deploy's 1 MiB state ceiling. Inventory autosaves and chest transfers share CAS tokens, and an outcome-unknown client blocks further moves until it replays the same operation ID.

Mob movement now uses one fixed-point 10 Hz shared reducer and a singleton Lakebed checkpoint row. The authority lease lasts 60 seconds and the holder advances the row every 30 seconds: two checkpoint mutations/minute, one retained row, and no frame-loop writes or append growth. Each checkpoint also stores the canonical player/night input for the next interval, so every reader replays immutable inputs instead of rewriting the preceding timeline from its own request-time presence snapshot. Mob state rides inside the same quota-planned proximity composite as player motion. For the defined ten-player, 30-minute daily session, each client receives one composite every two seconds and publishes one motion batch every 30 seconds; followers interpolate locally between those delayed snapshots. The 6,000-tick/10-minute replay remains deterministic, and duplicate hostile-damage claims reuse bounded combat receipts and apply once.

Spiders add no table, query, mutation, checkpoint cadence, or draw call. The canonical checkpoint now contains nine passive and four hostile slots so zombie, skeleton, creeper, and spider are all represented; an old spiderless checkpoint is replaced once through the existing lease/checkpoint mutation. A spider contributes 12 boxes / 432 vertices (two body boxes, two eyes, eight animated legs). Raising the fixed shared batch to the largest 12-box kind keeps the hard 64-mob + 24-arrow + primed-TNT allocation at 794,880 bytes. A deterministic 6,000-tick single-spider replay serializes to 159 bytes with hash `e41e94b421da1898`. Its damage and string drops reuse existing exact-once Lakebed combat paths.

Chickens likewise add no table, query, mutation, checkpoint cadence, allocation, or draw call. The canonical checkpoint now contains twelve passive and four hostile slots, cycling evenly across four kinds in each group. A chicken uses nine boxes inside the existing 12-box maximum: body, head, tail, beak, wattle, two wings, and two legs. Its feather and raw-chicken loot reuse the exact-once mob death receipt path; arrow crafting remains an ordinary inventory workspace commit, and cooking chicken reuses the elapsed-time furnace materializer. Retained pre-chicken checkpoints reseed once through the existing leased checkpoint mutation.

Death settlement adds no polling, timer, or background mutation. One explicit Respawn click executes one Lakebed transaction that preflights the existing dropped-item capacity, clears all 36 inventory and four armor slots, inserts at most 40 coalesced conserved stacks, relocates presence, and restores combat/hunger. The already-consumed respawn grant is the lost-response replay fence, so a repeat request returns the committed empty inventory without inserting another row. Dead heartbeats may refresh liveness but cannot move the authoritative death pose. The compact Task 68 artifact is 873,072 bytes, leaving 175,504 bytes beneath the observed 1 MiB deployment ceiling.

The capsule also reached a Lakebed packaging boundary: a direct deploy request exceeds 2 MiB because the current CLI snapshots repository metadata and emits inline source maps. `scripts/prepare-lakebed-deploy.mjs` flattens both entrypoints and gives both generated files an upstream source-map boundary so Lakebed does not embed their full generated text again. The authoritative-mob release payload is about 1.44 MB with more than 650 kB below the observed ceiling; the automated 32 KiB headroom gate remains mandatory.

The original material sheet is deterministically reduced to sixteen 16×16 RGBA tiles in a 64×64 nearest-filtered atlas. World vertices remain six floats each by replacing RGB with UV plus one shade scalar, so a representative 170,000-vertex world still uses 4,080,000 VBO bytes plus a 16,384-byte atlas. Binary glass cutout keeps 236 of 256 pixels transparent without a sorted blend pass. On the hosted textured build, Computer Use measured 60 FPS, 17.3 ms P95 frame time, 19 draw calls, 49 loaded chunks, 164,388 vertices, and a 10.5 ms most-recent mesh rebuild. The same shared item renderer supplies 72 cached 16×16 original sprites to hotbar, inventory, crafting, chest, furnace, cursor, and armor surfaces.

## Strategy

- Prefer deterministic client generation and compact Lakebed records; world coordinates, presence, and inventories are indexed upserts, while chat remains bounded append-only history.
- Rebuild only dirty chunks; never remesh the entire loaded world for one block.
- Interpolate remote state client-side rather than increasing Lakebed heartbeat volume.
- Cap/paginate append-only feeds and preserve legacy duplicate-collapse helpers for migrated data.
- Track Lakebed daily mutation and row limits alongside rendering performance.
- Persist one mob checkpoint and its immutable replay input every 30 seconds under the session-bound lease; never write mob state from the render loop.
- Apply hostile damage only through deterministic, receipt-idempotent Lakebed claims and authorize respawn only from persisted death.
- Settle carried inventory and armor exactly once inside the authorized respawn transaction; never retry respawn on a timer.
- Commit chest and pack state together, retain only a bounded exact-replay window, and never optimistically mutate either side on the client.
- Materialize furnace progress from trusted server time; keep open-drawer polling read-only and commit pack/furnace transfers together behind bounded replay receipts.
- Do not move multiplayer or persistence to another backend to solve performance.
