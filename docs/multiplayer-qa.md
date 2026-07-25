# Lakebed multiplayer budget and QA

Lakebed is intentionally the only multiplayer transport. Presence, chat,
inventory, world edits, item drops, and combat must not be moved to WebSockets,
WebRTC, or another realtime service even when those choices would be easier.

## Presence budget

The client treats the currently claimed 1,000 mutations/day and 10,000
requests/day as a hard warning, even though a browser cannot see or coordinate
the deployment-wide counters.

- 100 mutations are reserved for gameplay actions.
- The common two-player case receives 450 presence attempts per participant,
  persisted in local storage for a rolling 24-hour window. Two full browser
  budgets plus the action reserve equal 1,000.
- Each participant receives 300 realtime attempts: 60 seconds at 5 Hz. Once
  spent, that participant degrades to the existing one-write-per-minute lease.
- Solo movement never enables the realtime stream. It writes the join and then
  only the sparse lease.
- A quota-like rejection pauses presence until the exact Lakebed reset or
  Retry-After deadline when the browser error retains one; otherwise it uses
  the documented next 00:00 UTC bucket reset. The quota deadline remains
  authoritative across browser-budget rollover and local-storage hydration. A
  generic rejection backs off for 1 second, then 2 seconds; a third consecutive
  rejection is treated as an opaque production quota rejection and stops the
  retry loop. One successful retry clears transient backoff.
- All of this wraps the existing `heartbeatPlayer` Lakebed mutation. There is no
  polling loop or alternate transport.

This is intentionally conservative and imperfect: separate browsers cannot
share their local counters, and gameplay mutations can still consume more than
the 100-call reserve. The client guard prevents the known 5 Hz path from
silently spending 18,000 calls per player-hour; it does not pretend to be a
server-owned global quota ledger.

## User-visible telemetry

Press F3 in-world. The `SYNC` line reports:

- `SOLO`, `BURST`, `DEGRADED`, `BACKOFF`, `QUOTA_PAUSED`, or
  `BUDGET_EXHAUSTED`;
- effective cadence (`5Hz`, `1/min`, or `paused`);
- realtime attempts remaining out of 300;
- browser-day presence attempts remaining out of 450;
- confirmed calls versus attempted calls.
- server-clock snapshot age P50/P95 for unique delivered remote heartbeats and
  the bounded sample count. This excludes browser render delay; live movement
  response must still be timed separately.

If a reactive Lakebed query itself receives a quota error, an inner Lakebed
error boundary replaces the game with a persistent reset countdown and retries
once at the reset without reloading the browser. The parent retains whether the
player had joined, so successful recovery remounts directly into the world.

The HUD also emits a warning when the realtime burst degrades, a quota/retry
storm pauses presence, or the browser-day budget is exhausted.

## Deterministic regression checks

Run:

```sh
node --experimental-strip-types --test \
  tests/presenceMotion.test.ts \
  tests/twoClientMultiplayerQa.test.ts \
  tests/presenceBurstClient.test.ts
```

The simulation must show:

- two moving clients produce 600 presence calls in the first minute (300 each),
  plus two explicitly counted session-start mutations;
- synthetic sample-to-delivery delay has P50 100 ms/P95 210 ms in the standard
  jitter trace and no burst arrival gap over 335 ms;
- a separate synthetic fixed 400 ms round-trip capacity trace produces all 300 writes/client with
  at most two in flight and one latest-pose coalescing slot;
- solo movement stays at the lease cadence;
- two complete browser-day budgets total 900, preserving 100 gameplay calls;
- realtime and session counters cannot overrun their limits;
- transient failures recover after backoff, while quota-like and repeated
  generic failures stop retry storms; the pure injected-429 guard test yields
  zero fallback writes during a full minute and both unchanged guard instances
  resume at reset. Visible two-client pause timing remains a production gate.

For live QA, open two separately authenticated browser profiles, join both to
the production world, enable F3, move both clients during the burst, and confirm
remote interpolation stays smooth while `RT` counts down. Leave both clients
open past burst exhaustion and verify `SYNC DEGRADED 1/min` appears without a
new mutation loop. Bracket the live run with `npx lakebed deploy list --json`,
record request/mutation deltas, and reconcile the wire ledger within 5%. The
deterministic fault test is repeatable evidence; a real two-identity production
trace remains a separate release gate.
