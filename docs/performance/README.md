# Lakecraft performance contract

Renderer changes must meet the budgets below without changing deterministic
world results, authority, item conservation, or visual fidelity.

## Browser frame budgets

Use the deterministic 25-second browser harness described in
[`benchmark.md`](benchmark.md). Run render
distances 6 and 12 three times each on the same browser, hardware, viewport,
and device-pixel ratio, then compare the median run.

On the Apple M4 / Chromium 151 reference machine, require:

- idle and turn p95 frame time no higher than 16.7 ms;
- sprint p95 frame time no higher than 16.7 ms;
- sprint 1% low of at least 45 FPS at distance 6 and 35 FPS at distance 12;
- no more than 6 sprint frames over 25 ms at distance 6 or 9 at distance 12;
- no more than a 5% regression in mean sprint FPS or mean update time.

Treat idle, turn, and sprint separately. Track worst-frame latency even when
p95 improves. The frame-time distribution is authoritative; isolated CPU
microbenchmarks and average FPS are diagnostic evidence only.

## Runtime invariants

- Keep terrain generation, loaded chunks, dirty mesh work, entities,
  projectiles, drops, particles, receipts, and protocol batches explicitly
  bounded.
- Generate and unload horizontal chunk windows incrementally. Crossing one
  chunk boundary must not generate or remesh the full active window in one
  animation frame.
- Rebuild only dirty chunks and required boundary neighbors. Preserve retained
  typed-array and GPU-buffer capacity in steady-state render paths.
- Do not restore per-frame string coordinate parsing, exact-size typed-array
  allocation, or unbounded DOM/collection growth.
- Paused or hidden gameplay schedules only the minimum lifecycle heartbeat;
  simulation, mesh work, uploads, draws, and performance sampling remain idle.
- Keep ordinary input, animation, audio, and UI state local to the client. Do
  not turn frame-loop behavior into network traffic or reactive render churn.
- A performance optimization must preserve byte- or behavior-level output
  where the existing tests define determinism. If fidelity changes, validate it
  visually rather than hiding the change behind a benchmark gain.

## Multiplayer boundary

Railway is the realtime multiplayer authority. Its interest-managed WebSocket
feed, in-memory simulation, and SQLite checkpoints replace the retired
Lakebed-presence polling experiment. Lakebed traffic is limited to identity,
directory, registration, and scoped join-ticket operations.

- Batch and version network messages, enforce backpressure, and send each
  client only nearby state.
- Use client prediction/interpolation for presentation, then reconcile to
  canonical Railway revisions and exact-once results.
- Keep gameplay writes event-driven. Idle worlds should stop ticking or reduce
  work to the documented persistence/lease minimum.
- Measure tick time, event-loop lag, CPU, memory, bytes per player-second,
  checkpoint latency, reconnect storms, and catch-up behavior before making
  concurrency or cost claims.
- Never trade replay safety, authoritative validation, or conservation for a
  lower message count.

See [`../architecture/railway-multiplayer.md`](../architecture/railway-multiplayer.md)
and [`../architecture/gameplay-authority.md`](../architecture/gameplay-authority.md)
for the owning architecture.

## Compact-build safety

Production compaction is an audited packaging transform, not permission to
rename arbitrary source properties. Keep property rewriting to the fixed,
reviewed client-only allowlist enforced by the compaction tests. Persistence,
server, shared protocol, dynamic/reflection, DOM, Preact, WebGL, and serialized
keys are hard exclusions because their names cross runtime or data boundaries.
Static packing must preserve decoded bytes and numeric values exactly, and an
optimization is worthwhile only when paired real artifacts prove a net gain.

The owning implementation and adversarial grammar/collision guards live in
`scripts/client-property-compaction.mjs` and the matching tests under `tests/`.
The transactional staging and path-containment boundary is documented in
[`../operations/lakebed-production.md`](../operations/lakebed-production.md).

## Focused checks

Run the checks proportional to the changed subsystem, including:

```sh
node --experimental-strip-types tests/performance.test.ts
node --experimental-strip-types tests/performanceBenchmark.test.ts
node --experimental-strip-types tests/fluidPerformance.test.ts
```

For release work, also run the repository suite, the paired compact-build
procedure, and the artifact headroom gate in
[`../operations/lakebed-production.md`](../operations/lakebed-production.md). Keep at least
32 KiB below the Lakebed capsule ceiling and require byte-identical independent
compact builds.

## Updating this contract

Do not append per-task benchmark narratives here. Git, pull requests, and test
fixtures preserve historical measurements. Update only active budgets,
hardware baselines, benchmark commands, or durable invariants; put detailed
new reference results in `docs/performance/benchmark.md` and keep every
Markdown file within the 300-line repository limit.
